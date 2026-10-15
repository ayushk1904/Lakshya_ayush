"""Recreate models/yolov8s.onnx (only needed if you want to re-export or try another YOLO size).

The service itself never needs PyTorch: it runs the exported ONNX file through OpenCV.
Exporting needs Ultralytics, so do it in a throwaway virtual environment:

    python -m venv .export-venv
    .export-venv/Scripts/python -m pip install ultralytics onnx onnxslim --extra-index-url https://download.pytorch.org/whl/cpu
    .export-venv/Scripts/python scripts/export_yolo.py

640x640 is needed to see phones and books at webcam distance (the smaller yolov8n at 320 missed
every phone in testing); opset 12 is what OpenCV DNN reads best.
"""

import shutil
from pathlib import Path

from ultralytics import YOLO

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

exported = Path(YOLO("yolov8s.pt").export(format="onnx", imgsz=640, opset=12, simplify=True, dynamic=False))
MODELS_DIR.mkdir(exist_ok=True)
shutil.copy(exported, MODELS_DIR / "yolov8s.onnx")
print(f"Saved {MODELS_DIR / 'yolov8s.onnx'}")
