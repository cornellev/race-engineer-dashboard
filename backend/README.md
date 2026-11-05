# Backend

FastAPI service that subscribes to the ROS 2 `spi_data` topic and streams snapshots to the frontend over WebSocket. It also proxies rosbag control requests and forwards questions to Tern (tern-llm).

## Running the backend

### Local development

Run from the `backend/` directory:

```bash
pip install -r requirements.txt
source /opt/ros/humble/setup.bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

The backend needs access to the ROS 2 `spi_data` topic and the correct discovery configuration.

### Docker

From the project root:

```bash
docker compose up --build
```

The backend shares the Tailscale service network and is exposed on port `8000`.

## Main endpoints

- `GET /` basic health response
- `WS /ws/stream` live telemetry stream for the frontend
- `POST /tern` asks Tern (tern-llm on thor) a question (`{"question": "..."}`, or a default "most recent run" question if omitted) and returns `{"answer": ...}`; Tern busy -> 503 with `Retry-After`. Any telemetry sent is ignored
- `POST /bag/start`, `POST /bag/stop`, and `GET /bag/status` proxy rosbag controls
- `GET /healthz` reports backend and remote bag-service health

## Environment

- `ROS_DOMAIN_ID` must match the publisher's DDS domain
- `ROS_LOCALHOST_ONLY` controls whether ROS discovery is localhost-only
- `DISCOVERY_SERVER_IP` is used for Fast DDS discovery setup in Docker
- `TAILSCALE_IP` is used for remote rosbag API requests
- `TERN_LLM_URL` is tern-llm's `/ask` endpoint (default `http://100.94.168.56:8000/ask`, the Jetson Thor)
- `TERN_LLM_CONNECT_TIMEOUT_SEC` (3), `TERN_LLM_RESPONSE_TIMEOUT_SEC` (70, just above tern-llm's own 60s cap), `TERN_LLM_CONNECT_RETRIES` (3, connection failures only), and `TERN_LLM_DEFAULT_QUESTION` tune the bridge
