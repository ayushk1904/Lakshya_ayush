"""Indexing step of the RAG pipeline.

Turns a syllabus PDF's text into structured subjects -> units -> topics, plus one
retrieval "chunk" per unit that the planner later searches with BM25.

Flow:
  1. Split the text into one segment per subject (by course code like CSC601, or by headings).
  2. Ask the LLM to extract units, topics and lecture hours from each segment.
  3. If the LLM is unavailable, fall back to a regex parser.
  4. Merge, clean and build retrieval chunks.
"""

import hashlib
import json
import logging
import re
from collections.abc import Iterator
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path

from .llm import chat_json, is_llm_available, model_pool
from .text_utils import clean_pdf_text, parse_number_token

log = logging.getLogger("planner-ai.ingest")

# Extracted subjects are cached by content hash; bump CACHE_VERSION when extraction logic changes.
CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache" / "extractions"
CACHE_VERSION = 1
HEARTBEAT_SECONDS = 10

CODE_PATTERN = re.compile(r"\b([A-Z]{2,6}[- ]?\d{3,5}[A-Z]?)\b")
CODE_BLOCKLIST = re.compile(
    r"^(ISBN|ISSN|MAY|JUNE|JULY|DEC|NOV|OCT|APRIL|MARCH|PAGE|ISO|IEEE|AICTE|PIN|AD|BC|NO|SR|MS|AC|NEP|CBCGS|CBCS|RFC|COVID|TCP|UTF|USB|RS)\b"
)
DETAIL_HINT = re.compile(
    r"(course\s+objectives?|objectives?\s*:|prerequisites?|course\s+outcomes?|detailed\s+contents?|module\s*(no\.?|1|i)\b|unit\s*[-–:.]?\s*(1|i)\b)",
    re.I,
)
# Headers that open the module/unit table, strongest first. PDFs often lose spaces ("DetailedContent").
CONTENT_START = [
    re.compile(r"(module|unit)\s*(no\.?)?\s*(detailed\s*)?contents?\s*(hrs?|hours)", re.I),
    re.compile(r"detailed\s*contents?", re.I),
    re.compile(r"(module|unit)\s*no\.?", re.I),
    re.compile(r"\bcontents?\s*(hrs?|hours)\b", re.I),
    re.compile(r"(?:^|\n)\s*(module|unit)\s*[-–:.]?\s*(1|i)\b", re.I),
]
# Where the module table ends. Textbooks/references are reliable; "Assessment" can appear mid-table in messy PDFs.
CONTENT_END = re.compile(r"\n\s*(text\s*-?\s*books?|reference\s*books?|references?\s*:?\s*\n|suggested\s*readings?)", re.I)
CONTENT_END_WEAK = re.compile(r"\n\s*(assessment\s*:?|useful\s*links|online\s*resources)", re.I)
NON_THEORY = re.compile(
    r"\b(lab(oratory)?|practical|mini\s*project|major\s*project|project\s*(stage|work|[- ]?\d)|skill\s*based|term\s*work|seminar|internship|workshop)\b",
    re.I,
)
NAME_STOP = re.compile(
    r"^(credits?|contact|teaching|examination|theory|course\s*(code|objectives?|outcomes?)|lab\s*objectives?|suggested|pre-?\s*requisites?|objectives?|\d)",
    re.I,
)
# Text glued after a subject name on the same line: "ComputerNetworks Pre-requisite:None", "Mini Project 2B -- -- 25".
NAME_CUT = re.compile(r"\s*(pre-?\s*requisites?|course\s*objectives?|course\s*outcomes?|lab\s*objectives?|\s--|\d+\s*$).*$", re.I)
SEMESTER_PATTERN = re.compile(r"\bsem(?:ester)?\s*[-:.]?\s*([ivx]{1,4}|\d)\b", re.I)
MAX_SEGMENT_CHARS = 6500

EXTRACTION_PROMPT = """You extract university syllabus structure for an exam study planner.
Return {"subjects":[{"name":string,"code":string,"semester":number|null,"kind":"theory"|"lab"|"project"|"other","units":[{"number":number,"title":string,"hours":number|null,"importance":1|2|3,"topics":[string]}]}]}.
Rules: include EVERY module/unit listed (usually 5-6); use the unit/module titles and topic names from the text, but restore spaces where PDF extraction joined words (e.g. "DataWarehousingand Mining" -> "Data Warehousing and Mining"); split long topic lists into short topic names (max 8 words each, max 12 topics per unit);
"hours" is the teaching hours listed for that unit/module (null if absent); "importance" ranks units within the subject: 3 only for the 1-2 most central, exam-heavy units, 1 for introductory or light units, 2 for the rest.
Ignore course objectives, outcomes, textbooks, references and assessment rules. If the text has no syllabus content, return {"subjects":[]}."""


# ---------- small helpers ----------


def normalize_key(value) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def normalize_code(code) -> str:
    return re.sub(r"[- ]", "", str(code or "").upper())


def semester_from_code(code) -> int | None:
    """Mumbai University style codes carry the semester as the first digit: CSC601 -> 6."""
    match = re.match(r"^[A-Z]+0?(\d)\d{2,3}[A-Z]?$", normalize_code(code))  # 0? tolerates typos like CSDL05012
    value = int(match.group(1)) if match else None
    return value if value and 1 <= value <= 8 else None


def find_semester_near(text: str, position: int) -> int | None:
    """Use the last 'Semester VI' mention just before this position."""
    window = text[max(0, position - 6000) : position + 400]
    matches = list(SEMESTER_PATTERN.finditer(window))
    return parse_number_token(matches[-1].group(1)) if matches else None


def to_int(value, default=None):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------- 1. segmentation ----------


def guess_subject_name(header: str, code: str) -> str:
    position = header.find(code)
    after_code = header[position + len(code) :] if position >= 0 else header
    lines = [re.sub(r"course\s*(name|title)\s*[:\-]?", "", line, flags=re.I).strip() for line in after_code.split("\n")]
    name_lines: list[str] = []
    for line in filter(None, lines):
        if NAME_STOP.match(line) or len(" ".join(name_lines)) > 60:
            break
        cut = NAME_CUT.sub("", line)
        name_lines.append(cut)
        if cut != line:
            break
    name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", " ".join(name_lines))  # "ComputerNetworks" -> "Computer Networks"
    return re.sub(r"\s+", " ", name).strip(" :-")[:90]


def slice_content(segment_text: str) -> str:
    """Keep only the module/unit table: from its heading to the textbooks/references section."""
    start = 0
    for pattern in CONTENT_START:
        match = pattern.search(segment_text, 120)
        if match:
            start = match.start()
            break
    end_match = CONTENT_END.search(segment_text, start + 300) or CONTENT_END_WEAK.search(segment_text, start + 300)
    end = end_match.start() if end_match else len(segment_text)
    return segment_text[start:end][:MAX_SEGMENT_CHARS]


def segment_by_course_codes(text: str) -> list[dict]:
    occurrences = [
        {"code": normalize_code(match.group(1)), "raw": match.group(1), "index": match.start()}
        for match in CODE_PATTERN.finditer(text)
    ]
    occurrences = [entry for entry in occurrences if not CODE_BLOCKLIST.match(entry["code"])]

    # A code starts a subject's detailed section when it is not part of a list of codes
    # (like the scheme table) and is followed by objectives / modules.
    starts: dict[str, dict] = {}
    for position, entry in enumerate(occurrences):
        if entry["code"] in starts:
            continue
        following = occurrences[position + 1] if position + 1 < len(occurrences) else None
        isolated = following is None or following["code"] == entry["code"] or following["index"] - entry["index"] > 250
        window = text[entry["index"] : entry["index"] + 1800]
        if isolated and DETAIL_HINT.search(window):
            starts[entry["code"]] = entry

    ordered = sorted(starts.values(), key=lambda entry: entry["index"])
    segments = []
    for position, entry in enumerate(ordered):
        end = ordered[position + 1]["index"] if position + 1 < len(ordered) else len(text)
        segment_text = text[entry["index"] : end]
        segments.append(
            {
                "code": entry["code"],
                "name_guess": guess_subject_name(segment_text[:400], entry["raw"]),
                "semester_guess": semester_from_code(entry["code"]) or find_semester_near(text, entry["index"]),
                "header": segment_text[:350],
                "content": slice_content(segment_text),
                "is_window": False,
            }
        )
    return segments


def segment_by_headings(text: str) -> list[dict]:
    """Fallback for syllabi without course codes: 'Subject: ...' headings, or plain windows."""
    headings = list(re.finditer(r"(?:^|\n)\s*(?:subject|course)\s*(?:name|title)?\s*[:\-–]\s*([^\n]{3,90})", text, re.I))
    if headings:
        segments = []
        for position, match in enumerate(headings):
            end = headings[position + 1].start() if position + 1 < len(headings) else len(text)
            segment_text = text[match.start() : end]
            segments.append(
                {
                    "code": "",
                    "name_guess": match.group(1).strip(),
                    "semester_guess": find_semester_near(text, match.start()),
                    "header": segment_text[:350],
                    "content": segment_text[:MAX_SEGMENT_CHARS],
                    "is_window": False,
                }
            )
        return segments

    windows = []
    for offset in range(0, len(text), MAX_SEGMENT_CHARS):
        if len(windows) >= 12:
            break
        windows.append(
            {
                "code": "",
                "name_guess": "",
                "semester_guess": find_semester_near(text, offset),
                "header": "",
                "content": text[offset : offset + MAX_SEGMENT_CHARS],
                "is_window": True,
            }
        )
    return windows


# ---------- 2/3. unit extraction (LLM first, regex fallback) ----------


def split_topics(text: str) -> list[str]:
    text = re.sub(r"\b\d+\.\d+\s*", "; ", str(text or ""))
    topics = []
    for raw in re.split(r"[;\n•●▪]|,(?![^(]*\))|\.\s+(?=[A-Z])", text):
        topic = re.sub(r"^[\s\-–:.)(]+|[\s\-–:.(]+$", "", raw or "")
        topic = re.sub(r"\s+", " ", topic)
        if 3 <= len(topic) <= 110 and re.search(r"[a-z]", topic, re.I):
            if not re.match(r"^(hrs?|hours?|total|module|unit|sr\.?\s*no|contents?)$", topic, re.I):
                topics.append(topic)
    return topics


def parse_units_with_rules(content: str) -> list[dict]:
    """Regex parser for 'Module 1 ...' / 'Unit II ...' headings or MU-style '1 Title 08' table rows."""
    markers = list(re.finditer(r"(?:^|\n)\s*(?:module|unit|chapter)\s*[-–:.]?\s*(\d{1,2}|[ivx]{1,4})\b[\s:.\-–)]*([^\n]*)", content, re.I))
    units = []

    if len(markers) >= 2:
        for position, match in enumerate(markers):
            end = markers[position + 1].start() if position + 1 < len(markers) else len(content)
            body = content[match.end() : end]
            hours_match = re.search(r"\(?\s*(\d{1,2})\s*(?:hrs?|hours?|l)\b", f"{match.group(2)} {body[:200]}", re.I)
            title = re.sub(r"\(?\s*\d{1,2}\s*(hrs?|hours?)\s*\)?", "", match.group(2), count=1, flags=re.I).strip()[:100]
            units.append(
                {
                    "number": parse_number_token(match.group(1)) or position + 1,
                    "title": title or f"Unit {position + 1}",
                    "hours": int(hours_match.group(1)) if hours_match else None,
                    "topics": split_topics(body)[:14],
                }
            )
    else:
        rows = list(re.finditer(r"(?:^|\n)\s*(\d)\s*\.?\s+([A-Z][^\n]{3,90}?)\s+(\d{1,2})\s*(?=\n|$)", content))
        for position, match in enumerate(rows):
            end = rows[position + 1].start() if position + 1 < len(rows) else len(content)
            units.append(
                {
                    "number": int(match.group(1)),
                    "title": match.group(2).strip(),
                    "hours": int(match.group(3)),
                    "topics": split_topics(content[match.end() : end])[:14],
                }
            )

    return [
        {**unit, "importance": 2, "topics": unit["topics"] or [unit["title"]]}
        for unit in units
        if unit["title"] or unit["topics"]
    ]


def extract_with_llm(segment: dict) -> list[dict]:
    hints = ""
    if segment["code"]:
        hints += f"Course code hint: {segment['code']}\n"
    if segment["name_guess"]:
        hints += f"Subject name hint: {segment['name_guess']}\n"
    if segment["header"]:
        hints += f"Header:\n{segment['header']}\n\n"

    result = chat_json(EXTRACTION_PROMPT, f"{hints}Syllabus text:\n{segment['content']}", max_tokens=1800, use_pool=True)
    subjects = result.get("subjects", result.get("items"))
    if isinstance(subjects, dict):
        subjects = [subjects]
    # The model occasionally returns odd shapes; keep only well-formed subject objects.
    return [subject for subject in subjects if isinstance(subject, dict)] if isinstance(subjects, list) else []


def topic_name(topic) -> str:
    if isinstance(topic, dict):
        return topic.get("name") or topic.get("title") or topic.get("topic") or ""
    return topic or ""


def sanitize_units(units) -> list[dict]:
    clean = []
    well_formed = [unit for unit in (units if isinstance(units, list) else []) if isinstance(unit, dict)]
    for index, unit in enumerate(well_formed):
        raw_topics = unit.get("topics") if isinstance(unit.get("topics"), list) else []
        topics = [re.sub(r"\s+", " ", str(topic_name(topic))).strip() for topic in raw_topics]
        topics = [topic for topic in topics if len(topic) >= 2][:14]
        title = re.sub(r"\s+", " ", str(unit.get("title") or "")).strip() or (topics[0] if topics else f"Unit {index + 1}")
        hours = to_float(unit.get("hours"))
        importance = to_int(unit.get("importance"))
        clean.append(
            {
                "number": to_int(unit.get("number")) or index + 1,
                "title": title[:120],
                "hours": hours if hours is not None and 0 < hours <= 40 else None,
                "importance": importance if importance in (1, 2, 3) else 2,
                "topics": topics or [title],
            }
        )
    return clean


# ---------- 4. chunks ----------


def build_chunks(subjects: list[dict]) -> list[dict]:
    chunks = []
    for subject in subjects:
        label = subject["name"]
        if subject["code"]:
            label += f" ({subject['code']})"
        if subject["semester"]:
            label += f" | Semester {subject['semester']}"
        for unit in subject["units"]:
            chunks.append(
                {
                    "subjectKey": subject["key"],
                    "unitNumber": unit["number"],
                    "text": f"{label} | Unit {unit['number']}: {unit['title']} | Topics: {'; '.join(unit['topics'])}",
                }
            )
    return chunks


# ---------- main entry ----------


def _cache_path(segment: dict) -> Path:
    fingerprint = json.dumps([CACHE_VERSION, EXTRACTION_PROMPT, segment["code"], segment["name_guess"], segment["header"], segment["content"]])
    return CACHE_DIR / f"{hashlib.sha256(fingerprint.encode('utf8')).hexdigest()}.json"


def extract_segment(segment: dict, use_llm: bool) -> tuple[list[dict], bool, bool]:
    """Extract one subject segment. Returns (subjects, non_theory, llm_failed)."""
    # Lab codes look like CSL601 (two letters + L + digits); CSDLO6011 / CSDL05012 are elective theory courses.
    non_theory = bool(NON_THEORY.search(segment["name_guess"]) or re.match(r"^[A-Z]{2}L\d{3}[A-Z]?$", segment["code"]))
    if non_theory:
        return [{"name": segment["name_guess"] or segment["code"], "code": segment["code"], "kind": "lab", "units": []}], True, False

    rule_units = [] if segment["is_window"] else parse_units_with_rules(segment["content"])
    extracted: list[dict] = []
    failed = False

    if use_llm:
        cache_file = _cache_path(segment)
        if cache_file.exists():
            try:
                return json.loads(cache_file.read_text(encoding="utf8")), False, False
            except (OSError, ValueError):
                pass

        # Self-check: the regex parser counts the modules too. If the LLM returns fewer, ask once more.
        for _attempt in range(2):
            try:
                extracted = extract_with_llm(segment)
            except Exception as error:  # one bad reply must not fail the whole syllabus; fall back to rules
                failed = True
                log.warning("LLM extraction failed for %s: %s", segment["code"] or segment["name_guess"] or "segment", error)
                break
            llm_unit_count = sum(len(subject.get("units") or []) for subject in extracted)
            if segment["is_window"] or llm_unit_count >= len(rule_units):
                break
        if extracted and not segment["is_window"] and len(extracted) == 1:
            if len(extracted[0].get("units") or []) < len(rule_units):
                extracted[0]["units"] = rule_units

        if extracted and not failed:
            try:
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                cache_file.write_text(json.dumps(extracted), encoding="utf8")
            except OSError as error:
                log.warning("could not write extraction cache: %s", error)

    if not extracted and not segment["is_window"]:
        extracted = [{"name": segment["name_guess"], "code": segment["code"], "units": rule_units}]
    return extracted, False, failed


def iter_ingest(raw_text: str) -> Iterator[dict]:
    """Yield {"type": "progress", ...} updates, then one {"type": "result", ...}.

    Subjects are extracted in parallel (one worker per model in the pool) and cached on disk,
    so re-indexing the same syllabus is instant.
    """
    text = clean_pdf_text(raw_text)
    segments = segment_by_course_codes(text) or segment_by_headings(text)
    use_llm = is_llm_available()
    merged: dict[str, dict] = {}
    llm_failures = 0
    results: list[tuple[list[dict], bool, bool] | None] = [None] * len(segments)

    yield {"type": "progress", "done": 0, "total": len(segments)}

    workers = len(model_pool()) if use_llm else 1
    executor = ThreadPoolExecutor(max_workers=max(1, workers))
    try:
        futures = {executor.submit(extract_segment, segment, use_llm): index for index, segment in enumerate(segments)}
        pending = set(futures)
        while pending:
            finished, pending = wait(pending, timeout=HEARTBEAT_SECONDS, return_when=FIRST_COMPLETED)
            if not finished:
                # Keep the HTTP stream alive while models are rate limited.
                yield {"type": "heartbeat"}
            for future in finished:
                results[futures[future]] = future.result()
            if finished:
                yield {"type": "progress", "done": len(futures) - len(pending), "total": len(segments)}
    finally:
        # If the caller disconnects, don't keep spending tokens on queued subjects.
        executor.shutdown(wait=False, cancel_futures=True)

    for segment, (extracted, non_theory, failed) in zip(segments, results):
        llm_failures += int(failed)
        for subject in extracted:
            code = normalize_code(subject.get("code") or segment["code"] or "")
            name = str(subject.get("name") or segment["name_guess"] or code or "Subject")
            name = re.sub(r"\s+", " ", re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)).strip()
            key = code or normalize_key(name)
            if not key:
                continue

            llm_semester = to_int(subject.get("semester"))
            semester = segment["semester_guess"] or semester_from_code(code) or (llm_semester if llm_semester and llm_semester > 0 else None)
            if non_theory or NON_THEORY.search(name):
                kind = "lab"
            else:
                kind = subject.get("kind") if subject.get("kind") in ("theory", "lab", "project", "other") else "theory"
            units = sanitize_units(subject.get("units"))

            if key in merged:
                existing = merged[key]
                known_titles = {normalize_key(unit["title"]) for unit in existing["units"]}
                existing["units"].extend(unit for unit in units if normalize_key(unit["title"]) not in known_titles)
                existing["semester"] = existing["semester"] or semester
            else:
                merged[key] = {"key": key, "name": name, "code": code, "semester": semester, "kind": kind, "units": units}

    subjects = []
    for subject in merged.values():
        subject["units"].sort(key=lambda unit: unit["number"])
        if subject["kind"] != "theory" or subject["units"]:
            subjects.append(subject)

    yield {
        "type": "result",
        "subjects": subjects,
        "chunks": build_chunks([subject for subject in subjects if subject["kind"] == "theory"]),
        "semesters": sorted({subject["semester"] for subject in subjects if subject["semester"]}),
        "extractionMode": "rules" if not use_llm else ("mixed" if llm_failures else "ai"),
    }


def ingest_syllabus_text(raw_text: str) -> dict:
    """Convenience wrapper that runs the whole ingestion and returns only the result."""
    result = {}
    for event in iter_ingest(raw_text):
        if event["type"] == "result":
            result = event
    return result
