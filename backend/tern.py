"""Bridge from the dashboard's /tern endpoint to tern-llm's /ask.

tern-llm answers plain-English questions from EVIL's data (recorded runs, and the
run being recorded once live is on), so any telemetry the frontend sends is
ignored here; the reply is {"answer": ...}.
"""

import asyncio
import json
import os
import time
from typing import AsyncIterator

import httpx

# thor's tailnet name, not its IP (the IP changed once already and broke this default).
TERN_LLM_URL = os.getenv("TERN_LLM_URL", "http://thor.tail4ccb95.ts.net:8000/ask")
CONNECT_TIMEOUT_SEC = float(os.getenv("TERN_LLM_CONNECT_TIMEOUT_SEC", "3"))
# tern-llm queues questions: up to TERN_QUEUE_WAIT_SEC (120) in line, then up to
# TERN_LLM_ASK_TIMEOUT_SEC (150) for the answer. RED is in tern-llm's priority lane, so in
# practice it waits at most for the answer already running. Stay above both limits so
# tern-llm's clean 503/504 wins the race over a raw client-side timeout.
RESPONSE_TIMEOUT_SEC = float(os.getenv("TERN_LLM_RESPONSE_TIMEOUT_SEC", "280"))
# Identifies RED to tern-llm: priority in its queue, RED's answer profile, and (live plan D)
# "now / this lap" questions default to the run being recorded.
TERN_CLIENT_ID = os.getenv("TERN_LLM_CLIENT", "red")
# Tern's streaming endpoint (progress events + the answer, NDJSON). Default: TERN_LLM_URL with
# /ask -> /ask/stream. An older Tern without it (404/405) gets one plain /ask instead.
TERN_LLM_STREAM_URL = os.getenv("TERN_LLM_STREAM_URL") or (
    TERN_LLM_URL[: -len("/ask")] + "/ask/stream" if TERN_LLM_URL.endswith("/ask") else TERN_LLM_URL + "/stream")
CONNECT_RETRIES = int(os.getenv("TERN_LLM_CONNECT_RETRIES", "3"))
CONNECT_RETRY_DELAY_SEC = float(os.getenv("TERN_LLM_CONNECT_RETRY_DELAY_SEC", "0.2"))

# Phrased as one simple lookup on purpose: against the real qwen2.5:7b model,
# multi-part "summarize ..." phrasings were wrongly refused as having no
# matching tool, while single-lookup phrasings reliably called list_runs.
DEFAULT_QUESTION = os.getenv(
    "TERN_LLM_DEFAULT_QUESTION",
    "What was the most recent run, and how many laps did it have?",
)


class TernLLMBusy(RuntimeError):
    """tern-llm can't take this question now: its line is full (429), it waited too long in the
    line (503), or RED already has a question in progress (409). `retry_after` is in seconds."""

    def __init__(self, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class TernLLMTimeout(RuntimeError):
    """tern-llm took too long to answer, or the client timed out waiting."""


class TernLLMUnavailable(RuntimeError):
    """tern-llm could not be reached, or returned an unusable response."""


class TernLLMClient:
    def __init__(self, url: str, transport: httpx.AsyncBaseTransport | None = None):
        self.url = url
        self._transport = transport
        self._request_seq = 0

    def _question(self, data: dict) -> str:
        question = data.get("question") if isinstance(data, dict) else None
        if isinstance(question, str) and question.strip():
            return question.strip()
        return DEFAULT_QUESTION

    async def _post_once(self, question: str) -> dict:
        timeout = httpx.Timeout(RESPONSE_TIMEOUT_SEC, connect=CONNECT_TIMEOUT_SEC)
        async with httpx.AsyncClient(
            timeout=timeout, headers={"Connection": "close"}, transport=self._transport
        ) as client:
            response = await client.post(self.url, json={"question": question, "client": TERN_CLIENT_ID})
            response.raise_for_status()
            return response.json()

    async def get_response(self, data: dict) -> dict:
        question = self._question(data)
        self._request_seq += 1
        request_id = self._request_seq
        start = time.monotonic()
        last_error: Exception | None = None

        for attempt in range(CONNECT_RETRIES):
            print(f"[TernLLM] request {request_id} attempt {attempt + 1}/{CONNECT_RETRIES}", flush=True)
            try:
                decoded = await self._post_once(question)
            except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
                # ConnectTimeout is a TimeoutException, but like ConnectError nothing reached
                # tern-llm, so it is safe to retry (seen live 11-04: a tailnet hiccup on first connect).
                # Only a failed connection is safe to retry: nothing reached
                # tern-llm. A timeout may mean it is mid-inference, and
                # retrying would queue a second slow LLM call behind it.
                last_error = exc
                print(f"[TernLLM] request {request_id} connect failure: {exc}", flush=True)
                if attempt + 1 < CONNECT_RETRIES:
                    await asyncio.sleep(CONNECT_RETRY_DELAY_SEC)
                continue
            except httpx.TimeoutException as exc:
                raise TernLLMTimeout("tern-llm did not respond in time") from exc
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                print(f"[TernLLM] request {request_id} upstream returned {status}", flush=True)
                if status in (409, 429, 503):
                    retry_after = exc.response.headers.get("retry-after")
                    raise TernLLMBusy(
                        "tern-llm is busy answering other questions",
                        retry_after=int(retry_after) if retry_after and retry_after.isdigit() else None,
                    ) from exc
                if status == 504:
                    raise TernLLMTimeout("tern-llm did not respond in time") from exc
                raise TernLLMUnavailable(f"tern-llm returned HTTP {status}") from exc
            except httpx.TransportError as exc:
                raise TernLLMUnavailable("tern-llm connection failed") from exc
            except ValueError as exc:
                raise TernLLMUnavailable("tern-llm returned invalid JSON") from exc

            answer = decoded.get("answer") if isinstance(decoded, dict) else None
            if not isinstance(answer, str):
                raise TernLLMUnavailable("tern-llm response had no answer")
            print(f"[TernLLM] request {request_id} answered in {time.monotonic() - start:.2f}s", flush=True)
            return {"answer": answer}

        raise TernLLMUnavailable("tern-llm connection failed") from last_error

    async def stream(self, data: dict, stream_url: str) -> AsyncIterator[dict]:
        """Tern's progress events, then {"type": "answer", ...} or {"type": "error", ...}. Never
        raises: every failure becomes an error event the panel can show."""
        question = self._question(data)
        timeout = httpx.Timeout(RESPONSE_TIMEOUT_SEC, connect=CONNECT_TIMEOUT_SEC)
        try:
            async with httpx.AsyncClient(timeout=timeout, transport=self._transport) as client:
                async with client.stream("POST", stream_url,
                                         json={"question": question, "client": TERN_CLIENT_ID}) as response:
                    if response.status_code in (404, 405):
                        fallback = True
                    elif response.status_code >= 400:
                        await response.aread()
                        yield _error_event(response.status_code, response.text)
                        return
                    else:
                        fallback = False
                        async for line in response.aiter_lines():
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                event = json.loads(line)
                            except ValueError:
                                continue
                            if isinstance(event, dict) and "type" in event:
                                yield event
                        return
        except (httpx.ConnectError, httpx.ConnectTimeout):
            yield {"type": "error", "status": 502, "detail": "Tern is unreachable"}
            return
        except httpx.TimeoutException:
            yield {"type": "error", "status": 504, "detail": "Tern did not respond in time"}
            return
        except httpx.TransportError:
            yield {"type": "error", "status": 502, "detail": "Tern connection failed"}
            return
        if fallback:                       # Tern without /ask/stream: one plain question
            yield {"type": "thinking", "turn": 1}
            try:
                result = await self.get_response(data)
            except TernLLMBusy:
                yield {"type": "error", "status": 503, "detail": "Tern is busy answering other questions, try again shortly"}
            except TernLLMTimeout:
                yield {"type": "error", "status": 504, "detail": "Tern did not respond in time"}
            except TernLLMUnavailable as exc:
                yield {"type": "error", "status": 502, "detail": str(exc)}
            else:
                yield {"type": "answer", "text": result["answer"]}

    async def close(self):
        print("[TernLLM] client closed", flush=True)


def _error_event(status: int, body: str) -> dict:
    if status in (409, 429, 503):
        detail = "Tern is busy answering other questions, try again shortly"
    elif status == 504:
        detail = "Tern did not respond in time"
    else:
        try:
            detail = str(json.loads(body).get("detail")) or f"Tern returned HTTP {status}"
        except (ValueError, AttributeError):
            detail = f"Tern returned HTTP {status}"
    return {"type": "error", "status": status, "detail": detail}


client = TernLLMClient(TERN_LLM_URL)


async def get_response(data: dict):
    return await client.get_response(data)


def stream(data: dict) -> AsyncIterator[dict]:
    return client.stream(data, TERN_LLM_STREAM_URL)


async def close():
    await client.close()
