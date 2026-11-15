import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from papers import reader, structure


EXTRACTED = {
    "meta": {"subject": "Cryptography"},
    "pages": [{"number": 1, "method": "text", "rows": []}],
    "figures": [{"id": "f1", "page": 1, "width": 200, "height": 100, "dataUrl": "data:image/png;base64,test"}],
    "tables": [], "ocr_pages": 0,
    "layout_text": """Cryptography
Duration: 3 hours Total Marks: 40
Instructions: Answer all questions.
Q1. Answer the following.
(a) Explain the RSA algorithm. {{10}}
(b) Calculate the RSA ciphertext for n=33, e=3 and m=2. {{10}}
Q2. Answer the following.
(a) Draw and explain the encryption flow. {{20}}
[FIGURE f1]""",
}


class PaperReaderTests(unittest.TestCase):
    def test_numbered_papers_keep_their_text_marks_and_figures_without_an_llm_round_trip(self):
        with patch.dict("os.environ", {"PAPER_AI_ENRICHMENT": "false"}), patch.object(structure, "chat_json", side_effect=AssertionError("Unnecessary AI rewrite")):
            result, method = structure.structure_paper(copy.deepcopy(EXTRACTED))
        self.assertEqual(method, "rules")
        self.assertEqual([len(question["parts"]) for question in result["questions"]], [2, 1])
        self.assertIn("n=33, e=3 and m=2", result["questions"][0]["parts"][1]["text"])
        self.assertEqual(result["questions"][1]["parts"][0]["figures"], ["f1"])
        self.assertEqual(result["questions"][0]["parts"][0]["marks"], "10")
        self.assertTrue(result["questions"][0]["parts"][0]["topic"])

    def test_ambiguous_papers_still_use_ai_structuring(self):
        extracted = {**EXTRACTED, "layout_text": "Explain RSA and AES. No question labels are visible."}
        answer = {"subject": "Cryptography", "questions": [{"label": "Q1.", "parts": [{"label": "(a)", "text": "Explain RSA and AES.", "marks": "10"}]}]}
        with patch.object(structure, "is_llm_available", return_value=True), patch.object(structure, "chat_json", return_value=answer) as ai:
            result, method = structure.structure_paper(extracted)
        self.assertTrue(ai.called)
        self.assertEqual(method, "llm")
        self.assertTrue(result["questions"])

    def test_repeat_uploads_reuse_the_saved_analysis_and_report_a_cache_hit(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(reader, "CACHE_DIR", Path(directory)), patch.object(reader, "extract_pdf", return_value=copy.deepcopy(EXTRACTED)) as extract:
            first = reader.read_paper(b"%PDF unique test data")
            progress = []
            second = reader.read_paper(b"%PDF unique test data", progress.append)
            self.assertEqual(extract.call_count, 1)
            self.assertFalse(first["cache_hit"])
            self.assertTrue(second["cache_hit"])
            self.assertEqual(first["structure"], second["structure"])
            self.assertEqual(progress[0]["stage"], "cached")
            self.assertFalse(list(Path(directory).glob("*.tmp")))

    def test_corrupted_cache_is_rebuilt(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(reader, "CACHE_DIR", Path(directory)), patch.object(reader, "extract_pdf", return_value=copy.deepcopy(EXTRACTED)) as extract:
            data = b"%PDF cache repair fixture"
            cache = reader._cache_path(data)
            cache.write_text("incomplete json", encoding="utf-8")
            result = reader.read_paper(data)
            self.assertEqual(extract.call_count, 1)
            self.assertTrue(json.loads(cache.read_text(encoding="utf-8"))["structure"]["questions"])
            self.assertFalse(result["cache_hit"])


if __name__ == "__main__":
    unittest.main()
