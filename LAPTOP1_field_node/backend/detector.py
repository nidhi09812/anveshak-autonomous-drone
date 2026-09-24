from ultralytics import YOLO

from backend.config import (
    MODEL_PATH,
    CLASS_NAMES,
    CONFIDENCE_THRESHOLD
)


class SARDetector:

    def __init__(self):
        print("Loading YOLO model...")

        self.model = YOLO(MODEL_PATH)

        print("YOLO model loaded successfully.")

    def predict(self, frame):
        """
        Run YOLO detection on an image.
        """

        results = self.model.predict(
            source=frame,
            conf=CONFIDENCE_THRESHOLD,
            classes=list(CLASS_NAMES.keys()),
            verbose=False
        )

        return results[0]

    def detect(self, frame):
        """
        Return detections as Python dictionaries.
        """

        result = self.predict(frame)

        detections = []

        if result.boxes is None:
            return detections

        for box in result.boxes:

            class_id = int(box.cls[0].item())

            confidence = float(
                box.conf[0].item()
            )

            x1, y1, x2, y2 = (
                box.xyxy[0]
                .cpu()
                .numpy()
                .astype(int)
            )

            class_name = CLASS_NAMES.get(
                class_id,
                str(class_id)
            )

            detections.append({
                "class_id": class_id,
                "class": class_name,
                "confidence": round(confidence, 3),
                "bbox": [
                    int(x1),
                    int(y1),
                    int(x2),
                    int(y2)
                ]
            })

        return detections

    def annotate(self, result):
        """
        Draw YOLO bounding boxes on image.
        """

        return result.plot()