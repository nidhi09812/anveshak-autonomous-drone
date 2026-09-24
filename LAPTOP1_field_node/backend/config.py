import os
from pathlib import Path


# Project root
BASE_DIR = Path(__file__).resolve().parent.parent


# Trained YOLO model.
# Override with the DRISHTI_MODEL_PATH env var to point at a different
# checkpoint (e.g. a fresh training run's best.pt) without editing code.
MODEL_PATH = os.environ.get(
    "DRISHTI_MODEL_PATH",
    str(BASE_DIR / "best.onnx")
)


# Only class we detect
CLASS_NAMES = {
    0: "person"
}


# Detection confidence
CONFIDENCE_THRESHOLD = 0.15


# Laptop 2's relay server base URL (relay_server.py, NOT the Vite
# frontend's own port). Override with the DASHBOARD_URL env var to point
# at your friend's actual LAN IP, e.g.
#   set DASHBOARD_URL=http://192.168.1.20:8000   (Windows)
#   export DASHBOARD_URL=http://192.168.1.20:8000  (Mac/Linux)
DASHBOARD_URL = os.environ.get(
    "DASHBOARD_URL",
    "http://127.0.0.1:8000"
)