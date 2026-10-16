"""Turns the layout text of one question paper into a structured paper.

The structure keeps everything needed to write a new paper in the *same* format:
header lines, the instructions block, the exact numbering style ("Q1)", "a)", "(b)", "A"),
how marks are printed ("[05]", "05", "03"), per-question choice rules ("Any five"), and for
every part its text, sub-items, marks, question type, topic and linked figures/tables.
"""

import logging
import re

from rag.llm import LlmError, chat_json, is_llm_available

log = logging.getLogger("planner-ai.papers")

PART_TYPES = ["theory", "numerical", "derivation", "diagram", "program", "comparison", "short_notes", "mcq", "table"]

SYSTEM = """You convert the extracted text of a university exam question paper into JSON.
The text came from OCR or a PDF text layer; fix obvious OCR slips (e.g. "Demultiplexerx" ->
"Demultiplexer", "[so]" -> "[05]") but never invent questions. {{...}} at the end of a line holds
the marks printed in the right margin for that line. [FIGURE f1] / [TABLE t1] mark where a figure
or table appears; attach it to the part it belongs to (usually the part right above it)."""

SCHEMA = """Return JSON exactly in this shape:
{
  "subject": "subject name if visible, else empty",
  "header_lines": ["exam lines printed above the instructions, e.g. '(3 Hours)', 'Duration: 2 hours'"],
  "duration": "e.g. '3 Hours'",
  "total_marks": 80,
  "instructions_heading": "e.g. 'N.B.', 'Note:', 'NB:', 'Instructions:'",
  "instructions": ["each instruction without its number"],
  "questions": [
    {
      "label": "question label exactly as printed, e.g. 'Q1)', 'Q.1', '1', 'Q1.'",
      "heading": "text printed on the question line itself, e.g. 'Answer the following (Any five)', else ''",
      "marks": "marks printed for the whole question, e.g. '[20]' or '20', else ''",
      "attempt": "number of parts to attempt if the question says 'any N', else null",
      "parts": [
        {
          "label": "part label exactly as printed, e.g. 'a)', '(a)', 'A', 'a.'",
          "text": "the full question text of this part (joined across lines; keep data, numbers, equations, unicode math like n², θ, Θ)",
          "subitems": ["i./ii. sub-points, or data lines that are a list, else empty"],
          "marks": "marks exactly as printed for this part, e.g. '03', '[05]', else ''",
          "type": "one of: theory, numerical, derivation, diagram, program, comparison, short_notes, mcq, table",
          "topic": "3-6 word syllabus topic, e.g. 'Kruskal minimum spanning tree'",
          "figures": ["f1"],
          "tables": ["t1"]
        }
      ]
    }
  ]
}
Type guide: numerical = calculation with given data (sort these numbers, find profit, compute parameters);
derivation = prove/derive; diagram = asks to draw, or relies on a given figure; program = write an
algorithm/procedure/code; comparison = differentiate/compare; short_notes = write short notes."""

QUESTION_START = re.compile(r"^\s*(Q\.?\s*\d+\s*[.)]?|\d{1,2}\s*[.)]?)(?=\s|$)", re.I)
# Part labels: "a)", "(a)", "a.", "A", and bare "a" when a capitalised word follows ("a Describe ...").
# OCR sometimes drops the space after a punctuated label ("(b)What are ..."), so a capital letter
# may follow it directly; "e.g. ..." at a line start stays text because a lowercase letter follows.
PART_START = re.compile(r"^\s*(\(?[a-hA-H][.)](?=\s|[A-Z“\"(])|[A-H](?=\s)|[a-h](?=\s+[A-Z“\"(]))\s*")
SUBITEM_START = re.compile(r"^\(?(i{1,3}|iv|v|vi{0,3}|\d{1,2})[.)]\s", re.I)


TRAILING_MARKS_TEXT = re.compile(r"[\[(]\d{1,2}[\])]\s*$")


IMPLIED_LABEL = re.compile(r"^()")


def question_start(
    line: str, next_number: int, started: bool, has_marks: bool, numbered_subitems: int = 0, after_instructions: bool = False
) -> re.Match | None:
    """Matches a question label at the start of a line.

    "Q1"-style labels always start a question. A bare number ("1  Attempt any FOUR", "2 a Explain")
    only does when it is the next number in sequence AND questions have begun or the line carries
    marks or a part label, so numbered instructions ("1. Question 1 is compulsory") and data lines
    ("28, 17, 20") are never mistaken for questions. A number continuing the current part's own
    numbered points ("1. Block size", "2. ...", "3. Role of S-box") is a point, not a question."""
    match = QUESTION_START.match(line)
    if not match:
        # OCR can miss a lone "1" in the margin. Instructions never carry marks, so the first marked
        # line after them ("Attempt any FOUR [20]") starts question 1; its label is implied ("").
        if after_instructions and not started and next_number == 1 and has_marks and not INSTRUCTIONS_START.match(line):
            return IMPLIED_LABEL.match(line)
        return None
    if line.lstrip().upper().startswith("Q"):
        return match
    number = int(re.search(r"\d+", match.group(1)).group(0))
    if number != next_number or (numbered_subitems and number == numbered_subitems + 1):
        return None
    rest = line[match.end():].strip()
    has_marks = has_marks or bool(TRAILING_MARKS_TEXT.search(line))
    return match if started or has_marks or PART_START.match(rest) else None


def _numbered_point(line: str) -> bool:
    return bool(re.match(r"^\(?\d{1,2}[.)]\s", line))
MARKS_TAG = re.compile(r"\s*\{\{(.+?)\}\}\s*$")
MARKS_TAG_ANYWHERE = re.compile(r"\s*\{\{(.+?)\}\}")


ENUMERATOR = re.compile(r"^\s*(\(?\d{1,2}[.)]|\(?[ivx]{1,4}[.)])\s+", re.I)


def label_template(labels: list[str], kind: str) -> str:
    """Numbering pattern from the printed labels: 'Q1)' -> 'Q{n})', '(a)' -> '({a})', 'A' -> '{A}'.

    The label with the most punctuation wins, so 'Q2' next to 'Q1)' still yields 'Q{n})'."""
    pattern = re.compile(r"\d+") if kind == "number" else re.compile(r"[a-hA-H]")
    candidates = [label.strip() for label in labels if pattern.search(label or "")]
    if not candidates:
        return "Q{n}." if kind == "number" else "({a})"
    # max() keeps the first label among equals, so ties resolve to the earliest question.
    best = max(candidates, key=lambda label: len(re.sub(r"[\w\s]", "", label)))
    match = pattern.search(best)
    if kind == "number":
        token = "{n}"
    else:
        token = "{A}" if match.group(0).isupper() else "{a}"
    return best[: match.start()] + token + best[match.end():]


def format_label(template: str, index: int) -> str:
    """index is 1-based."""
    return template.replace("{n}", str(index)).replace("{a}", chr(96 + index)).replace("{A}", chr(64 + index))


NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8}


def attempt_from_heading(heading: str) -> int | None:
    """'Answer the following (Any five)' -> 5, 'Write short notes on any 2' -> 2."""
    match = re.search(r"\bany\s+(\w+)", heading or "", re.I)
    if not match:
        return None
    word = match.group(1).lower()
    return int(word) if word.isdigit() else NUMBER_WORDS.get(word)


def marks_value(marks: str) -> int | None:
    """'[05]' -> 5, '03' -> 3, '[so]' -> None."""
    match = re.search(r"\d{1,3}", marks or "")
    return int(match.group(0)) if match else None


INSTRUCTIONS_START = re.compile(r"^\s*(?:N\.?\s*B\.?|Note|Instructions?)(?=[\s:.]|$)", re.I)


def header_lines(layout: str) -> list[str]:
    """Lines printed above the instructions/first question ("(3 Hours)  Total Marks: 80"),
    copied exactly from the paper so the generated test opens the same way."""
    lines = []
    for raw_line in layout.splitlines():
        line = MARKS_TAG_ANYWHERE.sub(lambda match: " " + match.group(1), raw_line).strip()
        if not line:
            continue
        if INSTRUCTIONS_START.match(line) or (QUESTION_START.match(line) and re.match(r"^\s*(Q|\d)", line)):
            break
        if not line.startswith("[FIGURE") and not line.startswith("[TABLE"):
            lines.append(re.sub(r"\s{2,}", "   ", line))
    return lines[:6]


NUMERIC_DATA = re.compile(r"\d+\s*,\s*\d+\s*,\s*\d+|=\s*[(\[]?\s*-?\d|\b(capacity|coordinates?|endpoints?)\b.*\d", re.I)
NUMERIC_VERBS = re.compile(r"\b(find|calculate|compute|determine|multiply|perform|sort the following|apply|solve|clip)\b", re.I)


def infer_type(text: str, figures: list, suggested: str = "theory") -> str:
    """Question type from wording and data. A specific type from the model is kept; a generic
    "theory" is corrected when the text clearly is a numerical, program, derivation, etc."""
    lowered = text.lower()
    # Models over-use "short_notes" for ordinary "Explain ..." parts; only the wording decides it.
    if suggested in PART_TYPES and suggested not in ("theory", "short_notes"):
        return suggested
    if re.search(r"short notes?", lowered):
        return "short_notes"
    if NUMERIC_DATA.search(text) and NUMERIC_VERBS.search(text):
        return "numerical"
    if re.search(r"\b(differentiate|compare|distinguish)\b", lowered):
        return "comparison"
    if re.search(r"\b(derive|prove)\b", lowered):
        return "derivation"
    if re.search(r"\b(write|design)\b[^.?]{0,40}\b(algorithm|program|procedure|pseudo ?code|code|micro ?program)\b", lowered):
        return "program"
    if re.search(r"\b(draw|sketch|flow ?chart|diagram)\b", lowered) or figures:
        return "diagram"
    return "theory"


def _clean_part(part: dict, figure_ids: set[str], table_ids: set[str]) -> dict | None:
    text = str(part.get("text") or "").strip()
    # Sub-items are stored without their "i." / "ii." numbering; the renderer adds it back.
    subitems = [ENUMERATOR.sub("", str(item)).strip() for item in part.get("subitems") or [] if str(item).strip()]
    if not text and not subitems:
        return None
    figures = [f for f in part.get("figures") or [] if f in figure_ids]
    suggested = str(part.get("type") or "theory").strip().lower()
    return {
        "label": str(part.get("label") or "").strip(),
        "text": text,
        "subitems": subitems,
        "marks": str(part.get("marks") or "").strip(),
        "type": infer_type(f"{text} {' '.join(subitems)}", figures, suggested),
        "topic": str(part.get("topic") or "").strip()[:80],
        "figures": figures,
        "tables": [t for t in part.get("tables") or [] if t in table_ids],
    }


def printed_labels(layout: str) -> tuple[list[str], list[str]]:
    """Question and part labels exactly as they appear at line starts on the paper; the model
    sometimes drops their punctuation ("a." -> "a")."""
    questions, parts = [], []
    in_questions, points, seen_instructions = False, 0, False
    for raw_line in layout.splitlines():
        line = MARKS_TAG_ANYWHERE.sub("", raw_line).strip()
        has_marks = bool(MARKS_TAG_ANYWHERE.search(raw_line))
        question = question_start(line, len(questions) + 1, in_questions, has_marks, points, seen_instructions)
        seen_instructions = seen_instructions or bool(INSTRUCTIONS_START.match(line))
        if question:
            in_questions, points = True, 0
            questions.append(question.group(1).strip())
            line = line[question.end():].strip()
        if in_questions:
            part = PART_START.match(line)
            if part:
                parts.append(part.group(1).strip())
                points = 0
            elif _numbered_point(line):
                points += 1
    return questions, parts


def instruction_template(layout: str) -> str:
    """How the instructions are numbered on the paper ("1)", "(1)", "1."), read from the text
    itself because the model often drops the numbers."""
    in_instructions = False
    for raw_line in layout.splitlines():
        line = MARKS_TAG_ANYWHERE.sub("", raw_line).strip()
        start = INSTRUCTIONS_START.match(line)
        if start:
            in_instructions = True
            line = line[start.end():].lstrip(" :.")
        if not in_instructions:
            continue
        match = ENUMERATOR.match(line)
        if match:
            return label_template([match.group(1)], "number")
        if QUESTION_START.match(line) and line.upper().startswith("Q"):
            break
    return "{n}."


def _normalize(raw: dict, extracted: dict) -> dict:
    figure_ids = {figure["id"] for figure in extracted["figures"]}
    table_ids = {table["id"] for table in extracted["tables"]}

    questions = []
    for question in raw.get("questions") or []:
        if not isinstance(question, dict):
            continue  # the model occasionally emits a bare string; it carries no structure
        raw_parts = [p for p in question.get("parts") or [] if isinstance(p, dict)]
        parts = [part for part in (_clean_part(p, figure_ids, table_ids) for p in raw_parts) if part]
        heading = str(question.get("heading") or "").strip()
        if not parts and heading:
            # A question with no sub-parts is a single part with the question's own label.
            parts = [_clean_part({"label": "", "text": heading, "marks": question.get("marks")}, figure_ids, table_ids)]
            heading = ""
        if not parts:
            continue
        attempt = question.get("attempt")
        attempt = int(attempt) if str(attempt or "").isdigit() else attempt_from_heading(heading)
        question_marks = str(question.get("marks") or "").strip()
        questions.append({
            "label": str(question.get("label") or f"Q{len(questions) + 1}").strip(),
            "heading": heading,
            # Only real marks ("[20]", "20"); the "Marks" column header is not one.
            "marks": question_marks if re.search(r"\d", question_marks) else "",
            "attempt": attempt if attempt and attempt < len(parts) else None,
            "parts": parts,
        })

    total = raw.get("total_marks")
    for question in questions:
        # The "Marks" column header sometimes lands on the first question's line.
        question["heading"] = re.sub(r"\s*\bMarks\b\s*$", "", question["heading"]).strip()

    instruction_lines = [MARKS_TAG_ANYWHERE.sub("", str(line)).strip() for line in raw.get("instructions") or [] if str(line).strip()]
    printed_questions, printed_parts = printed_labels(extracted["layout_text"])
    numbering = {
        "question": label_template(printed_questions + [q["label"] for q in questions], "number"),
        "part": label_template(printed_parts + [p["label"] for q in questions for p in q["parts"] if p["label"]], "letter"),
        "instruction": instruction_template(extracted["layout_text"]),
    }
    total_value = int(total) if str(total or "").isdigit() else None
    for question in questions:
        for part in question["parts"]:
            part["marks"] = MARKS_TAG_ANYWHERE.sub(lambda match: match.group(1), part["marks"]).strip()
            if re.search(r"short notes?", question["heading"], re.I):
                part["type"] = "short_notes"
        # A question shows its own marks only when its parts carry none ("Q1. ATTEMPT ANY FOUR [20]");
        # the paper total that lands on the first line is never a question's marks.
        question_marks = MARKS_TAG_ANYWHERE.sub(lambda match: match.group(1), question["marks"]).strip()
        parts_have_marks = any(part["marks"] for part in question["parts"])
        if parts_have_marks or (total_value and marks_value(question_marks) == total_value):
            question_marks = ""
        question["marks"] = question_marks
    return {
        "subject": str(raw.get("subject") or extracted.get("meta", {}).get("subject") or "").strip(),
        "header_lines": header_lines(extracted["layout_text"]),
        "duration": str(raw.get("duration") or "").strip(),
        "total_marks": int(total) if str(total or "").isdigit() else None,
        "instructions_heading": str(raw.get("instructions_heading") or "Instructions:").strip(),
        "instructions": [
            line for line in (ENUMERATOR.sub("", raw).strip() for raw in instruction_lines)
            # The model sometimes copies the first question's heading ("Q1. Attempt any Four.") here.
            if line and not re.match(r"^Q\.?\s*\d", line, re.I) and line not in {q["heading"] for q in questions}
        ],
        "numbering": numbering,
        "questions": questions,
    }


def _structure_with_rules(extracted: dict) -> dict:
    """Fallback without an LLM: question/part labels and margin marks from the layout text."""
    questions, header_lines, instructions = [], [], []
    current_question = current_part = None
    in_instructions, instructions_heading = False, "Instructions:"

    for raw_line in extracted["layout_text"].splitlines():
        marks_match = MARKS_TAG.search(raw_line)
        marks = marks_match.group(1) if marks_match else ""
        line = MARKS_TAG.sub("", raw_line).strip()
        if not line:
            continue

        figure = re.fullmatch(r"\[FIGURE (f\d+)\]", line)
        table = re.fullmatch(r"\[TABLE (t\d+)\]", line)
        if (figure or table) and current_part:
            current_part["figures" if figure else "tables"].append((figure or table).group(1))
            continue

        points = sum(1 for item in current_part["subitems"] if _numbered_point(item)) if current_part else 0
        question_match = question_start(line, len(questions) + 1, bool(questions), bool(marks), points, in_instructions)
        if question_match:
            rest = line[question_match.end():].strip()
            current_question = {"label": question_match.group(1).strip(), "heading": "", "marks": "", "attempt": None, "parts": []}
            questions.append(current_question)
            current_part = None
            line = rest
            if not line:
                current_question["marks"] = marks
                continue

        if current_question is None:
            heading = INSTRUCTIONS_START.match(line)
            if heading:
                in_instructions = True
                instructions_heading = line[: heading.end()].strip() + (":" if line[heading.end():].lstrip().startswith(":") else "")
                line = line[heading.end():].lstrip(" :.")
            if in_instructions and line:
                instructions.append(line)
            elif not in_instructions:
                header_lines.append(f"{line} {marks}".strip())  # "Total Marks: 80" keeps its number
            continue

        part_match = PART_START.match(line)
        if part_match:
            current_part = {"label": part_match.group(1), "text": line[part_match.end():].strip(), "subitems": [], "marks": marks,
                            "type": "theory", "topic": "", "figures": [], "tables": []}
            current_question["parts"].append(current_part)
        elif current_part is None:
            current_question["heading"] = f"{current_question['heading']} {line}".strip()
            current_question["marks"] = current_question["marks"] or marks
        elif SUBITEM_START.match(line):  # "i. Scan Conversion", "1. Block size and key size"
            current_part["subitems"].append(line)
        else:
            current_part["text"] = f"{current_part['text']} {line}".strip()
        if current_part is not None and marks and not current_part["marks"]:
            current_part["marks"] = marks  # multi-line parts often print their marks on the last line

    # "Any N" choices and part types are derived in _normalize / _clean_part.
    header = " ".join(header_lines)
    total = re.search(r"marks\s*:?\s*(\d{2,3})", header, re.I)
    duration = re.search(r"(\d+(?:\.\d+)?\s*(?:hours?|hrs?\.?))", header, re.I)
    return {
        "questions": questions,
        "header_lines": header_lines,
        "instructions": instructions,
        "instructions_heading": instructions_heading,
        "total_marks": int(total.group(1)) if total else None,
        "duration": duration.group(1) if duration else "",
    }


ANNOTATE = """For each numbered part of this exam paper, give its question type and a short syllabus
topic, and fix obvious OCR slips in its text (never add or remove content).
Type is one of: theory, numerical, derivation, diagram, program, comparison, short_notes, mcq, table.
Return JSON: {"parts": [{"id": "q1p1", "type": "...", "topic": "3-6 words", "text": "corrected text"}]}"""


def _annotate(structure: dict) -> dict:
    """Adds model-chosen types/topics to a rule-parsed paper without changing its structure."""
    listing = "\n".join(
        f"q{qi + 1}p{pi + 1}: {part['text'][:300]}"
        for qi, question in enumerate(structure["questions"])
        for pi, part in enumerate(question["parts"])
    )
    try:
        response = chat_json(SYSTEM, f"{ANNOTATE}\n\nSubject: {structure.get('subject') or 'unknown'}\n\n{listing}", max_tokens=3000, temperature=0.1, timeout=90)
    except LlmError as error:
        log.warning("part annotation failed (%s); keeping rule-based types", error)
        return structure

    notes = {str(item.get("id")): item for item in response.get("parts") or [] if isinstance(item, dict)}
    for qi, question in enumerate(structure["questions"]):
        for pi, part in enumerate(question["parts"]):
            note = notes.get(f"q{qi + 1}p{pi + 1}")
            if not note:
                continue
            text = str(note.get("text") or "").strip()
            # Accept corrections only; a rewrite of very different length is not an OCR fix.
            if text and 0.8 <= len(text) / max(len(part["text"]), 1) <= 1.2:
                part["text"] = text
            part["topic"] = str(note.get("topic") or part["topic"]).strip()[:80]
            if not re.search(r"short notes?", question["heading"], re.I):
                part["type"] = infer_type(f"{part['text']} {' '.join(part['subitems'])}", part["figures"], str(note.get("type") or "theory").lower())
    return structure


def structure_paper(extracted: dict) -> tuple[dict, str]:
    """Returns (structured paper, method): 'llm', 'rules+llm' or 'rules'.

    The rule parser follows the printed labels, so when it finds every printed question it is the
    authority on structure. The model's full structuring is used only if it agrees part-for-part
    (models sometimes split "2 a"/"2 b" into two questions or turn numbered points into parts);
    otherwise the model just annotates the rule-parsed parts with types and topics."""
    by_rules = _normalize(_structure_with_rules(extracted), extracted)
    expected_questions = len(printed_labels(extracted["layout_text"])[0])
    rule_shape = [len(question["parts"]) for question in by_rules["questions"]]
    rules_reliable = bool(rule_shape) and len(rule_shape) == expected_questions and all(rule_shape)

    if not is_llm_available():
        return by_rules, "rules"

    figures = ", ".join(f"{f['id']} (page {f['page']}, {f['width']}x{f['height']} pt)" for f in extracted["figures"]) or "none"
    tables = ", ".join(f"{t['id']} ({len(t['rows'])} rows)" for t in extracted["tables"]) or "none"
    prompt = (
        f"{SCHEMA}\n\nFigures on the paper: {figures}\nTables on the paper: {tables}\n"
        f"Subject (from the page header): {extracted.get('meta', {}).get('subject', 'unknown')}\n\n"
        f"Paper text:\n\"\"\"\n{extracted['layout_text'][:14000]}\n\"\"\""
    )

    attempts = 1 if rules_reliable else 2
    for _attempt in range(attempts):
        try:
            structured = _normalize(chat_json(SYSTEM, prompt, max_tokens=6000, temperature=0.1, timeout=120), extracted)
        except LlmError as error:
            log.warning("LLM structuring failed (%s)", error)
            break
        shape = [len(question["parts"]) for question in structured["questions"]]
        if rules_reliable and shape == rule_shape:
            return structured, "llm"
        if not rules_reliable and structured["questions"] and (not expected_questions or len(shape) == expected_questions):
            return structured, "llm"
        log.warning("LLM structure %s disagrees with the printed paper %s (%s questions printed)", shape, rule_shape, expected_questions)

    if rules_reliable:
        return _annotate(by_rules), "rules+llm"
    return by_rules, "rules"
