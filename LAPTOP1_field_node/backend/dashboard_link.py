"""
Forwards a completed detection to LAPTOP 2's relay server
(../LAPTOP2_command_center/relay_server.py), so the rescue team's map
dashboard updates the instant this laptop finds something.

The relay expects a plain HTTP POST to /trigger with the JSON shape
documented in the project's Map + Safe-Path spec, plus the annotated
result image (base64 JPEG) so LAPTOP2's dashboard can show the same
picture Laptop 1 saw — Laptop 1 itself no longer displays it:

    {
      "type": "detection_update",
      "timestamp": "...",
      "detections": [{"class_name": "...", "unified_class": "person|fire|flood|vehicle",
                       "confidence": 91.2, "bbox": [x1, y1, x2, y2]}],
      "counts": {"person": 2, "fire": 0, "flood": 0, "vehicle": 0},
      "max_confidence": 91.2,
      "using_trained_model": true,
      "image": "<base64 JPEG, boxes already drawn>"
    }

It then broadcasts that same JSON, unmodified, to every dashboard
browser connected over its own /ws — see relay_server.py.
"""
import json
import os

import requests

from backend.config import DASHBOARD_URL, MODEL_PATH

OFFLINE_QUEUE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "offline_queue.jsonl",
)

# Our own trained checkpoint ships as best.pt right next to this backend;
# if MODEL_PATH ever falls back to something else (e.g. a stock
# yolov8n.pt during setup), the dashboard is told so it can flag that
# fire/flood detection isn't available yet.
USING_TRAINED_MODEL = os.path.basename(MODEL_PATH) == "best.onnx"


def build_dashboard_event(drishti_response: dict) -> dict:
    """Translate Project Drishti's /detect response into the Map +
    Safe-Path data contract LAPTOP2's dashboard expects."""
    detections = drishti_response.get("detections", [])

    counts = {"person": 0, "fire": 0, "flood": 0, "vehicle": 0}
    max_confidence = 0.0
    contract_detections = []

    for d in detections:
        unified_class = d.get("class", "unknown")
        confidence = round(float(d.get("confidence", 0)) * 100, 1)

        if unified_class in counts:
            counts[unified_class] += 1
        max_confidence = max(max_confidence, confidence)

        contract_detections.append({
            "class_name": unified_class,
            "unified_class": unified_class,
            "confidence": confidence,
            "bbox": d.get("bbox", []),
        })

    return {
        "type": "detection_update",
        "timestamp": drishti_response.get("timestamp"),
        "detections": contract_detections,
        "counts": counts,
        "max_confidence": max_confidence,
        "using_trained_model": USING_TRAINED_MODEL,
        "image": drishti_response.get("image", ""),
    }


def _post(event: dict) -> bool:
    try:
        resp = requests.post(f"{DASHBOARD_URL}/trigger", json=event, timeout=4)
        return resp.status_code == 200
    except requests.exceptions.RequestException:
        return False


def flush_offline_queue():
    if not os.path.exists(OFFLINE_QUEUE_FILE):
        return
    with open(OFFLINE_QUEUE_FILE, "r") as f:
        lines = f.readlines()
    if not lines:
        return
    remaining = []
    for line in lines:
        event = json.loads(line)
        if not _post(event):
            remaining.append(line)
    with open(OFFLINE_QUEUE_FILE, "w") as f:
        f.writelines(remaining)
    print(f"[dashboard] offline queue: tried {len(lines)}, {len(remaining)} still pending")


def queue_offline(event: dict):
    with open(OFFLINE_QUEUE_FILE, "a") as f:
        f.write(json.dumps(event) + "\n")


def send_to_dashboard(event: dict):
    """Blocking call — run this off the event loop (e.g. via
    asyncio.to_thread) so it never stalls the /detect response."""
    flush_offline_queue()
    if not _post(event):
        print("[dashboard] relay unreachable, saving to offline queue")
        queue_offline(event)
