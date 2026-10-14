"""Optional (elective) courses.

Syllabi list several optional courses of which a student studies only ONE, e.g. Mumbai University's
Department Level Optional Courses CSDLO6011 / CSDLO6012 / CSDLO6013. A semester plan must include
only the one the student chose, so before planning we either:
  - use the choice the student already made (remembered per syllabus),
  - take it from the request ("Semester 6 with Distributed Computing"),
  - drop all of them ("excluding optional courses"), or
  - ask the student which one they chose.
"""

import re

# CSDLO6011 -> group CSDLO601 (last digit = option number). Also tolerates the typo CSDL05012 (zero for O).
OPTIONAL_CODE = re.compile(r"^([A-Z]*?)(DLO|ILO|DL0|IL0|OE|PE)C?(\d{3,4})$")
OPTIONAL_NAME = re.compile(r"\b(elective|optional|dloc?|iloc?)\b", re.I)
EXCLUDE_REQUEST = re.compile(
    r"\b(exclud\w*|without|skip\w*|except|leave\s+out|no)\b[^.?!]{0,30}\b(optional|electives?|dloc?s?|ilocs?)\b", re.I
)
GROUP_LABELS = {
    "DLO": "Department Level Optional Course",
    "ILO": "Institute Level Optional Course",
    "OE": "Open Elective",
    "PE": "Professional Elective",
}


def group_key_for(subject: dict) -> str | None:
    """Which optional group a subject belongs to, or None for a compulsory subject."""
    code = str(subject.get("code") or "").upper()
    match = OPTIONAL_CODE.match(code)
    if match:
        prefix, kind, digits = match.groups()
        kind = kind.replace("0", "O")
        return f"{prefix}{kind}{digits[:-1]}"
    if OPTIONAL_NAME.search(subject.get("name") or ""):
        return f"ELECTIVE-S{subject.get('semester') or 0}"
    return None


def detect_groups(subjects: list[dict]) -> dict[str, dict]:
    """Group optional subjects; a group needs at least two options to be a real choice."""
    groups: dict[str, dict] = {}
    for subject in subjects:
        if subject.get("kind") != "theory":
            continue
        key = group_key_for(subject)
        if not key:
            continue
        group = groups.setdefault(key, {"key": key, "semester": subject.get("semester"), "options": []})
        group["options"].append(subject)

    real_groups = {}
    for key, group in groups.items():
        if len(group["options"]) < 2:
            continue
        kind = next((name for marker, name in GROUP_LABELS.items() if marker in key), "Elective")
        semester = f" (Semester {group['semester']})" if group["semester"] else ""
        group["label"] = f"{kind}{semester}"
        real_groups[key] = group
    return real_groups


def wants_no_electives(message: str) -> bool:
    return bool(EXCLUDE_REQUEST.search(message or ""))


def apply_choices(scope_subjects: list[dict], groups: dict[str, dict], named_keys: list[str], saved_choices: dict, exclude_all: bool):
    """Filter optional subjects out of the scope.

    Returns (subjects_to_plan, chosen [{group, label, subject}], pending_groups that still need the student's choice).
    """
    scope_keys = {subject["key"] for subject in scope_subjects}
    keep = set(scope_keys)
    chosen, pending = [], []

    for group in groups.values():
        option_keys = [option["key"] for option in group["options"] if option["key"] in scope_keys]
        if not option_keys:
            continue
        keep -= set(option_keys)
        if exclude_all:
            continue

        picked = [key for key in option_keys if key in named_keys] or (
            [saved_choices[group["key"]]] if saved_choices.get(group["key"]) in option_keys else []
        )
        if picked:
            keep.update(picked)
            for key in picked:
                subject = next(option for option in group["options"] if option["key"] == key)
                chosen.append({"group": group["key"], "label": group["label"], "subject": {"key": key, "name": subject["name"], "code": subject.get("code") or ""}})
        else:
            pending.append(group)

    return [subject for subject in scope_subjects if subject["key"] in keep], chosen, pending


def choice_request(pending: list[dict], scope_label: str) -> dict:
    """The question the student sees before the plan is built."""
    where = "Your syllabus" if scope_label == "all subjects" else f"Your {scope_label} syllabus"
    if len(pending) == 1:
        question = f"{where} has optional courses. Which {pending[0]['label'].split(' (')[0].lower()} have you chosen?"
    else:
        question = f"{where} has {len(pending)} groups of optional courses. Pick the one you study from each group."
    return {
        "question": question,
        "groups": [
            {
                "key": group["key"],
                "label": group["label"],
                "options": [{"key": option["key"], "name": option["name"], "code": option.get("code") or ""} for option in group["options"]],
            }
            for group in pending
        ],
    }
