"""Lakshya Planner AI: the Python RAG service behind the AI Study Planner.

The Express backend handles login, uploads and MongoDB, and calls this service for the AI work:
  POST /ingest  syllabus text  -> subjects, units, topics and retrieval chunks (streams progress)
  POST /plan    request + indexed syllabi + past papers -> full timed study plan

Run:  uvicorn main:app --port 8001 --reload
"""

import json
import logging
import os
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
