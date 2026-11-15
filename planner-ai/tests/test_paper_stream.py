import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from fastapi import HTTPException


class PaperStreamTests(unittest.TestCase):
    def test_progress_is_delivered_before_the_completed_result(self):
        result = {"page_count": 2, "structure": {"questions": [{"parts": []}]}}

        def read(data, name, progress):
            progress({"stage": "ocr", "done": 0, "total": 2, "message": "Reading page 1 of 2"})
            progress({"stage": "structure", "done": 2, "total": 2, "message": "Organising questions"})
            return result

        with patch.object(main, "ingest_paper_bytes", side_effect=read):
            events = [json.loads(line) for line in main.paper_events(b"%PDF fixture", "paper.pdf")]
        self.assertEqual([event["type"] for event in events], ["progress", "progress", "result"])
        self.assertEqual(events[0]["total"], 2)
        self.assertEqual(events[-1]["data"], result)

    def test_invalid_papers_end_with_an_error_event(self):
        with patch.object(main, "ingest_paper_bytes", side_effect=HTTPException(status_code=422, detail="No questions found")):
            events = [json.loads(line) for line in main.paper_events(b"invalid", "paper.pdf")]
        self.assertEqual(events[-1], {"type": "error", "status": 422, "message": "No questions found"})


if __name__ == "__main__":
    unittest.main()
