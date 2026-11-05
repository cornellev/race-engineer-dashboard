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
