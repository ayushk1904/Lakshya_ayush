"""Mines previous-year question papers (PYQs) to count how often each syllabus topic was asked.

For every topic we keep its 4 most distinctive words (rare across the syllabus).
A question "asks" a topic when it contains enough of those words.
Each paper is first linked to the subject whose vocabulary it matches best,
so an ML paper never counts towards Cryptography topics.
"""

import math
import re

from .text_utils import tokenize

QUESTION_SPLIT = re.compile(r"\n\s*(?=(?:Q\.?\s*(?:no\.?\s*)?\d+|\(?[a-h]\)|\d{1,2}[.)]\s|\(?[ivx]{1,4}\)\s))", re.I)


def topic_id(subject_key: str, unit_number: int, topic_index: int) -> str:
    return f"{subject_key}::{unit_number}::{topic_index}"


def split_questions(text: str) -> list[str]:
    questions = []
    for part in QUESTION_SPLIT.split(str(text or "").replace("\r", "")):
        part = re.sub(r"\s+", " ", part).strip()
        if 15 <= len(part) <= 700 and re.search(r"[a-z]{4,}", part, re.I):
            questions.append(part)
    return questions


def build_topic_signatures(subjects: list[dict]) -> list[dict]:
    topics = []
    for subject in subjects:
        for unit in subject["units"]:
            for index, topic in enumerate(unit["topics"]):
                topics.append(
                    {
                        "id": topic_id(subject["key"], unit["number"], index),
                        "subject_key": subject["key"],
                        "terms": list(dict.fromkeys(tokenize(topic))),
                    }
                )

    # Weight each word by how rare it is across all topics (IDF), keep the top 4.
    frequency: dict[str, int] = {}
    for topic in topics:
        for term in topic["terms"]:
            frequency[term] = frequency.get(term, 0) + 1
    for topic in topics:
        weighted = [{"term": term, "weight": math.log(1 + len(topics) / frequency.get(term, 1))} for term in topic["terms"]]
        weighted.sort(key=lambda entry: entry["weight"], reverse=True)
        topic["terms"] = weighted[:4]

    return [topic for topic in topics if topic["terms"]]


def question_matches_topic(question_terms: set[str], topic: dict, rare_weight: float) -> bool:
    matched = [entry for entry in topic["terms"] if entry["term"] in question_terms]
    if not matched:
        return False
    if len(topic["terms"]) == 1:
        # Single-word topics only count when that word is rare in the syllabus.
        return matched[0]["weight"] >= rare_weight
    required = max(2, math.ceil(len(topic["terms"]) * 0.6))
    return len(matched) >= min(required, len(topic["terms"]))


def assign_paper_to_subject(paper_terms: set[str], subjects: list[dict]) -> str | None:
    scores = []
    for subject in subjects:
        vocabulary = set()
        for unit in subject["units"]:
            for value in [unit["title"], *unit["topics"]]:
                vocabulary.update(tokenize(value))
        hits = len(vocabulary & paper_terms)
        scores.append({"key": subject["key"], "ratio": hits / len(vocabulary) if vocabulary else 0})

    scores.sort(key=lambda entry: entry["ratio"], reverse=True)
    best = scores[0] if scores else None
    second = scores[1] if len(scores) > 1 else None
    if best and best["ratio"] >= 0.18 and (second is None or best["ratio"] >= second["ratio"] * 1.35):
        return best["key"]
    return None


def analyze_papers(subjects: list[dict], papers: list[dict]) -> dict:
    """Returns {"stats": {topic_id: {questions, papers, samples}}, "subjects_with_papers": set, "paper_count": int}."""
    stats: dict[str, dict] = {}
    subjects_with_papers: set[str] = set()
    theory = [subject for subject in subjects if subject.get("kind") == "theory" and subject["units"]]

    if not papers or not theory:
        return {"stats": stats, "subjects_with_papers": subjects_with_papers, "paper_count": 0}

    topics = build_topic_signatures(theory)
    rare_weight = math.log(1 + len(topics) / 2.5)

    for paper in papers:
        text = paper.get("extractedText") or ""
        subject_key = assign_paper_to_subject(set(tokenize(text)), theory)
        candidates = [topic for topic in topics if topic["subject_key"] == subject_key] if subject_key else topics
        seen_in_paper: set[str] = set()
        if subject_key:
            subjects_with_papers.add(subject_key)

        for question in split_questions(text):
            question_terms = set(tokenize(question))
            for topic in candidates:
                if not question_matches_topic(question_terms, topic, rare_weight):
                    continue
                entry = stats.setdefault(topic["id"], {"questions": 0, "papers": 0, "samples": []})
                entry["questions"] += 1
                if topic["id"] not in seen_in_paper:
                    entry["papers"] += 1
                    seen_in_paper.add(topic["id"])
                if len(entry["samples"]) < 2 and question not in entry["samples"]:
                    entry["samples"].append(question[:220])
                if not subject_key:
                    subjects_with_papers.add(topic["subject_key"])

    return {"stats": stats, "subjects_with_papers": subjects_with_papers, "paper_count": len(papers)}
