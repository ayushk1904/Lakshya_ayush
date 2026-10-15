"""Lakshya Planner AI: the Python RAG service behind the AI Study Planner and Practice Tests.

The Express backend handles login, uploads and MongoDB, and calls this service for the AI work:
  POST /ingest           syllabus text  -> subjects, units, topics and retrieval chunks (streams progress)
  POST /plan             request + indexed syllabi + past papers -> full timed study plan
  POST /papers/ingest    previous-year paper PDF -> structured questions, figures and tables (OCR if needed)
  POST /papers/generate  structured papers -> new practice test in the same format

Run:  uvicorn main:app --port 8001 --reload
"""

import base64
import binascii
import json
import logging
import os
import threading
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Share the backend's GROQ_API_KEY / GROQ_MODEL; a local planner-ai/.env can override them.
load_dotenv(Path(__file__).parent / ".env")
load_dotenv(Path(__file__).parent.parent / "server" / ".env")

from rag.llm import is_llm_available  # noqa: E402  (imports after env is loaded)
from rag.plan_builder import PlannerError, build_study_plan  # noqa: E402
from rag.syllabus_ingest import iter_ingest  # noqa: E402
from papers.extract import extract_pdf  # noqa: E402
from papers.generate import generate_test  # noqa: E402
from papers.structure import structure_paper  # noqa: E402

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("planner-ai")

app = FastAPI(title="Lakshya Planner AI", version="1.0.0")


def require_token(x_planner_token: str | None = Header(default=None)) -> None:
    """When PLANNER_AI_TOKEN is set, only callers that send it (our Express backend) may use the AI endpoints."""
    expected = os.getenv("PLANNER_AI_TOKEN")
    if expected and x_planner_token != expected:
        raise HTTPException(status_code=401, detail="Invalid planner token")


class IngestRequest(BaseModel):
    text: str = Field(min_length=1)


class PlanRequest(BaseModel):
    message: str = Field(min_length=1, max_length=600)
    syllabi: list[dict]
    papers: list[dict] = []
    preferences: dict = {}


@app.get("/health")
def health():
    return {"status": "ok", "service": "planner-ai", "llm": "groq" if is_llm_available() else "disabled (rules only)"}


@app.post("/ingest", dependencies=[Depends(require_token)])
def ingest(request: IngestRequest):
    """Streams newline-delimited JSON: progress events, then one result event."""

    def events():
        try:
            for event in iter_ingest(request.text):
                yield json.dumps(event) + "\n"
        except Exception as error:  # report failures in-stream; the HTTP status is already 200
            log.exception("ingest failed")
            yield json.dumps({"type": "error", "message": str(error) or "Failed to index syllabus"}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


@app.post("/plan", dependencies=[Depends(require_token)])
def plan(request: PlanRequest):
    try:
        return build_study_plan(request.message.strip(), request.syllabi, request.papers, request.preferences)
    except PlannerError as error:
        raise HTTPException(status_code=error.status, detail=str(error)) from error


# --- Practice tests: previous-year paper RAG -------------------------------------------------

MAX_PAPER_BYTES = 25 * 1024 * 1024
# PyMuPDF is not safe to use from several threads at once; papers are extracted one at a time.
paper_extract_lock = threading.Lock()


class PaperIngestRequest(BaseModel):
    pdf_base64: str = Field(min_length=100)
    file_name: str = ""


class PaperForGeneration(BaseModel):
    id: str
    structure: dict
    figures: list[dict] = []
    tables: list[dict] = []


class PaperGenerateRequest(BaseModel):
    papers: list[PaperForGeneration] = Field(min_length=1, max_length=10)
    title: str = ""
    marks: int | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=600)


@app.post("/papers/ingest", dependencies=[Depends(require_token)])
def papers_ingest(request: PaperIngestRequest):
    try:
        data = base64.b64decode(request.pdf_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="The paper is not valid base64") from error
    if len(data) > MAX_PAPER_BYTES:
        raise HTTPException(status_code=413, detail="The paper PDF is larger than 25 MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Only PDF question papers are supported")

    try:
        with paper_extract_lock:
            extracted = extract_pdf(data)
    except ImportError as error:  # OCR/PDF packages missing: a server problem, not a bad PDF
        log.exception("paper extraction dependencies missing")
        raise HTTPException(
            status_code=503,
            detail=f"The paper analyser is missing a package ({error.name}). Run: pip install -r planner-ai/requirements.txt",
        ) from error
    except Exception as error:  # corrupt or encrypted PDFs
        log.exception("paper extraction failed for %s", request.file_name)
        raise HTTPException(status_code=400, detail=f"Could not read this PDF: {error}") from error

    structure, method = structure_paper(extracted)
    if not structure["questions"]:
        raise HTTPException(status_code=422, detail="No questions could be found in this paper.")
    return {
        "meta": extracted["meta"],
        "structure": structure,
        "structure_method": method,
        "figures": extracted["figures"],
        "tables": extracted["tables"],
        "layout_text": extracted["layout_text"],
        "ocr_pages": extracted["ocr_pages"],
        "page_count": len(extracted["pages"]),
    }


@app.post("/papers/generate", dependencies=[Depends(require_token)])
def papers_generate(request: PaperGenerateRequest):
    try:
        return generate_test(
            [paper.model_dump() for paper in request.papers],
            title=request.title.strip(),
            requested_marks=request.marks,
            duration_minutes=request.duration_minutes,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
