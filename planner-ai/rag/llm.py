"""Groq chat client with a small model pool.

On Groq's free tier every model has its OWN tokens-per-minute budget (about 8,000).
We keep a pool of comparable models and send each request to the first model with
budget left, so long jobs (indexing a whole syllabus) run several models in parallel.
"""

import json
import logging
import os
import re
import threading
import time

import httpx

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
WINDOW_SECONDS = 60
DEFAULT_POOL = "openai/gpt-oss-20b,openai/gpt-oss-120b,qwen/qwen3.8-27b"
log = logging.getLogger("planner-ai.llm")

_usage: dict[str, list[list]] = {}  # model -> [[timestamp, tokens], ...] sent in the last minute
_exhausted_until: dict[str, float] = {}  # model -> time when its daily (TPD/RPD) quota resets
_lock = threading.Lock()
MAX_WAIT_SECONDS = 20  # never sleep longer than this on a 429; switch model or give up instead


class LlmError(Exception):
    pass


def is_llm_available() -> bool:
    return bool(os.getenv("GROQ_API_KEY"))


def model_pool() -> list[str]:
    """GROQ_MODEL first (used for planning), then the extra models used to speed up indexing."""
    primary = os.getenv("GROQ_MODEL") or "openai/gpt-oss-20b"
    extra = [model.strip() for model in (os.getenv("GROQ_MODEL_POOL") or DEFAULT_POOL).split(",") if model.strip()]
    return list(dict.fromkeys([primary, *extra]))


def _tokens_per_minute() -> int:
    return int(os.getenv("GROQ_TPM_LIMIT") or 7500)


def _model_options(model: str) -> dict:
    """Reasoning models think before answering; keep that short to save tokens."""
    if model.startswith("openai/gpt-oss"):
        return {"reasoning_effort": "low"}
    if model.startswith("qwen/"):
        return {"reasoning_effort": "none"}
    return {}


def _estimate_tokens(messages: list[dict], max_tokens: int) -> int:
    prompt_chars = sum(len(message["content"]) for message in messages)
    return int(prompt_chars / 3.6) + max_tokens // 2


def _acquire(tokens: int, models: list[str]) -> tuple[str, list]:
    """Block until one of `models` has budget for `tokens`; reserve it and return (model, usage entry).

    Models whose daily quota is used up are skipped; if all of them are, fail fast.
    """
    while True:
        with _lock:
            now = time.time()
            available = [model for model in models if _exhausted_until.get(model, 0) <= now]
            if not available:
                minutes = max(1, round((min(_exhausted_until[model] for model in models) - now) / 60))
                raise LlmError(f"Daily AI limit reached on Groq's free tier; it resets in about {minutes} min")
            waits = []
            for model in available:
                entries = _usage.setdefault(model, [])
                while entries and now - entries[0][0] > WINDOW_SECONDS:
                    entries.pop(0)
                used = sum(entry[1] for entry in entries)
                if used + tokens <= _tokens_per_minute() or not entries:
                    entry = [now, tokens]
                    entries.append(entry)
                    return model, entry
                waits.append(WINDOW_SECONDS - (now - entries[0][0]))
        time.sleep(max(0.5, min(waits) + 0.05))


def _retry_delay(response: httpx.Response, data: dict) -> float:
    """Seconds Groq asks us to wait, from the Retry-After header or text like 'try again in 21m52.4s'."""
    header = response.headers.get("retry-after")
    if header:
        try:
            return float(header) + 0.25
        except ValueError:
            pass
    message = str(data.get("error", {}).get("message", ""))
    match = re.search(r"try again in (?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)(ms|s))?", message, re.I)
    if match and any(match.groups()):
        hours, minutes, value, unit = match.groups()
        seconds = int(hours or 0) * 3600 + int(minutes or 0) * 60
        if value:
            seconds += float(value) / 1000 if unit.lower() == "ms" else float(value)
        return seconds + 0.25
    return 5.0


def _handle_rate_limit(model: str, response: httpx.Response, data: dict) -> None:
    """Groq said 429. Short waits: mark the model full for a moment. Long waits (daily quota): park the model."""
    delay = _retry_delay(response, data)
    message = str(data.get("error", {}).get("message", ""))
    with _lock:
        if delay > MAX_WAIT_SECONDS or re.search(r"per day|\(TPD\)|\(RPD\)", message, re.I):
            _exhausted_until[model] = time.time() + delay
            log.warning("%s daily quota used up; skipping it for %.0f min", model, delay / 60)
        else:
            # Fill this model's minute window so _acquire waits (at most ~delay) or picks another model.
            _usage.setdefault(model, []).append([time.time() - WINDOW_SECONDS + delay, _tokens_per_minute()])


def chat_json(system: str, user: str, max_tokens: int = 1200, temperature: float = 0.2, timeout: float = 60.0, use_pool: bool = True) -> dict:
    """Send one chat request in JSON mode and return the parsed object.

    use_pool=True  -> GROQ_MODEL first, then any other pool model with budget left
                      (parallel indexing, and a fallback when one model's daily quota runs out).
    use_pool=False -> only GROQ_MODEL.
    """
    if not is_llm_available():
        raise LlmError("GROQ_API_KEY is not configured")

    messages = [
        {"role": "system", "content": f"{system}\nRespond with a single valid JSON object only."},
        {"role": "user", "content": user},
    ]
    models = model_pool() if use_pool else model_pool()[:1]
    headers = {"Authorization": f"Bearer {os.getenv('GROQ_API_KEY')}"}
    last_error = "Groq is rate limiting requests right now"

    for _attempt in range(5):
        model, entry = _acquire(_estimate_tokens(messages, max_tokens), models)
        payload = {
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            "messages": messages,
            **_model_options(model),
        }
        try:
            response = httpx.post(GROQ_URL, json=payload, headers=headers, timeout=timeout)
        except httpx.HTTPError as error:
            last_error = f"Could not reach Groq: {error}"
            time.sleep(2)
            continue
        try:
            data = response.json()
        except ValueError:
            data = {}

        used = (data.get("usage") or {}).get("total_tokens")
        if used:
            entry[1] = used  # replace the estimate with what Groq actually counted
        log.debug("groq %s -> %s, %s tokens", model, response.status_code, used)

        if response.status_code == 429:
            _handle_rate_limit(model, response, data)
            continue
        if response.status_code >= 500:
            time.sleep(2)
            continue
        if response.status_code == 400 and "failed_generation" in str(data.get("error", {})):
            continue  # the model produced invalid JSON; simply ask again
        if response.status_code >= 400:
            raise LlmError(data.get("error", {}).get("message") or f"Groq request failed ({response.status_code})")

        content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or "{}"
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            match = re.search(r"\{[\s\S]*\}", content)
            if not match:
                last_error = "Model returned invalid JSON"
                continue
            parsed = json.loads(match.group(0))
        # Callers always get a dict, even if the model answered with a bare list.
        if isinstance(parsed, list):
            return {"items": parsed}
        if not isinstance(parsed, dict):
            raise LlmError("Model returned unexpected JSON")
        return parsed

    raise LlmError(last_error)
