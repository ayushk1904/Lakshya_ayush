"""Lakshya Proctor AI: computer-vision checks for the Live AI Proctor call.

The browser sends a small webcam frame every few seconds through the Express backend, which
calls this service:
  POST /analyze  JPEG frame (+ optional calibration) -> faces, head direction, people, phone,
                 and a focused / warning / violation verdict

Frames are processed in memory and never stored.

Run:  uvicorn main:app --port 8002 --reload
"""

import base64
import binascii
import logging
import os
import threading
import time
from pathlib import Path

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).parent / ".env")
load_dotenv(Path(__file__).parent.parent / "server" / ".env")

from vision import ProctorAnalyzer  # noqa: E402

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("proctor-ai")
# Hide OpenCV's "targets are not supported by the new graph engine" notice on every load.
cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)

MODELS_DIR = Path(__file__).parent / "models"
MAX_IMAGE_BYTES = 2 * 1024 * 1024
# The browser sends 1280 px frames so phones and books keep enough detail for the zoomed passes.
MAX_FRAME_WIDTH = 1280

app = FastAPI(title="Lakshya Proctor AI", version="1.0.0")
analyzer = ProctorAnalyzer(
    yolo_path=str(MODELS_DIR / "yolov8s.onnx"),
    yunet_path=str(MODELS_DIR / "face_detection_yunet_2023mar.onnx"),
)
# OpenCV DNN networks are not thread-safe and FastAPI runs sync endpoints in a thread pool.
analyzer_lock = threading.Lock()


def require_token(x_proctor_token: str | None = Header(default=None)) -> None:
    """When PROCTOR_AI_TOKEN is set, only callers that send it (our Express backend) may analyse frames."""
    expected = os.getenv("PROCTOR_AI_TOKEN")
    if expected and x_proctor_token != expected:
        raise HTTPException(status_code=401, detail="Invalid proctor token")


class Baseline(BaseModel):
    yaw: float = Field(ge=-2, le=2)
    pitch: float = Field(ge=-1, le=2)


class AnalyzeRequest(BaseModel):
    image: str = Field(min_length=100, description="JPEG/PNG as base64 or a data: URL")
    baseline: Baseline | None = None


def decode_frame(image: str) -> np.ndarray:
    payload = image.split(",", 1)[1] if image.startswith("data:") else image
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="Image is not valid base64") from error

    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Frame is too large; send a smaller JPEG")

    frame = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode the image")

    height, width = frame.shape[:2]
    if width > MAX_FRAME_WIDTH:
        frame = cv2.resize(frame, (MAX_FRAME_WIDTH, round(height * MAX_FRAME_WIDTH / width)))
    return frame


@app.get("/health")
def health():
    return {"status": "ok", "service": "proctor-ai", "models": ["yolov8s-640", "yunet"]}


@app.post("/analyze", dependencies=[Depends(require_token)])
def analyze(request: AnalyzeRequest):
    started = time.perf_counter()
    frame = decode_frame(request.image)
    with analyzer_lock:
        result = analyzer.analyze(frame, request.baseline.model_dump() if request.baseline else None)
    log.debug("analyzed %sx%s frame in %.0f ms", frame.shape[1], frame.shape[0], (time.perf_counter() - started) * 1000)
    return result
