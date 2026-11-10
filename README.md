# Race Engineer Dashboard

## Team Members

Donte & Adi

---

![Live Dashboard Image](frontend/public/LiveRED.png)

---

## Summary

Live telemetry and analysis for the car: sensor streams (with filtering), derived run metrics, optional **Tern** answers in a sidebar, and a browser-based replay mode for uploaded telemetry exports.

**Sensor views**

- **Speed** time series, live, and max value
- **Power** time series (calculated from current and voltage data)
- **GPS** location display with Google Maps
- Live **Steering** angle, **Brake** pressure, **Throttle**, and **RPM** on all wheels
- Timestamps and stopwatch for lap and race timing

**Replay tools**

- Upload a telemetry **CSV** export and replay it directly in the dashboard UI
- Scrub through samples with a timeline slider or play/pause the run at multiple playback speeds
- Reuse the same dashboard widgets in **Replay** mode to inspect historical data sample-by-sample

**Derived metrics**

- **Distance** calculated from aggregating GPS data
- **Energy Use** calculated from power
- **Efficiency** instantaneous and average over a run

**Tern**

- Configurable manual or automatic questions to Tern, the team's assistant over EVIL's
  recorded and live run data (laps, turns, energy, efficiency)

---

## Getting Started

1. **Running the Project**

   Create a `.env` file in the the root directory (not under `/backend` or `/frontend`).
   See `.env.example` for more info.

   Make sure Docker containers and volumes for this project are not running already.
   Then, run `docker compose up --build` to get all containers running.

   The frontend client UI should be running on `port 3000`.  
   The backend healthcheck endpoint is on the root of `port 8000`.

   Tern runs on thor and is reached over the tailnet (`TERN_LLM_URL`). The browser
   reaches the backend on port 8000 of whatever host served the page; set
   `VITE_BACKEND_URL` to point it somewhere else.

2. **Frontend Testing**

   Refer to `frontend/README.md` for more information.  
   **[Bun Installation](https://bun.com/docs/installation)**: The frontend uses **Bun** instead of **NodeJS** as a package manager
   and runtime. The installation is linked [here](https://bun.com/docs/installation). Then, run the following commands in the
   terminal to test/run the frontend in isolation.  
   This will start the frontend development environment with HMR and Vite at `port 5173`.

   ```bash
   cd frontend
   bun dev
   ```

   **Google Maps**: To get location data and Google Maps properly displaying while
   running only the frontend with `bun dev`,
   create a `.env` file in the `/frontend` directory. Follow the `.env.example` in the
   `/frontend` and create the environment variables below.

   ```env
   VITE_GOOGLE_MAPS_API_KEY=<Your Google Maps API Key here>
   VITE_GOOGLE_MAP_ID=<Your Google Maps Map ID from Google Cloud console>
   ```

   Instructions for getting your own `API_KEY` and `MAP_ID` are in `frontend/README.md`.

3. **Backend Troubleshooting**

   Refer to `backend/README.md`.

<video src="frontend/public/LiveRED.mp4" loop muted autoplay></video>

---

## ROS Subscriber Data

For the ROS2 subscriber, first get the ROS2 publisher IP address from:

```sh
ssh cev@<daq tailscale ip> "docker exec ts-authkey-container tailscale ip" | head -n1
```

Make sure this matches the ip in the `docker-compose.yml` file.

We set it manually, not via env var, because the publisher IP should not change.

## Tern Integration

The sidebar asks **Tern** (tern-llm on thor) through the backend's `POST /tern`. Tern answers
from EVIL's data, including the run being recorded right now, so the dashboard machine only
needs to reach thor over the tailnet.

As mentioned above, there are two modes for requesting responses on the sidebar.

- Manually request LLM responses (5s buffer between responses)
- Automatically request and display LLM responses based on a set frequency >5s

---

## Replay Mode

The frontend includes a dedicated **Replay** page alongside the live **Data** view.
Use it to inspect telemetry exports without needing a live ROS2 stream.

### Current capabilities

- Upload a `.csv` telemetry file from the Replay page
- Upload a rosbag2 SQLite `.db3` file from the Replay page
- Play, pause, reset, and scrub through the uploaded run
- Change playback speed from `0.5x` up to `100x`
- Render replayed samples through the same dashboard layout used for live telemetry

### CSV expectations

CSV replay is parsed entirely in the frontend and is intentionally flexible about
column names. Headers are normalized by lowercasing and removing punctuation, so
both flat and dotted names are accepted.

Examples of supported fields include:

- `speed`, `speed_mps`, `gps.speed`, `velocity`
- `filtered.speed`
- `gps.lat`, `gps.long`, `latitude`, `longitude`
- `power.current`, `power.voltage`
- `steering.turn_angle`, `steering.brake_pressure`
- `motor.rpm`, `motor.duty_cycle`
- `rpm_front.left`, `rpm_front.right`, `rpm_back.left`, `rpm_back.right`
- `global_ts`, `timestamp`, `time`, or a row index fallback when timestamps are missing

If a speed column name includes `mph`, the replay parser converts it to meters per
second before rendering. If GPS coordinates are missing, the dashboard falls back
to default coordinates and shows a warning after upload.

### ROSBag expectations

ROS bag replay currently supports rosbag2 SQLite `.db3` files and converts them
through the backend into flattened CSV-style telemetry rows before rendering.
Replayable messages should contain JSON payloads, like the example bag files
under `frontend/data`. Messages that cannot be converted into telemetry rows are
skipped during import.

<video src="frontend/public/ReplayRED.mp4" loop muted autoplay></video>

---

## System Overview

```
ROS2 Sensors → Backend (Python + ROS2) → WebSocket Stream → Frontend (React + TypeScript + Bun)
                                          ↓
                                  Tern (via POST /tern)

Uploaded CSV → Frontend Replay Parser → Replay Timeline → Shared Dashboard Widgets
Uploaded ROS bag `.db3` → Backend Bag Parser → Replay Timeline → Shared Dashboard Widgets
```

---

## Tern Integration Flow

Tern is an **on-demand analysis layer**.

1. The frontend sends a request to the backend's `POST /tern`
2. The backend forwards a question to tern-llm's `/ask` on thor, as client `red` (RED gets a
   priority lane in Tern's queue, and "now / this lap" questions go to the run being recorded)
3. Tern looks the numbers up in EVIL and returns `{"answer": ...}`
4. The backend relays it to the frontend (Tern busy -> 503 with `Retry-After`)
5. The frontend displays the result in the sidebar (manual or automatic modes)

---

## ROSbag + Remote Data Handling

- The frontend can trigger ROSbag recording via `/bag` endpoints
- The backend communicates with the DAQ machine through **Tailscale**
- ROSbag files are stored remotely for later analysis and replay
- Local dashboard replay supports uploaded CSV telemetry exports and rosbag2 SQLite `.db3` files
