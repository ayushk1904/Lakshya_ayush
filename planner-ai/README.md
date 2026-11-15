# Lakshya Planner AI (Python RAG service)

The Python service behind the **AI Study Planner**. The Express backend (`/server`) handles login,
file uploads and MongoDB, then calls this service for all the AI work.

## Run it

```bash
.venv\Scripts\python -m pip install -r planner-ai/requirements.txt   # once
ollama pull qwen2.5:7b
npm run planner                              # from the repo root -> http://127.0.0.1:8001
```

`npm start` or `start.bat` starts it with the full app. For development, keep it running next to
`npm run server` and `npm run client`. It reads `OLLAMA_BASE_URL`, `OLLAMA_MODEL` (default
`qwen2.5:7b`) and `OLLAMA_TIMEOUT_SECONDS` (default `300`) from the root `.env`, with
`server/.env` as a fallback and `planner-ai/.env` taking precedence. No AI API key is needed.
Health check: `GET http://127.0.0.1:8001/health`. API docs: `http://127.0.0.1:8001/docs`.

## How the RAG pipeline works

| Step | File | What happens |
|---|---|---|
| Index | `rag/syllabus_ingest.py` | Syllabus text is split per subject (course codes like `CSC601`). The LLM extracts units, topics, lecture hours and importance; a regex parser is the fallback. One retrieval chunk is stored per unit. |
| Evidence | `rag/pyq_analyzer.py` | Past papers are split into questions and matched to topics by their rarest words, giving "asked N times" counts. |
| Retrieve | `rag/text_utils.py` | BM25 search over the unit chunks finds units the student explicitly mentions ("focus on backpropagation"). |
| Electives | `rag/electives.py` | Optional courses (e.g. `CSDLO6011/6012/6013`) are grouped. A semester plan keeps only the student's choice; if it is unknown, `/plan` returns `needsChoice` (a question with options) instead of a plan. "excluding optional courses" drops them all. |
| Plan | `rag/plan_builder.py` | Understand the request (semester / subject / days left / hours per day), score units, share time fairly between subjects, build an exact timetable, then let the LLM write a strategy grounded in the retrieved units and the real schedule. |
| LLM | `rag/llm.py` | Local Ollama Qwen in JSON mode. Indexes one subject at a time to fit a single GPU; uses rules when Ollama or the model is unavailable. |

## Endpoints

- `POST /ingest` `{ "text": "<syllabus text>" }` streams newline-delimited JSON: `progress` events, then one `result` with `subjects`, `chunks`, `semesters`.
- `POST /plan` `{ "message", "syllabi", "papers", "preferences" }` returns the full plan (days, timetable items, priorities, strategy).

If `PLANNER_AI_TOKEN` is set, both endpoints require the same value in the `X-Planner-Token` header.
Set it on both services in production.
