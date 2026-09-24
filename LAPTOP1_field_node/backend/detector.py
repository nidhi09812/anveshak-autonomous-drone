import cv2
import numpy as np
import onnxruntime as ort

from backend.config import (
    MODEL_PATH,
    CLASS_NAMES,
    CONFIDENCE_THRESHOLD
)

INPUT_SIZE = 640
NMS_IOU_THRESHOLD = 0.45


class SARDetector:
    """Runs the trained YOLOv8 model (exported to ONNX) via onnxruntime.

    Swapped from ultralytics/torch to onnxruntime purely to fit low-memory
    hosting (Render's free 512MB tier OOM-killed the torch-based version);
    the pre/postprocessing below reimplements what ultralytics normally
    does internally (letterbox resize, decode raw output, NMS, box
    rescale) so the rest of the app sees an identical interface.
    """

    def __init__(self):
        print("Loading ONNX model...")
        self.session = ort.InferenceSession(
            MODEL_PATH,
            providers=["CPUExecutionProvider"]
        )
        self.input_name = self.session.get_inputs()[0].name
        print("ONNX model loaded successfully.")

    def _letterbox(self, frame):
        h, w = frame.shape[:2]
        scale = min(INPUT_SIZE / h, INPUT_SIZE / w)
        new_h, new_w = round(h * scale), round(w * scale)
        resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        pad_h, pad_w = INPUT_SIZE - new_h, INPUT_SIZE - new_w
        top, bottom = pad_h // 2, pad_h - pad_h // 2
        left, right = pad_w // 2, pad_w - pad_w // 2

        padded = cv2.copyMakeBorder(
            resized, top, bottom, left, right,
            cv2.BORDER_CONSTANT, value=(114, 114, 114)
        )
        return padded, scale, left, top

    def detect(self, frame):
        """
        Return detections as Python dictionaries.
        """
        padded, scale, pad_left, pad_top = self._letterbox(frame)

        blob = padded[:, :, ::-1].astype(np.float32) / 255.0
        blob = blob.transpose(2, 0, 1)[np.newaxis, :]

        output = self.session.run(None, {self.input_name: blob})[0]

        # output shape: (1, 4 + num_classes, num_boxes) -> (num_boxes, 4 + num_classes)
        predictions = output[0].transpose(1, 0)

        boxes_xywh = predictions[:, :4]
        class_scores = predictions[:, 4:]
        class_ids = np.argmax(class_scores, axis=1)
        confidences = class_scores[np.arange(len(class_scores)), class_ids]

        allowed_classes = set(CLASS_NAMES.keys())
        keep = (confidences >= CONFIDENCE_THRESHOLD) & np.isin(class_ids, list(allowed_classes))

        boxes_xywh = boxes_xywh[keep]
        class_ids = class_ids[keep]
        confidences = confidences[keep]

        detections = []
        if len(boxes_xywh) == 0:
            return detections

        # cx, cy, w, h -> x1, y1, x2, y2 (still in padded/model input space)
        cx, cy, w, h = boxes_xywh[:, 0], boxes_xywh[:, 1], boxes_xywh[:, 2], boxes_xywh[:, 3]
        x1 = cx - w / 2
        y1 = cy - h / 2
        boxes_xyxy = np.stack([x1, y1, w, h], axis=1)  # x, y, w, h for cv2.dnn.NMSBoxes

        indices = cv2.dnn.NMSBoxes(
            boxes_xyxy.tolist(),
            confidences.tolist(),
            CONFIDENCE_THRESHOLD,
            NMS_IOU_THRESHOLD
        )
        if len(indices) == 0:
            return detections
        indices = np.array(indices).flatten()

        frame_h, frame_w = frame.shape[:2]

        for i in indices:
            bx1 = (x1[i] - pad_left) / scale
            by1 = (y1[i] - pad_top) / scale
            bx2 = (x1[i] + w[i] - pad_left) / scale
            by2 = (y1[i] + h[i] - pad_top) / scale

            bx1 = int(np.clip(bx1, 0, frame_w))
            by1 = int(np.clip(by1, 0, frame_h))
            bx2 = int(np.clip(bx2, 0, frame_w))
            by2 = int(np.clip(by2, 0, frame_h))

            class_id = int(class_ids[i])
            detections.append({
                "class_id": class_id,
                "class": CLASS_NAMES.get(class_id, str(class_id)),
                "confidence": round(float(confidences[i]), 3),
                "bbox": [bx1, by1, bx2, by2]
            })

        return detections

    def annotate(self, detections, frame):
        """
        Draw bounding boxes + labels on a copy of the frame.
        """
        annotated = frame.copy()
        for d in detections:
            x1, y1, x2, y2 = d["bbox"]
            label = f'{d["class"]} {d["confidence"] * 100:.0f}%'

            cv2.rectangle(annotated, (x1, y1), (x2, y2), (56, 189, 248), 2)

            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(annotated, (x1, max(0, y1 - th - 8)), (x1 + tw + 4, y1), (56, 189, 248), -1)
            cv2.putText(
                annotated, label, (x1 + 2, max(12, y1 - 5)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (10, 10, 10), 1, cv2.LINE_AA
            )
        return annotated
