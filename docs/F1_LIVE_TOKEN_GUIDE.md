# 🔑 F1 Live Timing Bearer Token Capture Guide

> **Note**: Setting up the official F1 TV Bearer Token is **100% optional**. If left empty, F1 Telemetry automatically operates in **Auto / OpenF1 / Simulation / Archive** mode with full telemetry features enabled.

If you have an active F1 TV account and want to feed the real-time SignalR live timing stream during official sessions, follow this step-by-step procedure:

---

## 🛠️ Step-by-Step Instructions

1. **Open your browser** (Chrome, Firefox, Edge, or Brave).
2. Navigate to: **[https://www.formula1.com/en/timing/f1-live](https://www.formula1.com/en/timing/f1-live)**.
3. Log in with your F1 TV account if prompted.
4. Press **F12** (or right-click anywhere and select **Inspect**) to open Developer Tools.
5. Click on the **Network** (Réseau) tab.
6. In the filter box, type **`signalrcore`** or **`negotiate`**.
7. Reload the live timing page.
8. Look for a network request towards `/signalrcore/negotiate` or a WebSocket handshake.
9. Click on the request and check the **Request Headers**:
   - Locate the header: `Authorization: Bearer <TOKEN_VALUE>`
10. Copy the long token string (it is a standard JWT with 3 parts separated by dots).
11. Paste the value in your `.env` file:
   ```env
   F1_AUTH_TOKEN=eyJraWQiOiIxIiwidHlwIjoiSldUIiwiYWxnIjoiUlMyNTYifQ...
   ```
12. Restart the consumer service:
   ```bash
   docker compose restart consumer
   ```

---

## 🔄 Token Expiration
- Official F1 TV bearer tokens typically remain valid for several days.
- If the token expires during a race weekend, `consumer.py` will log a notice and gracefully fallback to OpenF1 / Polling mode without crashing the dashboard.
