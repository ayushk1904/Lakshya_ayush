"""Retrieval-augmented generation of a practice test from structured previous-year papers.

1. Blueprint: the selected paper whose total marks best match the request supplies the exact
   format (header lines, instructions, numbering, marks, "any N" choices, question order).
2. Retrieval: every part of every selected paper on the same subject goes into a question bank.
   For each blueprint slot we retrieve past questions by TF-IDF similarity, question type and
   marks, give each slot a different topic (repeated topics first) and pass the closest past
   questions to the model as grounding.
3. Generation: per question, the model writes new parts of the same type: numericals with fresh
   data, tables with new values, and figure-based questions that reuse the real extracted figure.
4. Without a model (or if a call fails) the slot is filled with the retrieved past question, so
   a test is always produced in the right format.
"""

import itertools
import json
import logging
import math
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from rag.llm import LlmError, chat_json, is_llm_available

from .structure import NUMBER_WORDS, format_label, marks_value

log = logging.getLogger("planner-ai.papers")

STOPWORDS = {
    "the", "and", "for", "with", "what", "explain", "write", "using", "following", "given", "find", "its",
    "suitable", "example", "detail", "short", "notes", "describe", "define", "discuss", "between", "any",
    "are", "how", "why", "this", "that", "from", "which", "state", "give", "draw", "also", "each", "into",
}
EXEMPLARS_PER_SLOT = 3

SYSTEM = """You are an experienced university examiner writing a fresh practice paper.
You write NEW questions that test the same concepts as the previous-year questions you are given,
at the same difficulty for the marks. Never copy a previous question word for word."""

RULES = """Rules for every part:
- Write exactly one question for each slot, on its target topic, of its required type.
- Change wording, data and values compared with the previous-year questions; keep the concept.
- numerical: include ALL the concrete data needed (numbers, arrays, coordinates, strings, sizes),
  chosen so the problem is solvable and of similar size to the previous-year version. Solve it
  yourself before answering and make sure the data is mathematically valid (e.g. RSA: e coprime
  to φ(n); Diffie-Hellman: g a primitive root mod a prime p; probabilities ≤ 1; matrices of
  compatible sizes; graphs whose answer exists).
- If a slot has "figure_to_use", the previous-year question was built on that figure: write your
  question about the same figure (e.g. a different algorithm or a different start vertex on the
  same graph) and set "figure" to that id. Never write the id itself in "text"; say "the following
  graph" or "the figure below".
- If the slot lists figures from previous-year questions and your question is about such a figure
  (e.g. a different algorithm on the same graph or circuit), set "figure" to that figure id and refer
  to "the following graph/figure". The figure IS the data then: do not also describe vertices, edges
  or values in the text. Otherwise set "figure" to null, never mention a figure, and give any graph
  or data fully in the text.
- If data is best shown as a table (or the type is table), put it in "table" as rows of cells, the
  first row being the header (at most 8 rows); otherwise "table" is null.
- "subitems" is only for i./ii. style sub-points or short-note topics, without their numbering.
- Write maths with unicode (n², x₁, θ, Θ, √, ≤, ×, ÷, →), never LaTeX.
- Write it as it would be printed on the paper: no own a)/b)/i) numbering inside "text" (the paper
  adds labels), and no words about how it was made ("new", "fresh", "different from last year").
- For short_notes slots, "text" is only the topic name (e.g. "Bloom Filter with analysis").

Return JSON: {"parts": [{"slot": "p1", "text": "...", "subitems": [], "figure": null, "table": null}]}"""


def _tokens(text: str) -> list[str]:
    return [word for word in re.findall(r"[a-z][a-z0-9+#-]{2,}", text.lower()) if word not in STOPWORDS]


def _subject_key(subject: str) -> str:
    return re.sub(r"[^a-z]", "", (subject or "").lower())


class QuestionBank:
    """All parts of the selected papers, searchable by TF-IDF cosine similarity."""

    def __init__(self, papers: list[dict]):
        self.entries = []
        for paper in papers:
            figures = {figure["id"]: figure for figure in paper.get("figures") or []}
            tables = {table["id"]: table for table in paper.get("tables") or []}
            for question in paper["structure"]["questions"]:
                for part in question["parts"]:
                    self.entries.append({
                        "paper_id": paper["id"],
                        "text": part["text"],
                        "subitems": part.get("subitems") or [],
                        "type": part.get("type") or "theory",
                        "topic": part.get("topic") or "",
                        "marks": marks_value(part.get("marks")) or marks_value(question.get("marks")) or 0,
                        "figures": [f"{paper['id']}:{fid}" for fid in part.get("figures") or [] if fid in figures],
                        "tables": [tables[tid]["rows"] for tid in part.get("tables") or [] if tid in tables],
                    })

        documents = [_tokens(f"{entry['topic']} {entry['topic']} {entry['text']}") for entry in self.entries]
        frequency = Counter(word for document in documents for word in set(document))
        count = max(1, len(documents))
        self.idf = {word: math.log((1 + count) / (1 + df)) + 1 for word, df in frequency.items()}
        self.vectors = [self._vector(document) for document in documents]

        # How often each topic recurs across papers: repeated topics are prioritised.
        topic_counts = Counter(self.topic_key(entry["topic"]) for entry in self.entries)
        for entry in self.entries:
            entry["topic_count"] = topic_counts[self.topic_key(entry["topic"])]

    @staticmethod
    def topic_key(topic: str) -> str:
        return " ".join(sorted(set(_tokens(topic))))

    def _vector(self, words: list[str]) -> dict[str, float]:
        counts = Counter(words)
        vector = {word: count * self.idf.get(word, 1.0) for word, count in counts.items()}
        norm = math.sqrt(sum(value * value for value in vector.values())) or 1.0
        return {word: value / norm for word, value in vector.items()}

    def search(self, slot: dict, limit: int = 12) -> list[tuple[float, dict]]:
        query = self._vector(_tokens(f"{slot['topic']} {slot['topic']} {slot['text']}"))
        scored = []
        for entry, vector in zip(self.entries, self.vectors):
            similarity = sum(weight * vector.get(word, 0.0) for word, weight in query.items())
            score = (
                0.55 * similarity
                + 0.25 * (entry["type"] == slot["type"])
                + 0.15 * (abs(entry["marks"] - slot["marks_value"]) <= 2)
                + 0.05 * min(entry["topic_count"], 3) / 3
            )
            scored.append((score, entry))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return scored[:limit]


def _pick_blueprint(papers: list[dict], requested_marks: int | None) -> dict:
    def distance(paper):
        total = paper["structure"].get("total_marks")
        return abs((total or 0) - requested_marks) if requested_marks and total else 0

    return min(papers, key=distance)  # min() keeps selection order among equals


def _slots(blueprint: dict) -> list[dict]:
    slots = []
    for q_index, question in enumerate(blueprint["structure"]["questions"]):
        for p_index, part in enumerate(question["parts"]):
            slots.append({
                "id": f"q{q_index}p{p_index}",
                "q_index": q_index,
                "p_index": p_index,
                "text": part["text"],
                "subitems": part.get("subitems") or [],
                "type": part.get("type") or "theory",
                "topic": part.get("topic") or "",
                "marks": part.get("marks") or "",
                "marks_value": marks_value(part.get("marks")) or marks_value(question.get("marks")) or 0,
            })
    return slots


def _assign_topics(slots: list[dict], bank: QuestionBank) -> None:
    """Each slot is grounded on the best-matching past question not used by another slot, plus
    the closest related questions (often from the other selected papers) as extra context.

    Uniqueness is per past question, not per topic label: models label topics coarsely
    ("Sorting Algorithms" for both selection and merge sort), and forcing unique labels pushed
    slots onto unrelated concepts."""
    used: set[int] = set()
    for slot in slots:
        results = bank.search(slot)
        chosen = next((entry for _, entry in results if id(entry) not in used), None)
        if not chosen:
            slot["target_topic"], slot["exemplars"] = slot["topic"], []
            continue
        used.add(id(chosen))
        slot["target_topic"] = chosen["topic"] or slot["topic"]
        related = [entry for score, entry in results if entry is not chosen and score > 0.6]
        slot["exemplars"] = [chosen, *related][:EXEMPLARS_PER_SLOT]


def _exemplar_view(entry: dict) -> dict:
    view = {"text": entry["text"], "type": entry["type"], "marks": entry["marks"]}
    if entry["subitems"]:
        view["subitems"] = entry["subitems"]
    if entry["figures"]:
        view["figures"] = entry["figures"]
    if entry["tables"]:
        view["table"] = entry["tables"][0][:8]
    return view


FIGURE_REFERENCE = re.compile(r"\b(following|given|shown|below|above)\b[^.]{0,30}\b(graph|figure|diagram|circuit|tree|network|image)", re.I)


INLINE_STEP = re.compile(r"^\s*\(?([a-h]|i{1,3}|iv|v|vi{0,3}|\d{1,2})[.)]\s+(.+)$", re.I)


def _split_inline_steps(text: str, subitems: list[str]) -> tuple[str, list[str]]:
    """Moves "(a) ... (b) ..." lines the model wrote inside a part into its sub-points; the paper
    already labels parts, and nested a)/b) under "a." would clash with the paper's numbering."""
    lines = [line for line in text.splitlines() if line.strip()]
    steps = [INLINE_STEP.match(line) for line in lines]
    if sum(1 for step in steps if step) < 2:
        return text, subitems
    body = [line.strip() for line, step in zip(lines, steps) if not step]
    return " ".join(body), subitems + [step.group(2).strip() for step in steps if step]


def _strip_figure_ids(text: str) -> str:
    """Internal ids ("paper2:f2") must never reach the printed paper."""
    text = re.sub(r"\b(?:figure|fig\.?)\s*[\w-]+:f\d+", "the figure below", text, flags=re.I)
    return re.sub(r"\s*\(?\b[\w-]+:f\d+\b\)?", "", text)


def _slot_figure(slot: dict) -> str | None:
    """The figure the grounding past question was built on, which the new question must reuse."""
    chosen = slot["exemplars"][0] if slot.get("exemplars") else None
    return chosen["figures"][0] if chosen and chosen["figures"] else None


def _generate_question(subject: str, question: dict, slots: list[dict]) -> dict[str, dict]:
    """Model calls for one question; returns {slot_id: generated part}. Parts the model skipped
    are asked for once more before the caller falls back to previous-year questions."""
    allowed_figures = {figure for slot in slots for entry in slot["exemplars"] for figure in entry["figures"]}
    generated: dict[str, dict] = {}

    for _attempt in range(2):
        pending = [(index, slot) for index, slot in enumerate(slots) if slot["id"] not in generated]
        if not pending:
            break
        payload = {
            "subject": subject,
            "question_heading": question.get("heading") or "",
            "slots": [
                {
                    "slot": f"p{index + 1}",
                    "type": slot["type"],
                    "marks": slot["marks_value"],
                    "target_topic": slot["target_topic"],
                    "format_example": slot["text"],
                    "previous_year_questions": [_exemplar_view(entry) for entry in slot["exemplars"]],
                    **({"figure_to_use": _slot_figure(slot)} if _slot_figure(slot) else {}),
                }
                for index, slot in pending
            ],
        }
        response = chat_json(SYSTEM, f"{RULES}\n\nInput:\n{json.dumps(payload, ensure_ascii=False)}", max_tokens=2500, temperature=0.6, timeout=90)

        for index, slot in pending:
            item = next((part for part in response.get("parts") or [] if isinstance(part, dict) and part.get("slot") == f"p{index + 1}"), None)
            if not item or not str(item.get("text") or "").strip():
                continue
            table = item.get("table")
            rows = [[str(cell) for cell in row] for row in table if isinstance(row, list)] if isinstance(table, list) else None
            figure = item.get("figure") if item.get("figure") in allowed_figures else None
            text = _strip_figure_ids(str(item["text"]))
            body, subitems = _split_inline_steps(text, [str(entry).strip() for entry in item.get("subitems") or [] if str(entry).strip()])
            if not figure and _slot_figure(slot) and FIGURE_REFERENCE.search(text):
                figure = _slot_figure(slot)  # the text asks about "the following graph" but the id was left out
            generated[slot["id"]] = {
                "text": body.strip(),
                "subitems": subitems,
                "figure": figure,
                "table": rows[:9] if rows and len(rows) > 1 else None,
                "source": "generated",
            }
    return generated


def _from_exemplar(slot: dict) -> dict:
    entry = slot["exemplars"][0] if slot["exemplars"] else None
    if not entry:
        return {"text": slot["text"], "subitems": slot["subitems"], "figure": None, "table": None, "source": "previous-year"}
    return {
        "text": entry["text"],
        "subitems": entry["subitems"],
        "figure": entry["figures"][0] if entry["figures"] else None,
        "table": entry["tables"][0] if entry["tables"] else None,
        "source": "previous-year",
    }


DURATION = re.compile(r"(\d+(?:\.\d+)?)(\s*)(hours?|hrs?\.?|minutes?|mins?\.?)", re.I)


def _rewrite_duration(lines: list[str], minutes: int | None) -> list[str]:
    """'(3 Hours)' -> '(1 Hour)' / 'Duration: 3Hrs.' -> 'Duration: 90 Minutes', in the paper's own
    style (zero padding, capitalisation), so the header matches the scheduled test length."""
    if not minutes:
        return lines

    def replace(match: re.Match) -> str:
        number, space, unit = match.groups()
        whole_hours = minutes % 60 == 0
        value = minutes // 60 if whole_hours else minutes
        text = str(value).zfill(len(number)) if number.isdigit() else str(value)
        if whole_hours and unit.lower().startswith("h"):
            new_unit = unit if value != 1 else re.sub(r"s(?=\.?$)", "", unit, flags=re.I)
        else:
            word = "Hours" if whole_hours else "Minutes"
            word = word if value != 1 else word[:-1]
            new_unit = word.upper() if unit.isupper() else word if unit[0].isupper() else word.lower()
            space = space or " "  # "3Hrs." -> "90 Minutes", not "90Minutes"
        return f"{text}{space}{new_unit}"

    return [DURATION.sub(replace, line, count=1) for line in lines]


HEADER_MARKS = re.compile(r"(marks\b\s*[:.]?\s*)(\d{2,3})", re.I)


def _reprint_marks(printed: str, value: int) -> str:
    """'05' -> '10', '[10]' -> '[05]': the new value in the paper's own marks style."""
    match = re.search(r"\d+", printed or "")
    if not match:
        return printed
    return printed[: match.start()] + str(value).zfill(len(match.group(0))) + printed[match.end():]


def _rewrite_attempt(heading: str, old: int, new: int) -> str:
    """'Answer the following (Any five)' -> '(Any four)', 'ATTEMPT ANY FOUR' -> 'ATTEMPT ANY THREE',
    'any two (any 2)' -> 'any three (any 3)': the paper's own wording with the new count."""
    words = {value: word for word, value in NUMBER_WORDS.items()}

    def replace(match: re.Match) -> str:
        token = match.group(2)
        if token.isdigit():
            if int(token) != old:
                return match.group(0)
            return match.group(1) + str(new)
        if NUMBER_WORDS.get(token.lower()) != old or new not in words:
            return match.group(0)
        word = words[new]
        word = word.upper() if token.isupper() else word.capitalize() if token[0].isupper() else word
        return match.group(1) + word

    return re.sub(r"(\bany\s+)(\w+)", replace, heading, flags=re.I)


def _combination(values: list[int], target: int, allowed: list[int]) -> list[int] | None:
    """len(values) marks taken from `allowed` that add up to `target`, closest to the old split."""
    if len(values) > 8:
        return None
    ideal = [value * target / sum(values) for value in values]
    best = None
    for combo in itertools.product(allowed, repeat=len(values)):
        if sum(combo) != target:
            continue
        cost = sum((mark - share) ** 2 for mark, share in zip(combo, ideal))
        if best is None or cost < best[0]:
            best = (cost, list(combo))
    return best[1] if best else None


def _resize_parts(parts: list[dict], count: int) -> list[dict]:
    """Drops parts from the end, or repeats the last part's format, to reach `count` parts."""
    parts = [dict(part) for part in parts[:count]]
    while len(parts) < count:
        parts.append({**parts[-1], "figures": [], "tables": []})
    return parts


def _scale_question(question: dict, factor: float, allowed: list[int]) -> dict:
    parts = [dict(part) for part in question["parts"]]
    values = [marks_value(part["marks"]) for part in parts]
    question_marks = marks_value(question.get("marks"))

    if not values or not all(values):
        # Marks are printed only for the whole question ("ATTEMPT ANY FOUR [20]").
        if not question_marks:
            return question
        target = max(1, round(question_marks * factor))
        attempt = question.get("attempt")
        if attempt and question_marks % attempt == 0 and target % (question_marks // attempt) == 0:
            # Keep each part's implied worth (20 / 4 = 5) and change N: "ANY FOUR [20]" -> "ANY THREE [15]".
            new_attempt = target // (question_marks // attempt)
            parts = _resize_parts(parts, new_attempt + len(parts) - attempt)
            heading = _rewrite_attempt(question.get("heading") or "", attempt, new_attempt)
            return {**question, "heading": heading, "attempt": new_attempt, "marks": _reprint_marks(question["marks"], target), "parts": parts}
        return {**question, "marks": _reprint_marks(question["marks"], target), "parts": parts}

    attempt = question.get("attempt")
    if attempt and len(set(values)) == 1:
        # "Any N" of equal parts: keep a mark value the paper uses and change N instead,
        # e.g. any five x 03 (15) -> any four x 05 (20), still offering the same number of extras.
        target = round(values[0] * attempt * factor)
        extras = len(parts) - attempt
        for value in sorted(allowed, key=lambda mark: abs(mark - values[0])):
            if target % value == 0:
                new_attempt = target // value
                parts = _resize_parts(parts, new_attempt + extras)
                for part in parts:
                    part["marks"] = _reprint_marks(part["marks"], value)
                heading = _rewrite_attempt(question.get("heading") or "", attempt, new_attempt)
                return {**question, "heading": heading, "attempt": new_attempt, "parts": parts}
    else:
        # Other questions: marks from the paper's own values adding up to the new total, trying the
        # same number of parts first and then one or two parts more or fewer.
        target = round(sum(values) * factor)
        for count in sorted({len(values), len(values) - 1, len(values) + 1, len(values) - 2, len(values) + 2}, key=lambda n: (abs(n - len(values)), n)):
            if count < 1:
                continue
            shape = (values * 3)[:count] if count > len(values) else values[:count]
            combo = _combination(shape, target, allowed)
            if combo:
                parts = _resize_parts(parts, count)
                for part, value in zip(parts, combo):
                    part["marks"] = _reprint_marks(part["marks"], value)
                return {**question, "parts": parts}

    # No combination of the paper's values fits: scale proportionally as a last resort.
    total = round(sum(values) * factor)
    shares = [max(1, round(value * factor)) for value in values]
    shares[-1] += total - sum(shares)
    for part, value in zip(parts, shares):
        part["marks"] = _reprint_marks(part["marks"], max(1, value))
    return {**question, "parts": parts}


def scale_marks(structure: dict, requested: int | None, papers: list[dict] | None = None) -> dict:
    """Rescales a paper to the requested total using only the mark values printed on the uploaded
    papers (e.g. 03 / 05 / 10), changing how many parts or "any N" choices a question has rather
    than inventing marks such as 04 or 07. The header's total is updated in its own wording."""
    total = structure.get("total_marks")
    if not requested or not total or requested == total:
        return structure

    sources = papers or [{"structure": structure}]
    allowed = sorted({
        value
        for paper in sources
        for question in paper["structure"]["questions"]
        for part in question["parts"]
        if (value := marks_value(part.get("marks")))
    })
    if allowed and all(value % 5 == 0 for value in allowed) and 5 not in allowed:
        allowed = sorted(set(allowed) | {5})  # papers marked in tens also use fives ("[05]")

    factor = requested / total
    return {
        **structure,
        "total_marks": requested,
        "header_lines": [HEADER_MARKS.sub(lambda m: m.group(1) + str(requested), line) for line in structure.get("header_lines") or []],
        "questions": [_scale_question(question, factor, allowed or [1]) for question in structure["questions"]],
    }


def generate_test(papers: list[dict], title: str = "", requested_marks: int | None = None, duration_minutes: int | None = None) -> dict:
    """papers: [{id, structure, figures: [{id, ...}], tables: [{id, rows}]}] -> {paper, markdown, warnings}."""
    papers = [paper for paper in papers if paper.get("structure", {}).get("questions")]
    if not papers:
        raise ValueError("None of the selected papers could be read into questions.")

    warnings = []
    blueprint = _pick_blueprint(papers, requested_marks)
    subject = blueprint["structure"].get("subject") or ""
    same_subject = [paper for paper in papers if _subject_key(paper["structure"].get("subject")) == _subject_key(subject)] or [blueprint]
    if len(same_subject) < len(papers):
        warnings.append(f"Only the {subject or 'same-subject'} papers were used; the other selected papers are for different subjects.")

    # A 60-mark paper asked for as an 80-mark test keeps its structure with every mark scaled.
    blueprint = {**blueprint, "structure": scale_marks(blueprint["structure"], requested_marks, same_subject)}
    total = blueprint["structure"].get("total_marks")

    bank = QuestionBank(same_subject)
    slots = _slots(blueprint)
    _assign_topics(slots, bank)

    by_question: dict[int, list[dict]] = {}
    for slot in slots:
        by_question.setdefault(slot["q_index"], []).append(slot)

    generated: dict[str, dict] = {}
    if is_llm_available():
        questions = blueprint["structure"]["questions"]
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(_generate_question, subject, questions[q], q_slots): q for q, q_slots in by_question.items()}
            for future, q_index in futures.items():
                try:
                    generated.update(future.result())
                except (LlmError, ValueError, TypeError) as error:
                    log.warning("question %s generation failed: %s", q_index + 1, error)
    fallback_count = sum(1 for slot in slots if slot["id"] not in generated)
    if fallback_count:
        warnings.append(
            "AI generation was unavailable for some parts, so they use previous-year questions."
            if generated else "AI generation is unavailable, so the test was assembled from previous-year questions."
        )

    structure = blueprint["structure"]
    numbering = structure.get("numbering") or {"question": "Q{n}.", "part": "({a})", "instruction": "{n}."}
    questions = []
    for q_index, question in enumerate(structure["questions"]):
        parts = []
        for p_index, part in enumerate(question["parts"]):
            slot = by_question[q_index][p_index]
            content = generated.get(slot["id"]) or _from_exemplar(slot)
            if slot["type"] == "short_notes":
                # The question line already says "Write short notes on any four"; parts are topics.
                topic = re.sub(r"^(write\s+)?(a\s+)?short\s+notes?\s+on\s+", "", content["text"], flags=re.I).strip()
                content = {**content, "text": topic[:1].upper() + topic[1:]}
            parts.append({
                "label": format_label(numbering["part"], p_index + 1) if part.get("label") else "",
                "marks": part.get("marks") or "",
                "type": slot["type"],
                "topic": slot["target_topic"],
                **content,
            })
        questions.append({
            "label": format_label(numbering["question"], q_index + 1),
            "heading": question.get("heading") or "",
            "marks": question.get("marks") or "",
            "attempt": question.get("attempt"),
            "parts": parts,
        })

    paper = {
        "title": title or (f"{subject} Practice Test" if subject else "Practice Test"),
        "subject": subject,
        "header_lines": _rewrite_duration(structure.get("header_lines") or [], duration_minutes),
        "duration_minutes": duration_minutes,
        "total_marks": total or requested_marks,
        "instructions_heading": structure.get("instructions_heading") or "Instructions:",
        "instructions": structure.get("instructions") or [],
        "numbering": numbering,
        "questions": questions,
        "blueprint_paper_id": blueprint["id"],
    }
    return {"paper": paper, "markdown": render_markdown(paper), "warnings": warnings}


def _markdown_table(rows: list[list[str]]) -> str:
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    escape = lambda cell: str(cell).replace("|", "\\|").replace("\n", " ")  # noqa: E731
    lines = ["| " + " | ".join(escape(cell) for cell in rows[0]) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(escape(cell) for cell in row) + " |" for row in rows[1:]]
    return "\n".join(lines)


def render_markdown(paper: dict) -> str:
    """Markdown version of the paper. Figures are [[DIAGRAM:paperId:figureId|caption]] tokens that
    the backend swaps for the stored images."""
    lines = []
    if paper.get("subject"):
        lines.append(f"## {paper['subject']}")
    lines += [f"**{line}**" for line in paper.get("header_lines") or []]
    if paper.get("instructions"):
        lines.append(f"**{paper['instructions_heading']}**")
        template = paper["numbering"].get("instruction") or "{n}."
        lines += [f"{format_label(template, index + 1)} {item}" for index, item in enumerate(paper["instructions"])]
    lines.append("---")

    for question in paper["questions"]:
        heading = f" {question['heading']}" if question.get("heading") else ""
        marks = f" **{question['marks']}**" if question.get("marks") else ""
        lines.append(f"### {question['label']}{heading}{marks}")
        for part in question["parts"]:
            label = f"**{part['label']}** " if part.get("label") else ""
            marks = f" **{part['marks']}**" if part.get("marks") else ""
            lines.append(f"{label}{part['text']}{marks}")
            lines += [f"- {item}" for item in part.get("subitems") or []]
            if part.get("table"):
                lines.append(_markdown_table(part["table"]))
            if part.get("figure"):
                lines.append(f"[[DIAGRAM:{part['figure']}|Figure for {question['label']} {part.get('label', '')}]]")
    return "\n\n".join(lines)
