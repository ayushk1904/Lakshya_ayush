"""Text helpers and a small BM25 index used across the study planner RAG pipeline."""

import math
import re

STOPWORDS = set(
    """
    a about above after again against all also am an and any are as at be because been before being below between both but by
    can could did do does doing down during each etc few for from further had has have having he her here hers him his how i if
    in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should
    so some such than that the their them then there these they this those through to too under until up upon very via was we
    were what when where which while who whom why will with within without would you your
    introduction intro overview basic basics concept concepts fundamental fundamentals type types definition definitions various
    study use using used need needs feature features advantage advantages disadvantage disadvantages characteristic characteristics
    example examples method methods technique techniques approach approaches model models issue issues role importance part
    module unit chapter hrs hr hour hours lecture lectures topic topics course syllabus semester sem
    explain describe discuss write short note notes mark marks question questions answer following define state list give
    compare comparison differentiate difference differences justify illustrate suitable neat diagram draw what how why brief
    briefly detail detailed q qs any two three four five six attempt compulsory solve find consider assume
    """.split()
)

SUFFIXES = ["ations", "ation", "ings", "ing", "ness", "ment", "ers", "er", "ed", "es", "s"]
ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10}


def stem(word: str) -> str:
    """Very light suffix stripping so 'learning', 'learned' and 'learns' all become 'learn'."""
    if len(word) <= 4:
        return word
    if word.endswith("ies") and len(word) > 5:
        return word[:-3] + "y"
    for suffix in SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[: -len(suffix)]
    return word


def tokenize(text: str, keep_stopwords: bool = False) -> list[str]:
    """Lowercase, drop punctuation, numbers and stopwords, then stem."""
    words = re.sub(r"[^a-z0-9+#\s]", " ", str(text or "").lower()).split()
    tokens = []
    for word in words:
        if len(word) <= 1 or word.isdigit():
            continue
        if not keep_stopwords and word in STOPWORDS:
            continue
        tokens.append(stem(word))
    return tokens


def clean_pdf_text(text: str) -> str:
    """Remove pdf-parse page markers and squeeze whitespace."""
    text = str(text or "").replace("\r", "")
    text = re.sub(r"^\s*--\s*\d+\s*of\s*\d+\s*--\s*$", "\n", text, flags=re.I | re.M)
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def parse_number_token(value) -> int | None:
    """'6' -> 6, 'vi' -> 6, anything else -> None."""
    normalized = str(value or "").strip().lower()
    if normalized.isdigit():
        return int(normalized)
    return ROMAN.get(normalized)


def js_round(value: float) -> int:
    """Round half up (like JavaScript's Math.round), not banker's rounding."""
    return math.floor(value + 0.5)


class Bm25Index:
    """Classic BM25 ranking over pre-tokenized documents."""

    def __init__(self, documents: list[list[str]], k1: float = 1.4, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.docs = []
        for tokens in documents:
            frequency: dict[str, int] = {}
            for token in tokens:
                frequency[token] = frequency.get(token, 0) + 1
            self.docs.append({"length": len(tokens), "tf": frequency})

        self.average_length = sum(doc["length"] for doc in self.docs) / max(1, len(self.docs))
        self.document_frequency: dict[str, int] = {}
        for doc in self.docs:
            for token in doc["tf"]:
                self.document_frequency[token] = self.document_frequency.get(token, 0) + 1

    def idf(self, token: str) -> float:
        df = self.document_frequency.get(token, 0)
        return math.log(1 + (len(self.docs) - df + 0.5) / (df + 0.5))

    def score(self, query_tokens: list[str], doc_index: int) -> float:
        doc = self.docs[doc_index]
        total = 0.0
        for token in set(query_tokens):
            frequency = doc["tf"].get(token)
            if not frequency:
                continue
            normalizer = frequency + self.k1 * (1 - self.b + self.b * doc["length"] / (self.average_length or 1))
            total += self.idf(token) * (frequency * (self.k1 + 1)) / normalizer
        return total

    def search(self, query_tokens: list[str], limit: int = 10, min_score: float = 0.0) -> list[dict]:
        hits = [{"index": index, "score": self.score(query_tokens, index)} for index in range(len(self.docs))]
        hits = [hit for hit in hits if hit["score"] > min_score]
        hits.sort(key=lambda hit: hit["score"], reverse=True)
        return hits[:limit]
