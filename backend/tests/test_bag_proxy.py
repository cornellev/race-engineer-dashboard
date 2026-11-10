"""The record button's path: RED's /bag/start|stop|status forward to the car's bag service
(tailscale-ros-telemetry api/server.py). BAG_SERVICE_URL points it elsewhere (mock-daq's bag
service in the end-to-end stack); otherwise TAILSCALE_IP on ROSBAG_API_PORT (default 8080).

main.py imports rclpy and rosbags at module level, so they are stubbed here: these tests
need only fastapi + httpx, not a ROS install. The lifespan (ROS spin) is not started."""

import http.server
import json
import sys
import threading
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _stub_ros():
    for name in ("rclpy", "rclpy.executors", "rclpy.node", "std_msgs", "std_msgs.msg", "subscriber",
                 "rosbag_replay"):
        sys.modules.setdefault(name, types.ModuleType(name))
    sys.modules["rclpy.executors"].SingleThreadedExecutor = object
    sys.modules["subscriber"].DataSubscriber = object
    sys.modules["rosbag_replay"].parse_rosbag_to_csv_rows = lambda path: ([], [])


@pytest.fixture
def main_module():
    _stub_ros()
    import main
    return main


@pytest.fixture
def bag_service():
    """A tiny stand-in with the real service's status shapes; records the calls it gets."""
    calls = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def _reply(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            calls.append(("GET", self.path))
            self._reply(200, {"id": "c1", "name": "rosbag", "status": "running"})

        def do_POST(self):
            calls.append(("POST", self.path))
            self._reply(200, {"id": "c1", "name": "rosbag", "status": "running", "action": "started"})

        def log_message(self, *a):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}", calls
    server.shutdown()


def test_default_is_the_car_on_port_8080(main_module, monkeypatch):
    monkeypatch.delenv("BAG_SERVICE_URL", raising=False)
    monkeypatch.delenv("ROSBAG_API_PORT", raising=False)
    monkeypatch.setenv("TAILSCALE_IP", "100.110.98.26")
    assert main_module.get_remote_bag_base_url() == "http://100.110.98.26:8080"


def test_rosbag_api_port_is_honoured(main_module, monkeypatch):
    monkeypatch.delenv("BAG_SERVICE_URL", raising=False)
    monkeypatch.setenv("TAILSCALE_IP", "100.110.98.26")
    monkeypatch.setenv("ROSBAG_API_PORT", "9090")
    assert main_module.get_remote_bag_base_url() == "http://100.110.98.26:9090"


def test_bag_service_url_wins(main_module, monkeypatch):
    monkeypatch.setenv("TAILSCALE_IP", "100.110.98.26")
    monkeypatch.setenv("BAG_SERVICE_URL", "http://mock-bag-service:8080/")
    assert main_module.get_remote_bag_base_url() == "http://mock-bag-service:8080"


def test_the_record_button_endpoints_reach_the_bag_service(main_module, monkeypatch, bag_service):
    from fastapi.testclient import TestClient

    url, calls = bag_service
    monkeypatch.setenv("BAG_SERVICE_URL", url)
    client = TestClient(main_module.app)          # no `with`: the ROS lifespan is not started
    assert client.post("/bag/start").json()["action"] == "started"
    assert client.get("/bag/status").json()["status"] == "running"
    client.post("/bag/stop")
    assert calls == [("POST", "/bag/start"), ("GET", "/bag/status"), ("POST", "/bag/stop")]
