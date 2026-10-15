# Lakshya Proctor AI

Computer-vision checks for the **Live AI Proctor** call. During a practice test the browser sends
one small webcam frame every ~2.5 s to the Express backend, which forwards it here.

| Check | How |
|---|---|
| Face + head direction (screen / paper / sideways / up) | OpenCV **YuNet** face detector, 5 facial landmarks |
| People in frame, mobile phone, book | **YOLOv8s** (COCO, 640 px) run through OpenCV DNN |

Looking **down at the paper** is treated as normal writing. Looking sideways or up, leaving the
frame, a second person or a phone produce issues. The browser calibrates the student's own
"looking at the screen" pose from the first few frames and only speaks a warning when an issue
repeats across several frames. Frames are processed in memory and never stored.

## Run locally

```bash
pip install -r proctor-ai/requirements.txt
npm run proctor            # http://127.0.0.1:8002  (npm run proctor:dev to auto-reload)
```

The backend reaches it through `PROCTOR_AI_URL` (default `http://127.0.0.1:8002`). If
`PROCTOR_AI_TOKEN` is set, use the same value in `server/.env` and for this service.

## API

`GET /health`

`POST /analyze` (header `X-Proctor-Token` when a token is configured)

```json
{ "image": "data:image/jpeg;base64,...", "baseline": { "yaw": 0.02, "pitch": 0.6 } }
```

Returns `status` (`focused` | `warning` | `violation`), `gaze`, `faces`, `people`, `phone`, `book`,
`head` (`yaw`, `pitch`), `issues` (`code`, `severity`, `message`) and normalised `detections`
boxes for drawing.

Tuning lives at the top of `vision/analyzer.py` (head-angle thresholds, face confidence) and
`vision/objects.py` (per-class YOLO confidence).

## Models

- `models/face_detection_yunet_2023mar.onnx` from [opencv_zoo](https://github.com/opencv/opencv_zoo) (MIT).
- `models/yolov8s.onnx` exported from Ultralytics YOLOv8s at 640 px with `scripts/export_yolo.py`.
  Ultralytics models are licensed **AGPL-3.0**: if this service is offered publicly, its source
  must stay available (this repository being public satisfies that), or obtain an Ultralytics
  enterprise licence.
