"""Face detection and head direction with OpenCV's YuNet model.

YuNet returns a box plus five landmarks per face: both eyes, the nose tip and both mouth
corners. From those we estimate where the head is pointing without a heavy 3D face mesh:

  yaw   = horizontal offset of the nose from the midpoint between the eyes, divided by the
          eye distance. ~0 when facing the camera, grows as the head turns sideways.
  pitch = how far down the nose sits between the eye line (0) and the mouth line (1).
          ~0.5 when facing the camera, larger when looking down, smaller when looking up.
"""

from dataclasses import dataclass

import cv2
import numpy as np

# Low enough to still find a face that is turned well away, so its angle can be judged; the
# analyzer only counts confident faces as people.
MIN_FACE_SCORE = 0.45


@dataclass
class Face:
    confidence: float
    box: tuple[float, float, float, float]  # x, y, w, h normalised to 0..1 of the frame
    yaw: float
    pitch: float


class FaceAnalyzer:
    def __init__(self, model_path: str):
        self.detector = cv2.FaceDetectorYN.create(model_path, "", (320, 320), MIN_FACE_SCORE, 0.3, 5000)

    def detect(self, frame: np.ndarray) -> list[Face]:
        height, width = frame.shape[:2]
        self.detector.setInputSize((width, height))
        _, rows = self.detector.detect(frame)
        if rows is None:
            return []

        faces = []
        for row in rows:
            x, y, w, h = row[0:4]
            right_eye, left_eye, nose = row[4:6], row[6:8], row[8:10]
            right_mouth, left_mouth = row[10:12], row[12:14]

            eye_mid = (right_eye + left_eye) / 2
            mouth_mid = (right_mouth + left_mouth) / 2
            eye_distance = float(np.linalg.norm(left_eye - right_eye)) or 1.0
            eye_to_mouth = float(mouth_mid[1] - eye_mid[1]) or 1.0

            x, y = max(0.0, float(x)), max(0.0, float(y))
            faces.append(
                Face(
                    confidence=round(float(row[14]), 3),
                    box=(
                        round(x / width, 4),
                        round(y / height, 4),
                        round(min(float(w), width - x) / width, 4),
                        round(min(float(h), height - y) / height, 4),
                    ),
                    yaw=round(float(nose[0] - eye_mid[0]) / eye_distance, 3),
                    pitch=round(float(nose[1] - eye_mid[1]) / eye_to_mouth, 3),
                )
            )

        return faces
