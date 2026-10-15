"""Turns raw detections from one webcam frame into a proctoring verdict.

The service is stateless: each frame is judged on its own. The browser smooths verdicts over
several frames before it speaks a warning, so one odd frame never triggers an alert.
"""

from dataclasses import asdict

import numpy as np

from .faces import Face, FaceAnalyzer
from .objects import Detection, ObjectDetector

# Head-direction thresholds, measured relative to the student's own calibrated "looking at the
# screen" pose (or a typical frontal pose when no calibration is sent).
DEFAULT_BASELINE = {"yaw": 0.0, "pitch": 0.58}
# Strict: only "screen" and "down" (writing) are allowed, so small turns already count.
SIDEWAYS_YAW = 0.22
DOWN_PITCH = 0.15
UP_PITCH = -0.12
# Faint faces (posters, photos, blurred people far behind) must not count as a second person.
CLEAR_FACE_SCORE = 0.75

ISSUES = {
    "phone": ("violation", "Phone detected. Put it away and continue your paper."),
    "multiple_people": ("violation", "Someone else is in the frame. You must write the exam alone."),
    "not_visible": ("warning", "You're not visible. Stay in front of the camera."),
    "looking_sideways": ("warning", "Do not look sideways. Keep your eyes on the screen or your paper."),
    "looking_up": ("warning", "Do not look up or around. Keep your eyes on the screen or your paper."),
}


def classify_gaze(face: Face, baseline: dict) -> str:
    yaw_offset = face.yaw - baseline["yaw"]
    pitch_offset = face.pitch - baseline["pitch"]

    if abs(yaw_offset) > SIDEWAYS_YAW:
        return "sideways"
    if pitch_offset > DOWN_PITCH:
        return "down"
    if pitch_offset < UP_PITCH:
        return "up"
    return "screen"


class ProctorAnalyzer:
    def __init__(self, yolo_path: str, yunet_path: str):
        self.objects = ObjectDetector(yolo_path)
        self.faces = FaceAnalyzer(yunet_path)

    def analyze(self, frame: np.ndarray, baseline: dict | None = None) -> dict:
        baseline = {**DEFAULT_BASELINE, **(baseline or {})}
        objects: list[Detection] = self.objects.detect(frame)
        all_faces: list[Face] = self.faces.detect(frame)
        faces = [face for face in all_faces if face.confidence >= CLEAR_FACE_SCORE]

        people = sum(1 for item in objects if item.label == "person")
        phone = any(item.label == "cell phone" for item in objects)
        book = any(item.label == "book" for item in objects)

        # The student is the largest clear face, falling back to the most confident faint one
        # (e.g. a dim room). Other clear faces only count toward "multiple people".
        main_face = max(faces, key=lambda face: face.box[2] * face.box[3], default=None) or max(
            all_faces, key=lambda face: face.confidence, default=None
        )
        if main_face:
            gaze = classify_gaze(main_face, baseline)
        elif people:
            # Body visible but no face: either bent low over the paper or turned fully away.
            # A single frame cannot tell which, so the browser decides from the last visible pose.
            gaze = "hidden"
        else:
            gaze = "unknown"

        codes = []
        if phone:
            codes.append("phone")
        if max(people, len(faces)) > 1:
            codes.append("multiple_people")
        if not people and not main_face:
            codes.append("not_visible")
        if gaze == "sideways":
            codes.append("looking_sideways")
        elif gaze == "up":
            codes.append("looking_up")

        issues = [{"code": code, "severity": ISSUES[code][0], "message": ISSUES[code][1]} for code in codes]
        if any(issue["severity"] == "violation" for issue in issues):
            status = "violation"
        elif issues:
            status = "warning"
        else:
            status = "focused"

        return {
            "status": status,
            "gaze": gaze,
            "faces": len(faces),
            "people": people,
            "phone": phone,
            "book": book,
            "head": {"yaw": main_face.yaw, "pitch": main_face.pitch} if main_face else None,
            "issues": issues,
            "detections": [asdict(item) for item in objects]
            + [{"label": "face", "confidence": face.confidence, "box": face.box} for face in faces or all_faces[:1]],
        }
