import re
from math import sqrt
from typing import Dict, List

from utilities.embed_upsert import EMBEDDING_MODEL, embed_dense_queries

TOKEN_PATTERN = re.compile(r"\w+|[^\w\s]", re.UNICODE)
LABELS = ("A", "B", "C")
PAIRS = ((0, 1), (0, 2), (1, 2))


def _cosine_similarity(left: List[float], right: List[float]) -> float:
    if len(left) != len(right):
        raise RuntimeError("Embedding vectors have different dimensions")

    left_norm = sqrt(sum(value * value for value in left))
    right_norm = sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        raise RuntimeError("Embedding service returned a zero vector")

    dot_product = sum(a * b for a, b in zip(left, right))
    return dot_product / (left_norm * right_norm)


def simulate_embeddings(sentences: List[str]) -> Dict[str, object]:
    vectors = embed_dense_queries(sentences)
    if len(vectors) != len(sentences):
        raise RuntimeError("Embedding service returned an unexpected number of vectors")

    embeddings = [
        {
            "label": label,
            "text": sentence,
            "vector": vector,
            "dimensions": len(vector),
            "token_count": len(TOKEN_PATTERN.findall(sentence)),
        }
        for label, sentence, vector in zip(LABELS, sentences, vectors)
    ]
    similarities = [
        {
            "pair": f"{LABELS[left]} vs {LABELS[right]}",
            "score": _cosine_similarity(vectors[left], vectors[right]),
        }
        for left, right in PAIRS
    ]
    return {
        "model": EMBEDDING_MODEL,
        "embeddings": embeddings,
        "similarities": similarities,
    }
