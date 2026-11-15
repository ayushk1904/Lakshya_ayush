"""Local Ollama Qwen client used by syllabus indexing, planning and practice tests."""

import json
import os

import httpx

# Reuse local HTTP connections and client setup across planner worker threads.
_http = httpx.Client()


class LlmError(Exception):
    pass


def model_pool() -> list[str]:
    # Keep indexing on one local model instead of loading several models on one GPU.
    return [os.getenv("OLLAMA_MODEL") or "qwen2.5:7b"]


def _base_url() -> str:
    return (os.getenv("OLLAMA_BASE_URL") or "http://127.0.0.1:11434").rstrip("/")


def is_llm_available() -> bool:
    """Check the service and configured model; retain rules when Ollama is offline."""
    try:
        response = _http.get(f"{_base_url()}/api/tags", timeout=3)
        response.raise_for_status()
        names = {entry.get("name") for entry in response.json().get("models", [])}
        model = model_pool()[0]
        return model in names or f"{model}:latest" in names
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        return False


def _keep_alive():
    value = os.getenv("OLLAMA_KEEP_ALIVE") or "-1"
    return int(value) if value.lstrip("-").isdigit() else value


def _context_length(system: str, user: str, max_tokens: int) -> int:
    base = int(os.getenv("OLLAMA_NUM_CTX") or 8192)
    maximum = max(base, int(os.getenv("OLLAMA_MAX_CTX") or 16384))
    needed = (len(system) + len(user)) // 3 + max_tokens + 512
    return min(maximum, max(base, 1 << (needed - 1).bit_length()))


def chat_json(system: str, user: str, max_tokens: int = 1200, temperature: float = 0.2, timeout: float = 60.0, use_pool: bool = True) -> dict:
    """Preserve the RAG interface while sending JSON-mode requests to local Qwen."""
    model = model_pool()[0]
    payload = {
        "model": model,
        "stream": False,
        "format": "json",
        "keep_alive": _keep_alive(),
        "options": {"temperature": temperature, "num_predict": max_tokens, "num_ctx": _context_length(system, user, max_tokens)},
        "messages": [
            {"role": "system", "content": f"{system}\nRespond with a single valid JSON object only."},
            {"role": "user", "content": user},
        ],
    }
    # Allow a local model time to load and answer, including on a CPU.
    request_timeout = max(timeout, float(os.getenv("OLLAMA_TIMEOUT_SECONDS") or 300))
    try:
        response = _http.post(f"{_base_url()}/api/chat", json=payload, timeout=request_timeout)
    except httpx.TimeoutException as error:
        raise LlmError("Ollama took too long to respond. Increase OLLAMA_TIMEOUT_SECONDS or try again.") from error
    except httpx.HTTPError as error:
        raise LlmError(f"Could not reach Ollama. Start Ollama and run: ollama pull {model}") from error

    try:
        data = response.json()
    except ValueError as error:
        raise LlmError("Ollama returned an invalid response") from error
    if response.is_error or data.get("error"):
        raise LlmError(str(data.get("error") or f"Ollama request failed ({response.status_code})"))
    content = (data.get("message") or {}).get("content")
    if not content:
        raise LlmError("Ollama returned an empty answer")
    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, TypeError) as error:
        raise LlmError("Ollama returned invalid JSON; try again") from error
    if isinstance(parsed, list):
        return {"items": parsed}
    if not isinstance(parsed, dict):
        raise LlmError("Ollama returned unexpected JSON")
    return parsed
