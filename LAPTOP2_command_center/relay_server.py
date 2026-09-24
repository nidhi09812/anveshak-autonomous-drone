"""
ANVESHAK — LAPTOP 2 RELAY SERVER
==================================
This is the bridge between Laptop 1 (the AI) and the React dashboard
(the map) you see in your browser. It has two doors:

  DOOR 1  /ws       The React dashboard (frontend/) connects here over a
                     WebSocket to receive live detection alerts the
                     instant they arrive — no polling.

  DOOR 2  /trigger   Laptop 1's backend POSTs each detection here as plain
                     JSON. Whatever JSON it sends gets broadcast, as-is,
                     to every dashboard connected on Door 1.

RUN:
  python -m uvicorn relay_server:app --host 0.0.0.0 --port 8000
"""
from fastapi import FastAPI, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Anveshak Relay")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Every dashboard browser tab currently connected to /ws.
connected_dashboards = []


@app.get("/")
async def home():
    return {"status": "relay running", "connected_dashboards": len(connected_dashboards)}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_dashboards.append(websocket)
    print("[relay] dashboard connected, waiting for alerts...")

    try:
        while True:
            # We don't expect the dashboard to send anything, but we must
            # keep calling receive() to detect when it disconnects.
            await websocket.receive_text()
    except Exception:
        if websocket in connected_dashboards:
            connected_dashboards.remove(websocket)
        print("[relay] dashboard disconnected")


@app.post("/trigger")
async def trigger_alert(request: Request):
    event = await request.json()
    print(f"[relay] alert received: {event.get('type')} "
          f"({len(event.get('detections', []))} detections)")

    if not connected_dashboards:
        print("[relay] warning: no dashboard connected, alert not seen live")

    dead = []
    for dashboard in connected_dashboards:
        try:
            await dashboard.send_json(event)
        except Exception:
            dead.append(dashboard)
    for dashboard in dead:
        connected_dashboards.remove(dashboard)

    return {"status": "success", "reached_dashboards": len(connected_dashboards)}
