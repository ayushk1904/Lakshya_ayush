import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rag import llm


class OllamaTests(unittest.TestCase):
    def test_native_json_request_and_parsing(self):
        def respond(url, **kwargs):
            self.assertTrue(url.endswith("/api/chat"))
            body = kwargs["json"]
            self.assertEqual(body["format"], "json")
            self.assertFalse(body["stream"])
            self.assertEqual(body["options"]["num_predict"], 200)
            self.assertEqual(body["options"]["num_ctx"], 8192)
            self.assertEqual(body["keep_alive"], -1)
            self.assertGreaterEqual(kwargs["timeout"], 300)
            self.assertNotIn("headers", kwargs)
            return httpx.Response(200, json={"message": {"content": '{"strategy":"Review unit 1"}'}})

        with patch.object(llm._http, "post", side_effect=respond):
            self.assertEqual(llm.chat_json("Plan", "Syllabus", max_tokens=200)["strategy"], "Review unit 1")

    def test_missing_model_is_a_useful_error(self):
        with patch.object(llm._http, "post", return_value=httpx.Response(404, json={"error": "model not found"})):
            with self.assertRaisesRegex(llm.LlmError, "model not found"):
                llm.chat_json("Plan", "Syllabus")

    def test_invalid_json_is_not_treated_as_an_empty_success(self):
        with patch.object(llm._http, "post", return_value=httpx.Response(200, json={"message": {"content": "invalid"}})):
            with self.assertRaisesRegex(llm.LlmError, "invalid JSON"):
                llm.chat_json("Plan", "Syllabus")

    def test_offline_model_allows_rules_fallback(self):
        with patch.object(llm._http, "get", side_effect=httpx.ConnectError("offline")):
            self.assertFalse(llm.is_llm_available())

    def test_long_context_preserves_evidence_without_penalizing_short_calls(self):
        self.assertEqual(llm._context_length("Coach", "Short question", 500), 8192)
        self.assertEqual(llm._context_length("Evaluate", "x" * 30000, 500), 16384)


if __name__ == "__main__":
    unittest.main()
