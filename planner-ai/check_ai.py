"""Measure real Qwen syllabus extraction, planning and practice-paper generation with sample data."""
import json
import time
from pathlib import Path
from unittest.mock import patch

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "server" / ".env")

from rag import plan_builder
from rag.llm import is_llm_available
from rag.syllabus_ingest import ingest_syllabus_text
from papers.generate import generate_test

results = []


def measure(feature, callback):
    started = time.perf_counter()
    value, detail = callback()
    result = {"feature": feature, "seconds": round(time.perf_counter() - started, 2), **detail}
    results.append(result)
    print(json.dumps(result), flush=True)
    return value


def index():
    result = ingest_syllabus_text("""Semester 3
CSC301 Data Structures
Unit 1: Arrays and Linked Lists (6 hours)
Arrays, linked lists, insertion, deletion, traversal.
Unit 2: Stacks and Queues (6 hours)
Stack operations, queue operations, circular queues and applications.""")
    assert result["subjects"] and result["chunks"], result
    assert result["extractionMode"] == "ai", result
    return result, {"mode": result["extractionMode"], "units": sum(len(subject["units"]) for subject in result["subjects"])}


def plan(indexed):
    with patch.object(plan_builder, "chat_json", wraps=plan_builder.chat_json) as calls:
        result = plan_builder.build_study_plan(
            "Plan all subjects for 3 days with 2 hours per day",
            [{"fileName": "ai-check-syllabus.txt", **indexed}], [],
            {"startDate": "2026-11-15", "dailyStart": "08:00", "dailyEnd": "20:00"},
        )
    assert result.get("days"), result
    assert calls.call_count >= 2, "AI intent and strategy were not both called"
    return result, {"days": len(result["days"]), "aiCalls": calls.call_count}


def paper():
    structure = {
        "subject": "Data Structures", "total_marks": 10,
        "header_lines": ["Data Structures", "Time: 30 minutes", "Max Marks: 10"],
        "instructions": ["Answer all questions."],
        "questions": [{"label": "Q1.", "heading": "Answer the following", "parts": [
            {"label": "(a)", "text": "Explain stack operations and give an application.", "marks": "5", "topic": "Stacks", "type": "theory"},
            {"label": "(b)", "text": "Compare singly linked lists with arrays.", "marks": "5", "topic": "Linked lists", "type": "theory"},
        ]}],
    }
    result = generate_test([{"id": "ai-check-paper", "structure": structure, "figures": [], "tables": []}], title="AI check practice test", requested_marks=10, duration_minutes=30)
    parts = [part for question in result["paper"]["questions"] for part in question["parts"]]
    assert len(parts) == 2 and all(part["source"] == "generated" for part in parts), result["warnings"]
    return result, {"generatedParts": len(parts), "warnings": result["warnings"]}


if __name__ == "__main__":
    assert is_llm_available(), "Ollama Qwen is unavailable"
    indexed = measure("Syllabus indexing", index)
    measure("Study planner", lambda: plan(indexed))
    measure("Practice paper", paper)
    (ROOT / ".cache").mkdir(exist_ok=True)
    (ROOT / ".cache" / "planner-ai-feature-results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
