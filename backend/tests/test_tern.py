import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import tern  # noqa: E402


def make_client(handler):
    return tern.TernLLMClient("http://tern.test/ask", transport=httpx.MockTransport(handler))


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def fast_retries(monkeypatch):
    monkeypatch.setattr(tern, "CONNECT_RETRY_DELAY_SEC", 0)


def test_answer_is_returned_and_question_is_forwarded():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"answer": "Lap 3 was fastest."})

    result = run(make_client(handler).get_response({"question": "  which lap was fastest? "}))
    assert result == {"answer": "Lap 3 was fastest."}
    # client=red: RED gets tern-llm's priority lane and its run routing.
    assert seen["body"] == {"question": "which lap was fastest?", "client": "red"}


def test_telemetry_payload_is_ignored_and_default_question_used():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"answer": "ok"})

    run(make_client(handler).get_response({"data": [{"voltage": 1}] * 120}))
    assert seen["body"] == {"question": tern.DEFAULT_QUESTION, "client": "red"}
    assert "voltage" not in json.dumps(seen["body"])


@pytest.mark.parametrize("payload", [None, [], "text", {"question": ""}, {"question": 5}])
def test_unusable_question_falls_back_to_default(payload):
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"answer": "ok"})

    run(make_client(handler).get_response(payload))
    assert seen["body"]["question"] == tern.DEFAULT_QUESTION


def test_connect_timeout_is_retried_like_a_connect_failure():
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectTimeout("no route yet", request=request)
        return httpx.Response(200, json={"answer": "back"})

    assert run(make_client(handler).get_response({})) == {"answer": "back"}
    assert len(calls) == 2


@pytest.mark.parametrize("status", [409, 429, 503])
def test_queue_full_or_waited_too_long_maps_to_busy_with_retry_after(status):
    client = make_client(lambda r: httpx.Response(status, json={"detail": "busy"}, headers={"Retry-After": "37"}))
    with pytest.raises(tern.TernLLMBusy) as info:
        run(client.get_response({}))
    assert info.value.retry_after == 37


def test_409_maps_to_busy():
    client = make_client(lambda r: httpx.Response(409, json={"detail": "busy"}))
    with pytest.raises(tern.TernLLMBusy):
        run(client.get_response({}))


def test_504_maps_to_timeout():
    client = make_client(lambda r: httpx.Response(504, json={"detail": "slow"}))
    with pytest.raises(tern.TernLLMTimeout):
        run(client.get_response({}))


def test_client_side_timeout_maps_to_timeout_and_is_not_retried():
    calls = []

    def handler(request):
        calls.append(1)
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(tern.TernLLMTimeout):
        run(make_client(handler).get_response({}))
    assert len(calls) == 1


def test_other_http_error_maps_to_unavailable_and_is_not_retried():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(500, json={"detail": "boom"})

    with pytest.raises(tern.TernLLMUnavailable):
        run(make_client(handler).get_response({}))
    assert len(calls) == 1


def test_connect_failure_is_retried_then_raises_unavailable():
    calls = []

    def handler(request):
        calls.append(1)
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(tern.TernLLMUnavailable):
        run(make_client(handler).get_response({}))
    assert len(calls) == tern.CONNECT_RETRIES


def test_connect_failure_then_success_recovers():
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(200, json={"answer": "back"})

    assert run(make_client(handler).get_response({})) == {"answer": "back"}
    assert len(calls) == 2


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b"not json"),
        httpx.Response(200, json={"nope": 1}),
        httpx.Response(200, json=["list"]),
        httpx.Response(200, json={"answer": None}),
    ],
)
def test_malformed_success_responses_map_to_unavailable(response):
    with pytest.raises(tern.TernLLMUnavailable):
        run(make_client(lambda r: response).get_response({}))


# ---- /tern/stream: Tern's progress events passed through -------------------------------------

STREAM_URL = "http://tern.test/ask/stream"


def collect(client, data=None):
    async def go():
        return [e async for e in client.stream(data or {"question": "laps?"}, STREAM_URL)]
    return run(go())


def test_stream_url_defaults_to_ask_stream_next_to_ask():
    assert tern.TERN_LLM_STREAM_URL.endswith("/ask/stream")


def test_stream_passes_events_through_in_order():
    seen = {}
    lines = [{"type": "thinking", "turn": 1}, {"type": "tool", "name": "list_laps", "args": {}},
             {"type": "tool_done", "name": "list_laps", "ok": True, "summary": "3 rows"},
             {"type": "answer", "text": "3 laps."}]

    def handler(request):
        seen["url"], seen["body"] = str(request.url), json.loads(request.content)
        body = "\n".join(json.dumps(x) for x in lines[:2]) + "\n\nnot json\n" + \
            "\n".join(json.dumps(x) for x in lines[2:]) + "\n"
        return httpx.Response(200, text=body, headers={"content-type": "application/x-ndjson"})

    assert collect(make_client(handler)) == lines                      # blank and garbage lines skipped
    assert seen["url"] == STREAM_URL and seen["body"] == {"question": "laps?", "client": "red"}


def test_a_tern_without_the_stream_endpoint_falls_back_to_one_ask():
    def handler(request):
        if request.url.path == "/ask/stream":
            return httpx.Response(404)
        return httpx.Response(200, json={"answer": "Lap 3 was fastest."})

    assert collect(make_client(handler)) == [{"type": "thinking", "turn": 1},
                                             {"type": "answer", "text": "Lap 3 was fastest."}]


@pytest.mark.parametrize("status,word", [(503, "busy"), (429, "busy"), (409, "busy"), (504, "in time"),
                                         (500, "HTTP 500")])
def test_stream_errors_become_one_error_event(status, word):
    events = collect(make_client(lambda request: httpx.Response(status, text="x")))
    assert len(events) == 1 and events[0]["type"] == "error" and events[0]["status"] == status
    assert word in events[0]["detail"]


def test_an_unreachable_tern_is_an_error_event_not_an_exception():
    def handler(request):
        raise httpx.ConnectError("refused")

    assert collect(make_client(handler)) == [{"type": "error", "status": 502, "detail": "Tern is unreachable"}]
