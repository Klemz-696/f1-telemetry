# 📡 REST & WebSocket API Reference — F1 Telemetry

This document provides technical documentation for all internal REST endpoints and WebSocket protocols exposed by the F1 Telemetry backend and caching proxy.

---

## 1. FastAPI Backend Endpoints (`/api/*` and `/ws`)

The FastAPI service runs on port `8000` (routed via `/api/` by Nginx).

### `GET /health`
- **Description**: Health check endpoint used by Docker and monitoring agents.
- **Response**: `200 OK`
```json
{
  "status": "ok",
  "version": "2.0.0",
  "influx_connected": true
}
```

### `GET /session-state`
- **Description**: Returns the current session status, live flags, circuit information, and active mode.
- **Response**: `200 OK`
```json
{
  "session_key": "latest",
  "session_name": "Race",
  "circuit_key": "barcelona",
  "circuit_short_name": "Catalunya",
  "is_live": true,
  "flag": "GREEN",
  "track_temp": 38.5,
  "air_temp": 24.2
}
```

### `GET /static`
- **Description**: Returns the complete 2026 season database (drivers, liveries, team colors, calendar).
- **Response**: `200 OK`
```json
{
  "drivers": {
    "1": { "name": "Max Verstappen", "code": "VER", "team": "Red Bull Racing", "color": "#3671C6" }
  },
  "teams": {
    "red_bull": { "name": "Red Bull Racing", "color": "#3671C6" }
  }
}
```

### `WS /ws`
- **Description**: High-frequency real-time telemetry WebSocket stream (2 Hz broadcast).
- **Protocol**: JSON `BroadcastPayload`
- **Message Format**:
```json
{
  "timestamp": 1780000000.5,
  "session": {
    "key": "11307",
    "name": "Race",
    "status": "STARTED",
    "lap_current": 24,
    "lap_total": 66
  },
  "drivers": [
    {
      "driver_number": 1,
      "position": 1,
      "gap_to_leader": "+0.000",
      "interval": "+0.000",
      "last_lap_time": "1:18.234",
      "best_lap_time": "1:17.890",
      "compound": "HARD",
      "tire_age": 14,
      "speed": 312,
      "rpm": 11800,
      "gear": 8,
      "drs": 1,
      "x": 1240.5,
      "y": -850.2,
      "z": 12.0
    }
  ],
  "race_control": [
    {
      "timestamp": 1780000000.0,
      "category": "Flag",
      "flag": "GREEN",
      "message": "TRACK CLEAR"
    }
  ]
}
```

---

## 2. Caching Proxy Endpoints (`/proxy/*` and `/proxy/ws`)

The Node.js proxy runs on port `3001` (routed via `/proxy/` by Nginx).

### `GET /proxy/status`
- **Description**: Returns cache hit/miss statistics, memory usage, and circuit breaker status.
- **Response**: `200 OK`
```json
{
  "ok": true,
  "uptime_seconds": 3600,
  "memory_cache_entries": 142,
  "disk_cache_entries": 89,
  "circuit_breaker": "CLOSED",
  "rate_limit_hits": 0
}
```

### `GET /proxy/openf1/*`
- **Description**: Proxies queries to the OpenF1 API with local disk caching and anti-429 retry loops.
- **Example**: `GET /proxy/openf1/laps?session_key=latest&driver_number=1`

### `GET /proxy/jolpica/*`
- **Description**: Proxies queries to the Jolpica/Ergast F1 API.
- **Example**: `GET /proxy/jolpica/ergast/f1/2026/driverStandings.json`

### `POST /proxy/flush?token=<FLUSH_TOKEN>`
- **Description**: Purges all in-memory LRU items and disk cache files.
- **Header/Query Param**: Requires `token` matching `FLUSH_TOKEN` in `.env`.
- **Response**: `200 OK`
```json
{ "cleared": true, "entries_removed": 142 }
```
