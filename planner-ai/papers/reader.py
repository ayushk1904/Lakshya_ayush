"""Read each PDF once, cache its analysis, and report real processing progress."""
import hashlib
import json
import logging
import os
import tempfile
import threading
import time
from pathlib import Path

from .extract import extract_pdf
from .structure import structure_paper

log = logging.getLogger("planner-ai.papers")
CACHE_DIR = Path(__file__).resolve().parents[1] / ".cache" / "papers"
READER_VERSION = "fast-reader-v2"
_read_lock = threading.Lock()  # PyMuPDF and the shared OCR engine must not run in parallel threads.


def _cache_path(data):
    mode = os.getenv("PAPER_AI_ENRICHMENT", "false").lower()
    detection = os.getenv("OCR_DETECTION_MODE", "page").lower()
    side = os.getenv("OCR_DET_SIDE_LEN", "1280")
    key = hashlib.sha256(READER_VERSION.encode() + mode.encode() + detection.encode() + side.encode() + data).hexdigest()
    return CACHE_DIR / f"{key}.json"


def _load(path):
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
        return result if result.get("structure", {}).get("questions") else None
    except (OSError, ValueError, AttributeError):
        return None


def _save(path, result):
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(result, handle, ensure_ascii=False)
        os.replace(temporary, path)
    except OSError as error:
        log.warning("could not cache paper: %s", error)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def read_paper(data: bytes, on_progress=None) -> dict:
    def progress(event):
        if on_progress:
            on_progress(event)

    started = time.perf_counter()
    path = _cache_path(data)
    def cached_result(cached):
        progress({"stage": "cached", "done": cached["page_count"], "total": cached["page_count"], "message": "Paper already read; loading saved analysis."})
        return {**cached, "cache_hit": True}

    # Cache hits do not wait behind a different PDF that is currently using OCR.
    cached = _load(path)
    if cached:
        return cached_result(cached)
    with _read_lock:
        cached = _load(path)
        if cached:
            return cached_result(cached)

        extracted = extract_pdf(data, on_progress=progress)
        extracted_at = time.perf_counter()
        pages = len(extracted["pages"])
        progress({"stage": "structure", "done": pages, "total": pages, "message": "Organising the questions, marks and diagrams..."})
        structure, method = structure_paper(extracted)
        finished = time.perf_counter()
        result = {
            "meta": extracted["meta"], "structure": structure, "structure_method": method,
            "figures": extracted["figures"], "tables": extracted["tables"],
            "layout_text": extracted["layout_text"], "ocr_pages": extracted["ocr_pages"], "page_count": pages,
            "timings": {"extractSeconds": round(extracted_at - started, 3), "structureSeconds": round(finished - extracted_at, 3), "totalSeconds": round(finished - started, 3)},
            "cache_hit": False,
        }
        if structure["questions"]:
            _save(path, result)
        log.info("read paper: %s pages, %s, %.2fs OCR/extraction + %.2fs structure", pages, method, extracted_at - started, finished - extracted_at)
        return result
