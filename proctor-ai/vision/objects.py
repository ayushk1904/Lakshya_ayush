"""YOLOv8s object detection through OpenCV's DNN module (no PyTorch needed at runtime).

The model is the Ultralytics YOLOv8s COCO checkpoint exported to ONNX at 640x640
(see scripts/export_yolo.py). Only the classes that matter for exam proctoring are kept.

Why v8s at 640: on COCO128, YOLOv8n at 320 found 0/5 phones and 0/6 books; v8s at 640 found
4/5 phones and 5/6 books with no false alarms in the other images.
"""

from dataclasses import dataclass

import cv2
import numpy as np

# COCO class id -> (label, minimum confidence). People need higher confidence to avoid
# counting posters or reflections as a second person; phones and books are small and often
# partly hidden by hands, so they need less.
TRACKED_CLASSES = {
    0: ("person", 0.50),
    67: ("cell phone", 0.25),
    73: ("book", 0.25),
    63: ("laptop", 0.45),
}
NMS_THRESHOLD = 0.45
# Small objects get extra zoomed passes over the left and right halves of wide frames.
SMALL_OBJECT_LABELS = {"cell phone", "book"}
ZOOM_MIN_WIDTH = 960


@dataclass
class Detection:
    label: str
    confidence: float
    box: tuple[float, float, float, float]  # x, y, w, h normalised to 0..1 of the frame


class ObjectDetector:
    def __init__(self, model_path: str, input_size: int = 640):
        self.net = cv2.dnn.readNetFromONNX(model_path)
        self.input_size = input_size

    def _letterbox(self, frame: np.ndarray) -> tuple[np.ndarray, float, int, int]:
        """Resize keeping the aspect ratio and pad to a square, as YOLO was trained."""
        height, width = frame.shape[:2]
        scale = self.input_size / max(height, width)
        resized = cv2.resize(frame, (round(width * scale), round(height * scale)))
        pad_x = (self.input_size - resized.shape[1]) // 2
        pad_y = (self.input_size - resized.shape[0]) // 2
        canvas = np.full((self.input_size, self.input_size, 3), 114, dtype=np.uint8)
        canvas[pad_y : pad_y + resized.shape[0], pad_x : pad_x + resized.shape[1]] = resized
        return canvas, scale, pad_x, pad_y

    def _raw_detections(self, image: np.ndarray, labels: set[str] | None = None) -> dict[str, list]:
        """One YOLO pass over `image`; returns {label: [[x, y, w, h, score], ...]} in image pixels."""
        square, scale, pad_x, pad_y = self._letterbox(image)
        blob = cv2.dnn.blobFromImage(square, 1 / 255.0, (self.input_size, self.input_size), swapRB=True)
        self.net.setInput(blob)

        # Output is (1, 84, N): 4 box values (cx, cy, w, h) then 80 class scores per candidate.
        predictions = self.net.forward()[0].T
        class_scores = predictions[:, 4:]
        class_ids = class_scores.argmax(axis=1)
        confidences = class_scores[np.arange(len(class_ids)), class_ids]

        found: dict[str, list] = {}
        for class_id, (label, min_confidence) in TRACKED_CLASSES.items():
            if labels is not None and label not in labels:
                continue
            mask = (class_ids == class_id) & (confidences >= min_confidence)
            for (cx, cy, bw, bh), score in zip(predictions[mask, :4], confidences[mask]):
                # Undo the letterbox so boxes are in this image's pixels.
                found.setdefault(label, []).append(
                    [float((cx - bw / 2 - pad_x) / scale), float((cy - bh / 2 - pad_y) / scale), float(bw / scale), float(bh / scale), float(score)]
                )
        return found

    def detect(self, frame: np.ndarray, zoom: bool = True) -> list[Detection]:
        """Full-frame pass for everything, plus (for wide frames) zoomed left/right passes that only
        look for small objects. Phones and books are tiny once a 1280 px webcam frame is squeezed
        into 640 px; each half keeps ~1.8x more detail. Overlapping results are merged with NMS."""
        height, width = frame.shape[:2]
        candidates = self._raw_detections(frame)

        if zoom and width >= ZOOM_MIN_WIDTH:
            for start, end in ((0, round(width * 0.575)), (round(width * 0.425), width)):
                for label, boxes in self._raw_detections(frame[:, start:end], SMALL_OBJECT_LABELS).items():
                    candidates.setdefault(label, []).extend([[x + start, y, w, h, score] for x, y, w, h, score in boxes])

        detections: list[Detection] = []
        for label, boxes in candidates.items():
            min_confidence = next(conf for name, conf in TRACKED_CLASSES.values() if name == label)
            rects = [box[:4] for box in boxes]
            scores = [box[4] for box in boxes]

            for index in np.array(cv2.dnn.NMSBoxes(rects, scores, min_confidence, NMS_THRESHOLD)).flatten():
                x, y, bw, bh = rects[int(index)]
                x, y = max(0.0, x), max(0.0, y)
                detections.append(
                    Detection(
                        label=label,
                        confidence=round(scores[int(index)], 3),
                        box=(
                            round(x / width, 4),
                            round(y / height, 4),
                            round(min(bw, width - x) / width, 4),
                            round(min(bh, height - y) / height, 4),
                        ),
                    )
                )

        return detections
