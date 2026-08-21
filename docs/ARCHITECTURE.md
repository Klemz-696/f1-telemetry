# 🏛️ Architecture & System Design — F1 Telemetry

This document details the internal architecture, event-driven pipelines, caching policies, and communication protocols behind the F1 Telemetry stack.

---

## 1. High-Level Architecture

F1 Telemetry follows a reactive, microservices-inspired architecture designed to deliver sub-second telemetry updates to connected browsers while remaining resilient against upstream rate-limits and network hiccups.

```
                  ┌────────────────────────────────────────┐
                  │          External Data Providers       │
                  │  • F1 Live Timing (SignalR Core WSS)   │
                  │  • OpenF1 REST API                     │
                  │  • Jolpica / Ergast F1 API             │
                  └───────────────────┬────────────────────┘
                                      │
               ┌──────────────────────┴──────────────────────┐
               ▼                                             ▼
     [Direct Live Feed]                            [REST & History Feed]
 ┌────────────────────────┐                    ┌────────────────────────────┐
 │  consumer.py (Python)  │                    │  server.js (Node.js Proxy) │
 │  • Negotiate & Auth    │                    │  • Memory LRU Cache        │
 │  • Zlib decompression  │                    │  • Disk Cache (/cache)     │
 │  • JSON deserializer   │                    │  • Anti-429 Rate Limiter   │
 └─────────────┬──────────┘                    └─────────────┬──────────────┘
               │                                             │
               ▼                                             ▼
 ┌────────────────────────┐                    ┌────────────────────────────┐
 │  InfluxDB v2 (:8086)   │◄───────────────────┤  openf1_sync / standings   │
 │  Bucket: livetiming    │                    │  • Tire stints & telemetry │
 │  Retention: 7 days     │                    │  • Championship standings  │
 └─────────────┬──────────┘                    └─────────────┬──────────────┘
               │                                             │
               └──────────────────────┬──────────────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   FastAPI Server (:8000)  │
                        │   • Broadcast Loop (2 Hz) │
                        │   • State Aggregation     │
                        │   • WebSocket Hub /ws     │
                        └─────────────┬─────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   Nginx Reverse Proxy     │
                        │   • Port 80 / 443 (SSL)   │
                        │   • Rate Limiting         │
                        │   • Static File Server    │
                        └─────────────┬─────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   Web Dashboard (Client)  │
                        │   • SPA Reactive Store    │
                        │   • 17 Modular Components │
                        │   • Web Audio Synth       │
                        └───────────────────────────┘
```

---

## 2. Microservice Components

### 1. Nginx Gateway (`nginx/nginx.conf`)
- Acts as the sole entry point exposed on host ports 80/443.
- Terminates HTTP/WebSocket connections.
- Enforces Content-Security-Policy (CSP), Strict-Transport-Security (HSTS), and XSS protection.
- Applies granular per-IP rate limits (`limit_req_zone` for API, proxy, and static assets).
- Gzip compresses JSON payloads and static scripts.

### 2. Node.js Caching Proxy (`proxy-server/server.js`)
- Dedicated anti-rate-limit layer between external APIs (OpenF1, Jolpica) and internal sync services / browser clients.
- Two-tier cache strategy:
  - **L1 Cache (In-Memory)**: High-speed RAM storage for frequently accessed live state (TTL: 1-5 seconds).
  - **L2 Cache (Disk-backed)**: Persistent storage for historical sessions, track layouts, and lap times (TTL: 24 hours+).
- **Anti-429 Circuit Breaker**: Queues requests with exponential backoff and jitter when upstream APIs return HTTP 429.
- Dynamic cache invalidation via secure `/flush?token=FLUSH_TOKEN` endpoint.

### 3. FastAPI Application (`backend/main.py`)
- Python 3.12 ASGI service running on Uvicorn.
- Runs an asynchronous 2 Hz (`500ms`) broadcast loop polling latest telemetry from InfluxDB.
- Merges raw InfluxDB points with static 2026 driver/team data (`data/f1_2026.py`).
- Broadcasts `BroadcastPayload` JSON messages over `/ws` to all connected clients.
- Provides fallback endpoints: `/api/session-state`, `/api/health`, `/api/static`.

### 4. SignalR Consumer (`backend/consumer.py`)
- Connects to the official Formula 1 Live Timing SignalR Core WebSocket endpoint.
- Handles negotiate handshake, authentication bearer token injection, and heartbeat pings.
- Decompresses Deflate/Zlib and Base64 encoded telemetry frames in real-time (`decoder.py`).
- Writes normalized measurements (`car_data`, `lap_time`, `position`, `race_control`, `weather`) directly into InfluxDB.

### 5. Ingestion Workers
- **`openf1_sync.py`**: Synchronizes tire compound data, pit stops, and weather from OpenF1 API into InfluxDB.
- **`standings_sync.py`**: Fetches Driver and Constructor World Championship points from Jolpica/Ergast and saves snapshots to `/shared/standings.json`.
- **`results_sync.py`**: Pulls historical race and qualifying results into `/shared/results.json`.

---

## 3. Telemetry Channels & Data Model

All telemetry points stored in InfluxDB follow standard schemas defined in `backend/models.py`:

| Measurement | Tags | Fields | Frequency |
| :--- | :--- | :--- | :--- |
| `car_data` | `driver_number`, `session_key` | `speed`, `rpm`, `gear`, `throttle`, `brake`, `drs` | ~4-10 Hz |
| `driver_position` | `driver_number`, `session_key` | `position`, `x`, `y`, `z` | ~2-5 Hz |
| `lap_time` | `driver_number`, `session_key` | `lap_number`, `lap_time`, `s1`, `s2`, `s3`, `is_pit` | On Lap Event |
| `stint` | `driver_number`, `session_key` | `compound`, `stint_number`, `lap_start`, `lap_end` | On Pit Event |
| `race_control` | `session_key` | `flag`, `message`, `category`, `scope` | On Flag Event |
| `weather` | `session_key` | `air_temp`, `track_temp`, `humidity`, `wind_speed`, `rainfall` | ~0.1 Hz |

---

## 4. Frontend Component Design

The frontend is built with pure Vanilla JavaScript (ES6 Modules) and CSS3 Custom Properties:
- **`store.js`**: Centralized reactive state store using a publisher/subscriber event bus.
- **`api.js`**: Resilient client-side networking layer with auto-reconnecting WebSocket, retry queues, and fallback switching.
- **Components** (`frontend/js/components/`):
  - `timing_tower.js`: Multi-column timing leaderboard.
  - `tracker_map.js`: Canvas & SVG 2D/3D car positioning engine.
  - `simulation.js`: Deterministic race simulation & playback engine.
  - `sound_engine.js`: Web Audio API sound synthesizer.
  - `overlay_manager.js`: Transparent broadcast graphics for OBS.
  - `calendar.js`, `results.js`, `standings.js`, `circuits.js`, `commentary.js`, `evolution.js`, `live_events.js`, `settings.js`.
