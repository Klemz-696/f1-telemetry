# 💻 Local Development Guide

This guide explains how to run, test, and contribute to F1 Telemetry components individually on your local machine without requiring a full Docker deployment.

---

## 🏗️ Repository Layout

```
f1-telemetry/
├── backend/            → Python FastAPI middleware & ingestion workers
│   ├── main.py         → FastAPI application & WebSocket broadcast loop
│   ├── consumer.py     → SignalR live stream ingestion client
│   ├── influx_client.py→ InfluxDB v2 async connector
│   ├── decoder.py      → Base64/Zlib stream decompression
│   ├── models.py       → Pydantic data schemas
│   └── data/           → 2026 season database
├── proxy-server/       → Node.js caching & anti-rate-limit proxy
│   └── server.js       → In-memory & disk caching reverse proxy
├── frontend/           → Pure Vanilla JS & CSS3 Dashboard SPA
│   ├── index.html      → SPA entry point
│   ├── css/style.css   → Design system & styling
│   └── js/components/  → 17 UI components
├── tests/              → Automated test suite
└── nginx/              → Production Nginx configuration
```

---

## 🐍 1. Running the Backend Locally

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start FastAPI development server with hot-reload
uvicorn main:app --reload --port 8000
```

---

## ⚡ 2. Running the Cache Proxy

```bash
cd proxy-server

# Zero external npm dependencies!
# Start proxy with auto-reload (Node 18+)
node --watch server.js
```

---

## 🖥️ 3. Serving the Frontend

You can serve the `frontend/` directory with any static web server:

```bash
# Using Python
cd frontend
python -m http.server 3000

# Or using Node http-server / npx serve
npx serve frontend
```

---

## 🧪 4. Running the Test Suite

```bash
# From repository root
pytest tests/ -v
```
