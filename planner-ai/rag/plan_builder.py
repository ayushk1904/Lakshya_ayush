"""Generation step of the RAG pipeline: turns a student's request into a timed study plan.

Pipeline for one request:
  1. Intent     - understand the request (semester? subjects? days left? hours per day?)
  2. Scope      - pick the subjects from the indexed syllabus
  3. Retrieval  - BM25 over syllabus chunks finds units the student explicitly mentions;
                  past papers give "asked N times" evidence per topic
  4. Priority   - score every unit/topic from past-paper frequency, lecture hours and importance
  5. Allocation - fit topics into the available time (fair share per subject when time is short)
  6. Timetable  - exact clock times with breaks, lunch and revision (done in code, not by the LLM)
  7. Strategy   - the LLM writes advice grounded in the retrieved units and the real schedule
"""

import logging
import math
import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from . import electives
from .llm import chat_json, is_llm_available
from .pyq_analyzer import analyze_papers, topic_id
from .text_utils import Bm25Index, js_round, parse_number_token, tokenize

log = logging.getLogger("planner-ai.plan")

QUICK_MINUTES = 15
LUNCH_START = 13 * 60
LUNCH_MINUTES = 45
MAX_DAYS = 60
REQUEST_WORDS = set(
    tokenize(
        """make create build generate prepare plan plans planner schedule timetable time table complete cover finish remaining left day days week weeks month
        exam exams test tomorrow today tonight only help tell please subject subjects all whole entire full every each study learn revise revision
        priority important quickly fast hour hours daily per start starting from give need want can could my me i am have has""",
        keep_stopwords=True,
    )
)
WORD_NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
                "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30}
MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}


class PlannerError(Exception):
    """An error the student should see (e.g. asking for a semester that was never uploaded)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class TopicPlan:
    name: str
    index: int
    base: int  # minutes needed to study it fully
    pyq_questions: int
    pyq_papers: int
    samples: list[str]
    score: float = 0.0
    allocated: int = 0  # minutes actually given in this plan
    skipped: bool = False


@dataclass
class UnitPlan:
    subject: dict
    unit: dict
    topics: list[TopicPlan]
    focused: bool
    has_pyq_data: bool
    pyq_questions: int
    pyq_papers: int
    samples: list[str]
    raw: float = 0.0
    score: float = 0.0


@dataclass
class Block:
    """One study session in the timetable (up to `session_minutes` long)."""

    unit: UnitPlan
    mode: str
    topics: list[str] = field(default_factory=list)
    minutes: int = 0
    pyq_questions: int = 0


# ---------- small helpers ----------


def round5(value: float) -> int:
    return max(5, js_round(value / 5) * 5)


def to_minutes(clock: str) -> int:
    parts = str(clock or "").split(":")
    try:
        hours = int(parts[0])
    except (ValueError, IndexError):
        hours = 0
    try:
        minutes = int(parts[1])
    except (ValueError, IndexError):
        minutes = 0
    return hours * 60 + minutes


def to_clock(total_minutes: float) -> str:
    value = max(0, min(24 * 60 - 1, js_round(total_minutes)))
    return f"{value // 60:02d}:{value % 60:02d}"


def add_days(date_string: str, offset: int) -> str:
    return (date.fromisoformat(date_string) + timedelta(days=offset)).isoformat()


def day_label(date_string: str, index: int) -> str:
    day = date.fromisoformat(date_string)
    return f"Day {index + 1} · {day:%a}, {day.day} {day:%b}"


def days_between(from_date: str, to_date: str) -> int:
    return (date.fromisoformat(to_date) - date.fromisoformat(from_date)).days


def acronym(name: str) -> str:
    words = [word for word in re.split(r"[\s&/-]+", name or "") if word and not re.match(r"^(and|of|the|for|in|to|with|a|an)$", word, re.I)]
    return "".join(word[0] for word in words).upper()


def first_set(*values):
    """Like JavaScript's `a ?? b ?? c`."""
    for value in values:
        if value is not None:
            return value
    return None


def number_or(value, default: float) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


# ---------- 1. intent ----------


def parse_exam_date(message: str, start_date: str) -> str | None:
    iso = re.search(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b", message)
    if iso:
        return f"{iso.group(1)}-{int(iso.group(2)):02d}-{int(iso.group(3)):02d}"

    start = date.fromisoformat(start_date)
    month_names = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec"
    day_first = re.search(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({month_names})[a-z]*\b", message, re.I)
    month_first = re.search(rf"\b({month_names})[a-z]*\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", message, re.I)
    if day_first or month_first:
        day_text, month_text = (day_first.group(1), day_first.group(2)) if day_first else (month_first.group(2), month_first.group(1))
        month = MONTHS[month_text[:3].lower()]
        year = start.year + 1 if month < start.month else start.year
        return f"{year}-{month:02d}-{int(day_text):02d}"

    numeric = re.search(r"\b(?:on|by|exam\s+(?:is\s+)?(?:on)?)\s*(\d{1,2})[/.](\d{1,2})\b", message, re.I)
    if numeric:
        month = int(numeric.group(2))
        year = start.year + 1 if month < start.month else start.year
        return f"{year}-{month:02d}-{int(numeric.group(1)):02d}"
    return None


def match_subjects_by_rules(message: str, subjects: list[dict]) -> list[str]:
    lower = message.lower()
    message_tokens = set(tokenize(message))
    token_owners: dict[str, list[str]] = {}
    for subject in subjects:
        for token in set(tokenize(subject["name"])):
            token_owners.setdefault(token, []).append(subject["key"])

    keys = []
    for subject in subjects:
        short = acronym(subject["name"])
        name_tokens = list(dict.fromkeys(tokenize(subject["name"])))
        hits = [token for token in name_tokens if token in message_tokens]
        unique_hit = any(len(token) >= 5 and len(token_owners.get(token, [])) == 1 for token in hits)
        if (
            (subject.get("code") and subject["code"].lower() in lower)
            or (subject["name"] and subject["name"].lower() in lower)
            or (len(short) >= 2 and re.search(rf"\b{re.escape(short)}\b", message, re.I))
            or (name_tokens and len(hits) >= min(2, len(name_tokens)))
            or unique_hit
        ):
            keys.append(subject["key"])
    return keys


def parse_intent_with_rules(message: str, subjects: list[dict], start_date: str) -> dict:
    text = message.lower()
    intent = {"semester": None, "subject_keys": [], "days_available": None, "exam_date": None, "hours_per_day": None, "mode": "full"}

    semester = re.search(r"\bsem(?:ester)?\s*[-:.]?\s*(\d|[ivx]{1,4})\b", text) or re.search(r"\b(\d)(?:st|nd|rd|th)\s+sem", text)
    if semester:
        intent["semester"] = parse_number_token(semester.group(1))

    number_word = "|".join(WORD_NUMBERS)
    days = re.search(rf"\b(\d{{1,2}}|{number_word})\s*(?:more\s+|remaining\s+)?days?\b", text)
    weeks = re.search(rf"\b(\d{{1,2}}|{number_word}|a)\s*weeks?\b", text)
    if days:
        value = days.group(1)
        intent["days_available"] = int(value) if value.isdigit() else WORD_NUMBERS[value]
    elif weeks:
        value = weeks.group(1)
        intent["days_available"] = 7 * (1 if value == "a" else int(value) if value.isdigit() else WORD_NUMBERS[value])
    elif re.search(r"\btomorrow\b", text):
        intent["days_available"] = 1

    intent["exam_date"] = parse_exam_date(message, start_date)
    if intent["exam_date"] and not intent["days_available"]:
        intent["days_available"] = max(1, days_between(start_date, intent["exam_date"]))

    hours = re.search(r"(\d{1,2}(?:\.\d)?)\s*(?:hours?|hrs?)\s*(?:a|per|each|every)?\s*(?:day|daily)", text) or re.search(
        r"daily\s*(\d{1,2}(?:\.\d)?)\s*(?:hours?|hrs?)", text
    )
    if hours:
        intent["hours_per_day"] = float(hours.group(1))

    if re.search(r"\b(today|tonight)\b", text) and not intent["days_available"]:
        intent["mode"] = "today"
        intent["days_available"] = 1

    intent["subject_keys"] = [] if re.search(r"\ball\s+(the\s+)?subjects\b", text) else match_subjects_by_rules(message, subjects)
    return intent


def parse_intent_with_llm(message: str, subjects: list[dict], start_date: str) -> dict:
    catalogue = "\n".join(
        f"{subject['key']} | {subject.get('code') or '-'} | {subject['name']} | sem {subject.get('semester') or '?'}" for subject in subjects
    )
    result = chat_json(
        """You read a student's study-plan request and map it to their syllabus.
Return {"semester":number|null,"subjectKeys":[string],"daysAvailable":number|null,"examDate":"YYYY-MM-DD"|null,"hoursPerDay":number|null,"mode":"full"|"crash"|"today","focusTopics":[string]}.
subjectKeys must be keys from the catalogue, only when the student names specific subjects (abbreviations like DBMS, AI, CN count); empty when they ask for a whole semester or all subjects.
daysAvailable = number of study days left before the exam if stated or implied. mode "crash" when time is short, "today" for a plan only for today.""",
        f"Today: {start_date}\nCatalogue (key | code | name | semester):\n{catalogue}\n\nRequest: {message}",
        max_tokens=400,
    )
    known_keys = {subject["key"] for subject in subjects}
    days = number_or(result.get("daysAvailable"), 0)
    hours = number_or(result.get("hoursPerDay"), 0)
    semester = result.get("semester")
    exam_date = result.get("examDate") or ""
    return {
        "semester": semester if isinstance(semester, int) and not isinstance(semester, bool) else None,
        "subject_keys": [key for key in (result.get("subjectKeys") or []) if key in known_keys],
        "days_available": js_round(days) if days > 0 else None,
        "exam_date": exam_date if re.match(r"^\d{4}-\d{2}-\d{2}$", exam_date) else None,
        "hours_per_day": hours if hours > 0 else None,
        "mode": result.get("mode") if result.get("mode") in ("full", "crash", "today") else "full",
        "focus_topics": [str(topic) for topic in (result.get("focusTopics") or [])][:6],
    }


def resolve_intent(message: str, subjects: list[dict], start_date: str) -> dict:
    """Rules catch exact numbers/dates reliably; the LLM understands abbreviations and phrasing. Combine both."""
    ruled = parse_intent_with_rules(message, subjects, start_date)
    if not is_llm_available():
        return {**ruled, "focus_topics": []}

    try:
        llm = parse_intent_with_llm(message, subjects, start_date)
    except Exception as error:  # a bad AI reply falls back to rules instead of failing the plan
        log.warning("intent LLM error: %s", error)
        return {**ruled, "focus_topics": []}

    days_from_date = max(1, days_between(start_date, llm["exam_date"])) if llm["exam_date"] else None
    return {
        "semester": first_set(ruled["semester"], llm["semester"]),
        "subject_keys": llm["subject_keys"] or ruled["subject_keys"],
        "days_available": first_set(ruled["days_available"], llm["days_available"], days_from_date),
        "exam_date": first_set(ruled["exam_date"], llm["exam_date"]),
        "hours_per_day": first_set(ruled["hours_per_day"], llm["hours_per_day"]),
        "mode": "today" if ruled["mode"] == "today" else llm["mode"],
        "focus_topics": llm["focus_topics"],
    }


# ---------- 2. scope + 3. retrieval ----------


def resolve_scope(intent: dict, subjects: list[dict]) -> dict:
    theory = [subject for subject in subjects if subject.get("kind") == "theory" and subject["units"]]
    warnings: list[str] = []
    semesters = sorted({subject["semester"] for subject in theory if subject.get("semester")})

    if intent["subject_keys"]:
        picked = [subject for subject in theory if subject["key"] in intent["subject_keys"]]
        if picked:
            return {"type": "subjects", "semester": None, "subjects": picked, "warnings": warnings}

    if intent["semester"]:
        picked = [subject for subject in theory if subject.get("semester") == intent["semester"]]
        if picked:
            return {"type": "semester", "semester": intent["semester"], "subjects": picked, "warnings": warnings}
        if not semesters:
            warnings.append("Semester numbers were not found in your syllabus, so all of its subjects are included.")
            return {"type": "semester", "semester": intent["semester"], "subjects": theory, "warnings": warnings}
        covered = ", ".join(str(value) for value in semesters)
        raise PlannerError(
            f"Your uploaded syllabus covers Semester {covered}, not Semester {intent['semester']}. "
            f"Upload the Semester {intent['semester']} syllabus PDF first."
        )

    if len(semesters) > 1:
        warnings.append(
            f"Your syllabi cover Semesters {', '.join(str(value) for value in semesters)}. "
            f'Mention a semester (e.g. "Semester {semesters[-1]}") to narrow the plan.'
        )
    return {"type": "all", "semester": None, "subjects": theory, "warnings": warnings}


def retrieve_focus_units(message: str, intent: dict, scope_subjects: list[dict], chunks: list[dict]) -> tuple[set[str], list[dict]]:
    """BM25 search over unit chunks with whatever is left of the request after removing generic words and subject names."""
    name_tokens = {token for subject in scope_subjects for token in tokenize(f"{subject['name']} {subject.get('code', '')}")}
    query = tokenize(message) + [token for topic in intent["focus_topics"] for token in tokenize(topic)]
    query = [token for token in query if token not in REQUEST_WORDS and token not in name_tokens]
    scope_keys = {subject["key"] for subject in scope_subjects}
    scoped_chunks = [chunk for chunk in chunks if chunk["subjectKey"] in scope_keys]

    if not query or not scoped_chunks:
        return set(), []

    index = Bm25Index([tokenize(chunk["text"]) for chunk in scoped_chunks])
    results = index.search(query, limit=6, min_score=1.2)
    best = results[0]["score"] if results else 0
    hits = [scoped_chunks[hit["index"]] for hit in results if hit["score"] >= best * 0.55]
    return {f"{chunk['subjectKey']}::{chunk['unitNumber']}" for chunk in hits}, hits


# ---------- 4. priority ----------


def score_units(scope_subjects: list[dict], pyq: dict, focus_units: set[str]) -> list[UnitPlan]:
    units: list[UnitPlan] = []

    for subject in scope_subjects:
        max_hours = max([1, *[unit.get("hours") or 0 for unit in subject["units"]]])
        has_papers = subject["key"] in pyq["subjects_with_papers"]
        entries: list[UnitPlan] = []

        for unit in subject["units"]:
            unit_minutes = unit["hours"] * 60 if unit.get("hours") else min(600, max(120, len(unit["topics"]) * 45))
            topic_base = min(120, max(20, round5(unit_minutes / len(unit["topics"]))))
            topics = []
            for index, name in enumerate(unit["topics"]):
                stat = pyq["stats"].get(topic_id(subject["key"], unit["number"], index), {"questions": 0, "papers": 0, "samples": []})
                topics.append(TopicPlan(name, index, topic_base, stat["questions"], stat["papers"], stat["samples"]))
            entries.append(
                UnitPlan(
                    subject=subject,
                    unit=unit,
                    topics=topics,
                    focused=f"{subject['key']}::{unit['number']}" in focus_units,
                    has_pyq_data=has_papers,
                    pyq_questions=sum(topic.pyq_questions for topic in topics),
                    pyq_papers=max([0, *[topic.pyq_papers for topic in topics]]),
                    samples=[sample for topic in topics for sample in topic.samples][:2],
                )
            )

        max_unit_questions = max([1, *[entry.pyq_questions for entry in entries]])
        max_topic_questions = max([1, *[topic.pyq_questions for entry in entries for topic in entry.topics]])

        for entry in entries:
            hours_share = entry.unit["hours"] / max_hours if entry.unit.get("hours") else 0.6
            importance = ((entry.unit.get("importance") or 2) - 1) / 2
            structural = 0.65 * hours_share + 0.35 * importance
            pyq_share = entry.pyq_questions / max_unit_questions
            entry.raw = (0.4 * structural + 0.6 * pyq_share if has_papers else structural) + (0.35 if entry.focused else 0)

        # Scores are relative within a subject, so every subject's most important unit leads the plan.
        max_raw = max(entry.raw for entry in entries)
        min_raw = min(entry.raw for entry in entries)
        for entry in entries:
            spread = max_raw - min_raw
            entry.score = round(0.7 if spread < 0.01 else 0.15 + 0.85 * (entry.raw - min_raw) / spread, 3)
            if entry.focused:
                entry.score = max(entry.score, 0.95)
            for topic in entry.topics:
                topic.score = min(1, 0.55 * entry.score + 0.45 * topic.pyq_questions / max_topic_questions) if has_papers else entry.score
            units.append(entry)

    units.sort(key=lambda entry: (-int(entry.focused), -entry.score, -entry.pyq_questions, entry.unit["number"]))
    return units


def priority_label(score: float) -> str:
    if score >= 0.66:
        return "high"
    return "medium" if score >= 0.4 else "low"


# ---------- 5. time allocation ----------


def day_capacity(start_minute: int, end_minute: int, session_minutes: int, break_minutes: int) -> int:
    """Study minutes that fit in a day window once breaks and lunch are taken out."""
    window = max(0, end_minute - start_minute)
    lunch = LUNCH_MINUTES if start_minute < LUNCH_START and end_minute > LUNCH_START + 60 else 0
    usable = window - lunch
    breaks = max(0, usable // (session_minutes + break_minutes)) * break_minutes
    return max(0, math.floor(usable - breaks))


def allocate_group(entries: list[tuple[TopicPlan, UnitPlan]], budget: float) -> None:
    required = sum(topic.base for topic, _ in entries)
    if required <= budget:
        return

    # When time is very short, defer topics that are low priority and have never been asked.
    if budget / required < 0.45:
        deferrable = [topic for topic, _ in entries if topic.score < 0.3 and not topic.pyq_questions]
        if len(deferrable) < len(entries):
            for topic in deferrable:
                topic.skipped = True

    by_score = sorted((topic for topic, _ in entries if not topic.skipped), key=lambda topic: topic.score)
    while len(by_score) > 1 and len(by_score) * QUICK_MINUTES > budget:
        by_score.pop(0).skipped = True

    live = [topic for topic, _ in entries if not topic.skipped]

    def share(topic: TopicPlan, factor: float) -> float:
        return min(topic.base, max(QUICK_MINUTES, topic.base * (0.25 + 0.75 * topic.score) * factor))

    # Binary search one scaling factor so the group exactly fills its budget; higher scores get more time.
    low, high = 0.0, 20.0
    for _ in range(40):
        middle = (low + high) / 2
        if sum(share(topic, middle) for topic in live) > budget:
            high = middle
        else:
            low = middle

    for topic in live:
        topic.allocated = max(QUICK_MINUTES, math.floor(share(topic, low) / 5) * 5)
    for topic, _ in entries:
        if topic.skipped:
            topic.allocated = 0


def allocate(units: list[UnitPlan], available_minutes: float) -> bool:
    """Give every topic its minutes. Returns True when time was short ("crunch" / crash plan)."""
    entries = [(topic, unit) for unit in units for topic in unit.topics]
    required = sum(topic.base for topic, _ in entries)
    for topic, _ in entries:
        topic.allocated = topic.base
        topic.skipped = False

    if required <= available_minutes:
        return False

    # Every subject has its own exam, so each gets a fair share of the time before topics compete inside it.
    groups: dict[str, list[tuple[TopicPlan, UnitPlan]]] = {}
    for topic, unit in entries:
        groups.setdefault(unit.subject["key"], []).append((topic, unit))
    for group in groups.values():
        group_required = sum(topic.base for topic, _ in group)
        allocate_group(group, available_minutes * group_required / required)
    return True


def study_mode(topic: TopicPlan) -> str:
    ratio = topic.allocated / topic.base
    if ratio >= 0.85:
        return "Deep study"
    return "Focused study" if ratio >= 0.5 else "Quick study"


def build_blocks(units: list[UnitPlan], session_minutes: int) -> list[Block]:
    """Pour each unit's topic minutes into fixed-length study sessions."""
    blocks: list[Block] = []
    for unit in units:
        unit_blocks: list[Block] = []
        current: Block | None = None
        for topic in unit.topics:
            if topic.skipped or topic.allocated <= 0:
                continue
            remaining = topic.allocated
            first = True
            while remaining > 0:
                if current is None or current.minutes >= session_minutes:
                    current = Block(unit=unit, mode=study_mode(topic))
                    unit_blocks.append(current)
                take = min(session_minutes - current.minutes, remaining)
                if 0 < remaining - take < 10:
                    take = remaining
                current.topics.append(topic.name if first else f"{topic.name} (contd.)")
                current.minutes += take
                current.pyq_questions += topic.pyq_questions if first else 0
                remaining -= take
                first = False

        # Fold a tiny last session into the previous one.
        if len(unit_blocks) >= 2 and unit_blocks[-1].minutes < 25:
            last = unit_blocks.pop()
            previous = unit_blocks[-1]
            previous.minutes += last.minutes
            previous.topics.extend(name for name in last.topics if name.replace(" (contd.)", "") not in previous.topics)
        blocks.extend(unit_blocks)
    return blocks


def interleave_subjects(blocks: list[Block], sessions_per_turn: int = 1) -> list[Block]:
    """Rotate subjects session by session so a day mixes subjects instead of one subject all day.

    Each subject keeps its own order (highest-priority units first, topics in sequence);
    subjects take turns, starting with the one whose top unit matters most.
    """
    queues: dict[str, list[Block]] = {}
    for block in blocks:
        queues.setdefault(block.unit.subject["key"], []).append(block)
    if len(queues) < 2:
        return blocks

    rotation = sorted(queues, key=lambda key: (-queues[key][0].unit.score, -queues[key][0].unit.pyq_questions))
    mixed: list[Block] = []
    while any(queues[key] for key in rotation):
        for key in rotation:
            mixed.extend(queues[key][:sessions_per_turn])
            del queues[key][:sessions_per_turn]
    return mixed


# ---------- 6. timetable ----------


def study_item(block: Block, start: int, minutes: int) -> dict:
    return {
        "type": "study",
        "start": to_clock(start),
        "end": to_clock(start + minutes),
        "minutes": minutes,
        "subject": block.unit.subject["name"],
        "code": block.unit.subject.get("code") or "",
        "unit": block.unit.unit["title"],
        "unitNumber": block.unit.unit["number"],
        "topics": list(block.topics),
        "priority": priority_label(block.unit.score),
        "mode": block.mode,
        "pyqQuestions": block.pyq_questions,
    }


def schedule_days(blocks: list[Block], revision_units: list[UnitPlan], settings: dict, day_count: int, fixed_days: bool) -> tuple[list[dict], list[Block]]:
    days: list[dict] = []
    queue = [Block(block.unit, block.mode, list(block.topics), block.minutes, block.pyq_questions) for block in blocks]
    daily_start = to_minutes(settings["dailyStart"])
    daily_end = to_minutes(settings["dailyEnd"])
    break_minutes = settings["breakMinutes"]
    revision_budget = settings["revisionMinutes"]
    max_days = day_count if fixed_days else MAX_DAYS
    revision_pointer = 0

    index = 0
    while index < max_days and (queue or (fixed_days and index < day_count)):
        day_date = add_days(settings["startDate"], index)
        is_last_day = fixed_days and index == day_count - 1
        cursor = max(daily_start, settings["firstDayStart"]) if index == 0 else daily_start
        study_end = max(cursor, daily_end - revision_budget) if is_last_day and revision_budget else daily_end
        items: list[dict] = []
        lunch_taken = False

        def maybe_lunch(next_minutes: int) -> None:
            nonlocal cursor, lunch_taken
            if not lunch_taken and 12 * 60 <= cursor < 15 * 60 and cursor + next_minutes > LUNCH_START + 15:
                if items and items[-1]["type"] == "break":
                    cursor -= items.pop()["minutes"]
                items.append({"type": "lunch", "start": to_clock(cursor), "end": to_clock(cursor + LUNCH_MINUTES), "minutes": LUNCH_MINUTES, "title": "Lunch break"})
                cursor += LUNCH_MINUTES
                lunch_taken = True

        def add_break() -> None:
            nonlocal cursor
            if break_minutes > 0:
                items.append({"type": "break", "start": to_clock(cursor), "end": to_clock(cursor + break_minutes), "minutes": break_minutes, "title": "Short break"})
                cursor += break_minutes

        def add_revision(slot_minutes: int, label: str) -> None:
            nonlocal cursor, revision_pointer
            count = 0
            while count < len(revision_units) * 3 and daily_end - cursor >= 20:
                unit = revision_units[revision_pointer % len(revision_units)]
                revision_pointer += 1
                maybe_lunch(slot_minutes)
                minutes = min(slot_minutes, daily_end - cursor)
                items.append(
                    {
                        "type": "revision",
                        "start": to_clock(cursor),
                        "end": to_clock(cursor + minutes),
                        "minutes": minutes,
                        "subject": unit.subject["name"],
                        "code": unit.subject.get("code") or "",
                        "unit": unit.unit["title"],
                        "unitNumber": unit.unit["number"],
                        "topics": [topic.name for topic in unit.topics if not topic.skipped][:4],
                        "priority": priority_label(unit.score),
                        "mode": "Revise + solve PYQs" if unit.pyq_questions else label,
                        "pyqQuestions": unit.pyq_questions,
                    }
                )
                cursor += minutes
                if daily_end - cursor >= 20 + break_minutes:
                    add_break()
                count += 1

        # New learning first.
        while queue:
            block = queue[0]
            maybe_lunch(block.minutes)
            room = study_end - cursor
            if room < block.minutes and (room < 25 or block.minutes - room < 20):
                break
            minutes = min(block.minutes, room)
            items.append(study_item(block, cursor, minutes))
            cursor += minutes
            if minutes < block.minutes:
                # Session continues tomorrow.
                block.minutes -= minutes
                block.topics = [name if name.endswith("(contd.)") else f"{name} (contd.)" for name in block.topics]
                break
            queue.pop(0)
            if queue and study_end - cursor >= 20 + break_minutes:
                add_break()

        # Spare time before the exam becomes revision rounds; the last day is for final revision.
        if revision_units and fixed_days and not queue and not is_last_day and daily_end - cursor >= 45:
            if items:
                add_break()
            add_revision(45, "Revision round")
        if revision_units and is_last_day and revision_budget:
            if items:
                add_break()
            add_revision(45 if daily_end - cursor > 180 else 30, "Final revision")

        if items and items[-1]["type"] == "break":
            items.pop()

        days.append(
            {
                "date": day_date,
                "label": day_label(day_date, index),
                "studyMinutes": sum(item["minutes"] for item in items if item["type"] in ("study", "revision")),
                "items": items,
            }
        )
        index += 1

    return days, queue


# ---------- 7. strategy ----------


def summarize_days(days: list[dict]) -> list[str]:
    lines = []
    for day in days[:14]:
        per_unit: dict[str, int] = {}
        for item in day["items"]:
            if item["type"] in ("study", "revision"):
                key = f"{'revise ' if item['type'] == 'revision' else ''}{item['code'] or item['subject']} {item['unit']}"
                per_unit[key] = per_unit.get(key, 0) + item["minutes"]
        parts = "; ".join(f"{key} ({minutes} min)" for key, minutes in per_unit.items())
        lines.append(f"{day['label']}: {parts[:320]}")
    return lines


def fallback_strategy(scope_label: str, units: list[UnitPlan], crunch: bool, coverage: int, days: int, has_pyq: bool) -> dict:
    top = ", ".join(f"{entry.unit['title']} ({entry.subject['name']})" for entry in units[:3])
    return {
        "headline": (
            f"{days} day crash plan for {scope_label}: high-yield units first, {coverage}% of the syllabus covered."
            if crunch
            else f"{days} day plan for {scope_label} covering the full syllabus in priority order."
        ),
        "bullets": [
            f"Start with {top}. They carry the highest {'past-paper frequency and ' if has_pyq else ''}weightage.",
            "Topics marked Quick study get a short focused pass. Learn definitions, diagrams and one solved example."
            if crunch
            else "Finish each unit with a 10 minute self-quiz before moving on.",
            "After each unit, attempt the matching previous-year questions shown in the plan."
            if has_pyq
            else "Upload previous-year papers to let Lakshya rank topics by how often they are asked.",
            "Keep the breaks short and stick to the timings. Consistency beats long sessions.",
        ],
        "subjectTips": [],
    }


def generate_strategy(message, scope_label, units, crunch, coverage, days, hours_per_day, skipped_count, has_pyq, retrieved, day_summaries) -> dict:
    base = fallback_strategy(scope_label, units, crunch, coverage, days, has_pyq)
    if not is_llm_available():
        return base

    context_lines = []
    for entry in units[:14]:
        line = f"- [{priority_label(entry.score)}] {entry.subject['name']} › Unit {entry.unit['number']}: {entry.unit['title']}"
        if entry.unit.get("hours"):
            line += f" ({entry.unit['hours']} hrs)"
        if entry.pyq_questions:
            line += f", asked {entry.pyq_questions}x in past papers"
        if entry.samples:
            line += f' e.g. "{entry.samples[0][:120]}"'
        context_lines.append(line)

    time_note = (
        f"Time is short: {coverage}% of full syllabus time fits, {skipped_count} low-priority topics deferred."
        if crunch
        else "Enough time for full coverage."
    )
    pyq_note = "Past-paper frequency data available." if has_pyq else "No past papers uploaded; priority is from syllabus hours/weightage."
    matches = ""
    if retrieved:
        matches = "Units matching the student's request:\n" + "\n".join(f"- {chunk['text'][:200]}" for chunk in retrieved)

    try:
        result = chat_json(
            """You are Lakshya, an exam strategist for Indian engineering students. Use ONLY the retrieved syllabus units and past-paper evidence given.
Return {"headline":string,"bullets":[string],"subjectTips":[{"subject":string,"tip":string}]}.
headline: one sentence. bullets: 4-6 concrete, actionable points that follow the given day-by-day schedule (what to do first and why, how to handle low-priority topics, revision and PYQ practice). subjectTips: one short tip per subject in scope (max 6). Plain text, no markdown. Never invent hours, marks or numbers that are not in the input.""",
            f"""Student request: {message}
Scope: {scope_label}. Days: {days}. Study hours/day: {hours_per_day}. {time_note}
{pyq_note}
Retrieved syllabus units by priority:
{chr(10).join(context_lines)}
Day-by-day schedule (already fixed by the planner):
{chr(10).join(day_summaries)}
{matches}""",
            max_tokens=900,
            temperature=0.4,
        )
    except Exception as error:  # a bad AI reply falls back to rules instead of failing the plan
        log.warning("strategy LLM error: %s", error)
        return base

    bullets = result.get("bullets") if isinstance(result.get("bullets"), list) else base["bullets"]
    tips = result.get("subjectTips") if isinstance(result.get("subjectTips"), list) else []
    return {
        "headline": str(result.get("headline") or base["headline"])[:300],
        "bullets": [str(bullet) for bullet in bullets][:6],
        "subjectTips": [
            {"subject": str(tip["subject"]), "tip": str(tip["tip"])}
            for tip in tips
            if isinstance(tip, dict) and tip.get("subject") and tip.get("tip")
        ][:8],
    }


# ---------- main entry ----------


def build_study_plan(message: str, syllabi: list[dict], papers: list[dict], preferences: dict) -> dict:
    subjects = [{**subject, "fileName": syllabus.get("fileName")} for syllabus in syllabi for subject in syllabus.get("subjects", [])]
    chunks = [chunk for syllabus in syllabi for chunk in syllabus.get("chunks", [])]
    start_date_input = preferences.get("startDate") or ""
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", start_date_input):
        start_date_input = date.today().isoformat()

    # 1-3: intent, scope, retrieval
    intent = resolve_intent(message, [subject for subject in subjects if subject.get("kind") == "theory"], start_date_input)

    # "Semester 6 with Distributed Computing": naming only optional courses next to a semester / "all subjects"
    # means "the whole semester, and this is my elective", not "only this subject".
    groups = electives.detect_groups(subjects)
    optional_keys = {option["key"] for group in groups.values() for option in group["options"]}
    named_electives: list[str] = []
    whole_scope_words = re.search(r"\b(semester|sem|all\s+(the\s+)?subjects|every\s+subject)\b", message, re.I)
    exclude_electives = electives.wants_no_electives(message)
    if exclude_electives:
        # "Semester 6 excluding optional courses": the LLM may list every subject; the semester is the real scope.
        intent["subject_keys"] = [] if intent["semester"] else [key for key in intent["subject_keys"] if key not in optional_keys]
    elif intent["subject_keys"] and set(intent["subject_keys"]) <= optional_keys and (intent["semester"] or whole_scope_words):
        named_electives = intent["subject_keys"]
        intent["subject_keys"] = []

    scope = resolve_scope(intent, subjects)
    if scope["type"] == "subjects":
        scope_label = ", ".join(subject["name"] for subject in scope["subjects"])
    elif scope["type"] == "semester":
        scope_label = f"Semester {scope['semester']}"
    else:
        scope_label = "all subjects"

    # Optional courses: keep only the student's choice; ask when we don't know it yet.
    chosen_electives: list[dict] = []
    if scope["type"] != "subjects":
        saved = preferences.get("electiveChoices") if isinstance(preferences.get("electiveChoices"), dict) else {}
        scope["subjects"], chosen_electives, pending = electives.apply_choices(
            scope["subjects"], groups, named_electives, saved, exclude_electives
        )
        if pending:
            return {"needsChoice": electives.choice_request(pending, scope_label)}
        if chosen_electives:
            scope_label += " with " + ", ".join(choice["subject"]["name"] for choice in chosen_electives)

    pyq = analyze_papers(scope["subjects"], papers)
    focus, hits = retrieve_focus_units(message, intent, scope["subjects"], chunks)

    # 4: priority
    units = score_units(scope["subjects"], pyq, focus)

    # Study window
    break_minutes = int(min(30, max(0, number_or(preferences.get("breakMinutes"), 10))))
    session_minutes = int(min(90, max(25, number_or(preferences.get("sessionMinutes"), 0) or 50)))
    daily_start = to_minutes(preferences.get("dailyStart") or "08:00")
    daily_end = to_minutes(preferences.get("dailyEnd") or "20:00")
    if intent["hours_per_day"]:
        span = intent["hours_per_day"] * 60
        lunch = LUNCH_MINUTES if daily_start < LUNCH_START < daily_start + span else 0
        daily_end = int(min(23 * 60 + 30, daily_start + span + math.floor(span / session_minutes) * break_minutes + lunch))
    if daily_end - daily_start < 60:
        raise PlannerError("Your daily study window must be at least 1 hour.")

    start_date = start_date_input
    first_day_start = daily_start
    now_minutes = number_or(preferences.get("nowMinutes"), float("nan"))
    if preferences.get("isToday") and math.isfinite(now_minutes) and now_minutes + 15 > daily_start:
        first_day_start = math.ceil((now_minutes + 10) / 15) * 15
        if daily_end - first_day_start < 45:
            start_date = add_days(start_date, 1)
            first_day_start = daily_start
    if intent["exam_date"] and start_date != start_date_input:
        intent["days_available"] = max(1, days_between(start_date, intent["exam_date"]))

    settings = {
        "startDate": start_date,
        "dailyStart": to_clock(daily_start),
        "dailyEnd": to_clock(daily_end),
        "breakMinutes": break_minutes,
        "sessionMinutes": session_minutes,
        "firstDayStart": first_day_start,
        "revisionMinutes": 0,
    }

    full_day = day_capacity(daily_start, daily_end, session_minutes, break_minutes)
    first_day = day_capacity(first_day_start, daily_end, session_minutes, break_minutes)
    required_minutes = sum(topic.base for entry in units for topic in entry.topics)

    # 5: allocation. With a deadline the days are fixed; otherwise the plan grows until everything fits.
    fixed_days = bool(intent["days_available"])
    if fixed_days:
        day_count = min(MAX_DAYS, intent["days_available"])
        settings["revisionMinutes"] = max(60, full_day) if day_count >= 7 else min(90, full_day // 3) if day_count >= 3 else 0
    else:
        day_count = min(MAX_DAYS, 1 + max(0, math.ceil((required_minutes - first_day) / max(1, full_day))))
    revision_cost = min(settings["revisionMinutes"] + break_minutes, full_day) if settings["revisionMinutes"] else 0
    available_minutes = math.floor((first_day + max(0, day_count - 1) * full_day - revision_cost) * 0.96)

    crunch = allocate(units, max(QUICK_MINUTES, available_minutes) if fixed_days else math.inf)

    # 6: timetable
    blocks = interleave_subjects(build_blocks(units, session_minutes))
    revision_units = [entry for entry in units if any(not topic.skipped for topic in entry.topics)][:8]
    days, unscheduled = schedule_days(blocks, revision_units, settings, day_count, fixed_days)

    all_topics = [topic for entry in units for topic in entry.topics]
    planned_minutes = sum(0 if topic.skipped else topic.allocated for topic in all_topics)
    coverage = min(100, js_round(planned_minutes / max(1, required_minutes) * 100))
    skipped = [
        {"subject": entry.subject["name"], "unit": entry.unit["title"], "topic": topic.name}
        for entry in units
        for topic in entry.topics
        if topic.skipped
    ]
    warnings = list(scope["warnings"])
    if unscheduled:
        warnings.append(f"{len(unscheduled)} study blocks did not fit in your daily window. Extend your study hours to fit them.")
    if not pyq["paper_count"]:
        warnings.append(
            "No previous-year papers uploaded yet. Priorities use syllabus hours and unit weightage. Upload past papers for frequency-based ranking."
        )

    # 7: strategy
    strategy = generate_strategy(
        message=message,
        scope_label=scope_label,
        units=units,
        crunch=crunch,
        coverage=coverage,
        days=len(days),
        hours_per_day=js_round(full_day / 60 * 10) / 10,
        skipped_count=len(skipped),
        has_pyq=bool(pyq["subjects_with_papers"]),
        retrieved=hits,
        day_summaries=summarize_days(days),
    )

    source_files = list(dict.fromkeys(subject.get("fileName") for subject in scope["subjects"] if subject.get("fileName")))

    return {
        "title": f"{'Crash plan' if crunch else 'Study plan'} · {scope_label}",
        "request": message,
        "scope": {
            "type": scope["type"],
            "semester": scope["semester"],
            "label": scope_label,
            "subjects": [
                {"key": subject["key"], "name": subject["name"], "code": subject.get("code") or "", "semester": subject.get("semester")}
                for subject in scope["subjects"]
            ],
        },
        "settings": {**settings, "days": len(days), "examDate": intent["exam_date"]},
        "stats": {
            "requiredMinutes": required_minutes,
            "availableMinutes": available_minutes,
            "plannedMinutes": planned_minutes,
            "coverage": coverage,
            "crunch": crunch,
            "topicsTotal": len(all_topics),
            "topicsCovered": len(all_topics) - len(skipped),
            "topicsSkipped": len(skipped),
            "paperCount": pyq["paper_count"],
        },
        "priorities": [
            {
                "subject": entry.subject["name"],
                "code": entry.subject.get("code") or "",
                "unitNumber": entry.unit["number"],
                "unit": entry.unit["title"],
                "hours": entry.unit.get("hours"),
                "score": entry.score,
                "priority": priority_label(entry.score),
                "focused": entry.focused,
                "pyqQuestions": entry.pyq_questions,
                "pyqPapers": entry.pyq_papers,
                "samples": entry.samples,
                "minutes": sum(0 if topic.skipped else topic.allocated for topic in entry.topics),
                "topics": [
                    {
                        "name": topic.name,
                        "minutes": 0 if topic.skipped else topic.allocated,
                        "mode": "If time permits" if topic.skipped else study_mode(topic),
                        "pyqQuestions": topic.pyq_questions,
                    }
                    for topic in entry.topics
                ],
            }
            for entry in units
        ],
        "days": days,
        "skipped": skipped,
        "strategy": strategy,
        "sources": [{"kind": "syllabus", "label": name} for name in source_files]
        + [{"kind": "match", "label": chunk["text"][:160]} for chunk in hits],
        "warnings": warnings,
        "electives": chosen_electives,
    }
