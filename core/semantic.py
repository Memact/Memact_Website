from __future__ import annotations

import hashlib
import logging
import math
import re
from functools import lru_cache


logger = logging.getLogger(__name__)

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
_EMBED_DIM = 256
_TRANSFORMER_DIM = 384
_LOCAL_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
_LOCAL_RERANKER_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
_TRANSFORMER_BACKEND_ERROR: str | None = None
_RERANKER_BACKEND_ERROR: str | None = None


def normalize_text(value: str) -> str:
    return " ".join(_TOKEN_PATTERN.findall((value or "").lower()))


def tokenize(value: str) -> list[str]:
    return [token for token in normalize_text(value).split() if token]


def _pad_to_dim(vector: list[float], target_dim: int) -> list[float]:
    if len(vector) >= target_dim:
        return vector[:target_dim]
    return vector + [0.0] * (target_dim - len(vector))


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
    global _TRANSFORMER_BACKEND_ERROR
    _TRANSFORMER_BACKEND_ERROR = None
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
    except Exception as exc:
        _TRANSFORMER_BACKEND_ERROR = f"sentence-transformers import failed: {exc}"
        logger.debug("Transformer backend import failed: %s", exc, exc_info=True)
        return None

    try:
        model = SentenceTransformer(
            _LOCAL_MODEL_NAME,
            local_files_only=True,
        )
        logger.debug("Loaded transformer model '%s' from local cache.", _LOCAL_MODEL_NAME)
        return model
    except Exception as exc:
        logger.debug(
            "Local-only load for transformer model '%s' failed: %s",
            _LOCAL_MODEL_NAME,
            exc,
            exc_info=True,
        )
        _TRANSFORMER_BACKEND_ERROR = f"local_files_only=True failed: {exc}"

    try:
        model = SentenceTransformer(_LOCAL_MODEL_NAME)
        logger.debug("Loaded transformer model '%s' with standard resolution.", _LOCAL_MODEL_NAME)
        _TRANSFORMER_BACKEND_ERROR = None
        return model
    except Exception as exc:
        _TRANSFORMER_BACKEND_ERROR = f"standard load failed: {exc}"
        logger.debug(
            "Standard load for transformer model '%s' failed: %s",
            _LOCAL_MODEL_NAME,
            exc,
            exc_info=True,
        )
        return None


@lru_cache(maxsize=1)
def _reranker_backend():
    global _RERANKER_BACKEND_ERROR
    _RERANKER_BACKEND_ERROR = None
    try:
        from sentence_transformers import CrossEncoder  # type: ignore
    except Exception as exc:
        _RERANKER_BACKEND_ERROR = f"sentence-transformers import failed: {exc}"
        logger.debug("Reranker backend import failed: %s", exc, exc_info=True)
        return None

    try:
        model = CrossEncoder(
            _LOCAL_RERANKER_MODEL_NAME,
            local_files_only=True,
        )
        logger.debug("Loaded reranker model '%s' from local cache.", _LOCAL_RERANKER_MODEL_NAME)
        return model
    except Exception as exc:
        logger.debug(
            "Local-only load for reranker model '%s' failed: %s",
            _LOCAL_RERANKER_MODEL_NAME,
            exc,
            exc_info=True,
        )
        _RERANKER_BACKEND_ERROR = f"local_files_only=True failed: {exc}"

    try:
        model = CrossEncoder(_LOCAL_RERANKER_MODEL_NAME)
        logger.debug("Loaded reranker model '%s' with standard resolution.", _LOCAL_RERANKER_MODEL_NAME)
        _RERANKER_BACKEND_ERROR = None
        return model
    except Exception as exc:
        _RERANKER_BACKEND_ERROR = f"standard load failed: {exc}"
        logger.debug(
            "Standard load for reranker model '%s' failed: %s",
            _LOCAL_RERANKER_MODEL_NAME,
            exc,
            exc_info=True,
        )
        return None


def embedding_backend() -> str:
    """Returns 'transformer' or 'hash'."""
    return "transformer" if _transformer_backend() is not None else "hash"


def embed_text(text: str) -> list[float]:
    normalized = normalize_text(text)
    if not normalized:
        return [0.0] * _TRANSFORMER_DIM

    model = _transformer_backend()
    if model is not None:
        try:
            vector = model.encode(normalized, normalize_embeddings=True)
            return _pad_to_dim([float(value) for value in vector], _TRANSFORMER_DIM)
        except Exception as exc:
            logger.debug("Transformer encode failed; using hash fallback: %s", exc, exc_info=True)

    return _pad_to_dim(_hash_embedding(normalized), _TRANSFORMER_DIM)


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    size = min(len(left), len(right))
    if size == 0:
        return 0.0
    return sum(float(left[index]) * float(right[index]) for index in range(size))


def rerank_query_text_pairs(query: str, texts: list[str]) -> list[float]:
    if not texts:
        return []

    model = _reranker_backend()
    if model is not None:
        try:
            pairs = [(query, text) for text in texts]
            scores = model.predict(pairs)
            return [float(score) for score in scores]
        except Exception as exc:
            logger.debug("Reranker predict failed; falling back to lexical scoring: %s", exc, exc_info=True)

    query_tokens = tokenize(query)
    normalized_query = normalize_text(query)
    scores: list[float] = []
    for text in texts:
        normalized_text = normalize_text(text)
        ordered_tokens = normalized_text.split()
        text_tokens = set(ordered_tokens)
        overlap = (
            sum(1 for token in query_tokens if token in text_tokens) / max(len(query_tokens), 1)
            if query_tokens
            else 0.0
        )
        phrase_match = 1.0 if normalized_query and normalized_query in normalized_text else 0.0
        adjacency = 0.0
        if len(query_tokens) >= 2 and len(ordered_tokens) >= 2:
            adjacent_hits = 0
            for left, right in zip(query_tokens, query_tokens[1:]):
                pair = f"{left} {right}"
                if pair in normalized_text:
                    adjacent_hits += 1
            adjacency = adjacent_hits / max(len(query_tokens) - 1, 1)
        length_penalty = min(max(len(ordered_tokens) - 80, 0) / 240.0, 0.18)
        scores.append((overlap * 0.56) + (phrase_match * 0.30) + (adjacency * 0.22) - length_penalty)
    return scores
