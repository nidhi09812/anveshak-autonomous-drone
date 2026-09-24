import asyncio

from fastapi import (
    FastAPI,
    UploadFile,
    File,
    WebSocket
)

from fastapi.middleware.cors import CORSMiddleware

import cv2
import numpy as np
import base64
from datetime import datetime, timezone

from backend.detector import SARDetector

from backend.database import (
    initialize_database,
    save_detection
)

from backend.websocket_manager import (
    ConnectionManager
)

from backend.dashboard_link import (
    build_dashboard_event,
    send_to_dashboard
)


# --------------------------------------------------
# FastAPI application
# --------------------------------------------------

app = FastAPI(
    title="Project Anveshak Backend",
    version="1.0"
)


# --------------------------------------------------
# CORS
# --------------------------------------------------

app.add_middleware(
    CORSMiddleware,

    allow_origins=["*"],

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],
)


# --------------------------------------------------
# Initialize database
# --------------------------------------------------

initialize_database()


# --------------------------------------------------
# Load YOLO
# --------------------------------------------------

print("Loading YOLO detector...")

detector = SARDetector()

print("YOLO detector loaded.")


# --------------------------------------------------
# WebSocket manager (kept for MapView's own live map view;
# not used to reach Laptop 2 — see dashboard_link below)
# --------------------------------------------------

manager = ConnectionManager()


# --------------------------------------------------
# Home
# --------------------------------------------------

@app.get("/")
async def home():

    return {
        "project": "Project Anveshak",
        "status": "Backend running",
        "message": "AI Search and Rescue backend is ready"
    }


# --------------------------------------------------
# Health check
# --------------------------------------------------

@app.get("/health")
async def health():

    return {
        "status": "healthy",
        "ai_model": "loaded"
    }


# --------------------------------------------------
# Image detection
# --------------------------------------------------

@app.post("/detect")
async def detect_image(
    file: UploadFile = File(...)
):

    # Read uploaded file
    image_bytes = await file.read()

    # Convert bytes to NumPy array
    image_array = np.frombuffer(
        image_bytes,
        np.uint8
    )

    # Convert to OpenCV image
    frame = cv2.imdecode(
        image_array,
        cv2.IMREAD_COLOR
    )

    # Check image
    if frame is None:

        return {
            "success": False,
            "error": "Could not read uploaded image"
        }

    # ----------------------------------------------
    # YOLO detection
    # ----------------------------------------------

    result = detector.predict(frame)

    detections = detector.detect(frame)

    # ----------------------------------------------
    # Draw bounding boxes
    # ----------------------------------------------

    annotated = detector.annotate(result)

    # ----------------------------------------------
    # Convert image to JPEG
    # ----------------------------------------------

    success, encoded_image = cv2.imencode(
        ".jpg",
        annotated
    )

    if not success:

        return {
            "success": False,
            "error": "Could not encode result image"
        }

    # ----------------------------------------------
    # Convert JPEG to Base64
    # ----------------------------------------------

    image_base64 = base64.b64encode(
        encoded_image.tobytes()
    ).decode("utf-8")

    # ----------------------------------------------
    # Timestamp
    # ----------------------------------------------

    timestamp = datetime.now(
        timezone.utc
    ).isoformat()

    # ----------------------------------------------
    # Save detection in database
    # ----------------------------------------------

    save_detection(
        filename=file.filename,
        timestamp=timestamp,
        detection_count=len(detections),
        detections=detections
    )

    # ----------------------------------------------
    # Send result
    # ----------------------------------------------

    response = {

        "success": True,

        "filename": file.filename,

        "timestamp": timestamp,

        "count": len(detections),

        "detections": detections,

        "image": image_base64
    }

    # ----------------------------------------------
    # Forward this detection to LAPTOP 2's dashboard
    # (blocking websocket I/O, run off the event loop)
    # ----------------------------------------------

    dashboard_event = build_dashboard_event(response)
    await asyncio.to_thread(send_to_dashboard, dashboard_event)

    return response


# --------------------------------------------------
# WebSocket
# --------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket
):

    await manager.connect(websocket)

    try:

        while True:

            await websocket.receive_text()

    except Exception:

        manager.disconnect(websocket)