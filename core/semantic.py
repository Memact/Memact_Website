from __future__ import annotations

import hashlib
import math
import re
from functools import lru_cache


_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
_EMBED_DIM = 256


def normalize_text(value: str) -> str:
    return " ".join(_TOKEN_PATTERN.findall((value or "").lower()))


def tokenize(value: str) -> list[str]:
    return [token for token in normalize_text(value).split() if token]


def _hash_embedding(text: str) -> list[float]:
    tokens = tokenize(text)
    if not tokens:
        return [0.0] * _EMBED_DIM
    vector = [0.0] * _EMBED_DIM
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        slot = int.from_bytes(digest[:2], "big") % _EMBED_DIM
        sign = 1.0 if digest[2] % 2 == 0 else -1.0
        vector[slot] += sign
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


@lru_cache(maxsize=1)
def _transformer_backend():
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore

        model = SentenceTransformer(
            "sentence-transformers/all-MiniLM-L6-v2",
            local_files_only=True,
        )
        return model
    except Exception:
        return None


def embed_text(text: str) -> list[float]:
    normalized = normalize_text(text)
    if not normalized:
        return [0.0] * _EMBED_DIM
    model = _transformer_backend()
    if model is None:
        return _hash_embedding(normalized)
    try:
        vector = model.encode(normalized, normalize_embeddings=True)
        return [float(value) for value in vector]
    except Exception:
        return _hash_embedding(normalized)


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    size = min(len(left), len(right))
    if size == 0:
        return 0.0
    return sum(float(left[index]) * float(right[index]) for index in range(size))
