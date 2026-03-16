from __future__ import annotations

import json
import re
import math
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from difflib import SequenceMatcher
from urllib.parse import urlparse

from core.database import Event, lexical_candidates, list_events_between, list_recent_events
from core.semantic import cosine_similarity, embed_text, tokenize


_STOP_WORDS = {
    "a",
    "about",
    "am",
    "an",
    "and",
    "around",
    "at",
    "did",
    "do",
    "for",
    "have",
    "how",
    "i",
    "in",
    "is",
    "last",
    "me",
    "my",
    "of",
    "on",
    "the",
    "this",
    "time",
    "to",
    "today",
    "use",
    "was",
    "what",
    "when",
    "where",
    "which",
    "yesterday",
}


@dataclass(slots=True)
class EventMatch:
    event: Event
    score: float
    lexical_score: float
    semantic_score: float
    fuzzy_score: float
    phrase_match: bool
    entity_match: bool


@dataclass(slots=True)
class ActivitySpan:
    start_at: datetime
    end_at: datetime
    duration_seconds: int
    label: str
    application: str
    url: str | None
    events: list[Event]
    relevance: float
    snippet: str
    match_reason: str


@dataclass(slots=True)
class SearchSuggestion:
    title: str
    subtitle: str
    completion: str
    category: str


@dataclass(slots=True)
class QueryAnswer:
    answer: str
    summary: str
    details_label: str
    evidence: list[ActivitySpan]
    time_scope_label: str | None
    result_count: int
    related_queries: list[str]


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _domain(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme == "file":
        return "local file"
    if parsed.netloc:
        return parsed.netloc.removeprefix("www.")
    return None


def _event_label(event: Event) -> str:
    domain = _domain(event.url)
    if domain:
        return domain
    title = (event.content_text or event.window_title or "").strip()
    if title:
        return title
    return event.application.removesuffix(".exe")


def _friendly_app_name(value: str) -> str:
    base = value.removesuffix(".exe")
    return base.replace("_", " ").title()


def _normalize_label(value: str) -> str:
    text = re.sub(r"\s+", " ", value.strip(" -|:"))
    if not text:
        return text
    parts = [part.strip() for part in re.split(r"\s*[-|:]\s*", text) if part.strip()]
    deduped_parts: list[str] = []
    seen_parts: set[str] = set()
    for part in parts:
        key = part.casefold()
        if key in seen_parts:
            continue
        deduped_parts.append(part)
        seen_parts.add(key)
    normalized = " - ".join(deduped_parts) if deduped_parts else text

    # Collapse repeated adjacent words like "Codex Codex" into one label.
    words = normalized.split()
    collapsed: list[str] = []
    previous_key = None
    for word in words:
        key = word.casefold()
        if key == previous_key:
            continue
        collapsed.append(word)
        previous_key = key
    return " ".join(collapsed)


def _display_label(span: ActivitySpan) -> str:
    app_name = _friendly_app_name(span.application)
    label = _normalize_label(span.label)
    if not label:
        return app_name
    if label.casefold() == app_name.casefold():
        return app_name
    if app_name.casefold() in label.casefold():
        return label
    return label


def _unique_span_labels(spans: list[ActivitySpan], limit: int = 3) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for span in spans:
        label = _display_label(span)
        key = label.casefold()
        if not label or key in seen:
            continue
        unique.append(label)
        seen.add(key)
        if len(unique) >= limit:
            break
    return unique


def _format_duration(seconds: int) -> str:
    seconds = max(int(seconds), 0)
    minutes, _ = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours and minutes:
        return f"{hours} hours {minutes} minutes"
    if hours:
        return f"{hours} hours"
    if minutes:
        return f"{minutes} minutes"
    return "less than a minute"


def _format_clock(value: datetime) -> str:
    return value.strftime("%#I:%M %p" if value.strftime("%p") else "%H:%M")


def _meaningful_tokens(text: str) -> list[str]:
    return [token for token in tokenize(text) if token not in _STOP_WORDS]


def _time_window_for_query(query: str) -> tuple[datetime | None, datetime | None, str | None]:
    text = query.lower()
    today = date.today()
    label: str | None = None
    start: datetime | None = None
    end: datetime | None = None

    if "last week" in text:
        end_day = today - timedelta(days=today.weekday() + 1)
        start_day = end_day - timedelta(days=6)
        start = datetime.combine(start_day, time.min)
        end = datetime.combine(end_day, time.max)
        label = "last week"
    elif "this week" in text:
        start_day = today - timedelta(days=today.weekday())
        start = datetime.combine(start_day, time.min)
        end = datetime.combine(today, time.max)
        label = "this week"
    else:
        day = today
        if "yesterday" in text:
            day = today - timedelta(days=1)
            label = "yesterday"
        elif "today" in text:
            label = "today"
        start = datetime.combine(day, time.min)
        end = datetime.combine(day, time.max)

        for bucket_label, bucket_start, bucket_end in (
            ("morning", time(5, 0), time(11, 59, 59)),
            ("afternoon", time(12, 0), time(16, 59, 59)),
            ("evening", time(17, 0), time(21, 59, 59)),
            ("tonight", time(18, 0), time(23, 59, 59)),
        ):
            if bucket_label in text:
                start = datetime.combine(day, bucket_start)
                end = datetime.combine(day, bucket_end)
                label = f"{label} {bucket_label}".strip() if label else f"this {bucket_label}"
                break

        around_match = re.search(r"\b(?:around|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", text)
        if around_match:
            hour = int(around_match.group(1))
            minute = int(around_match.group(2) or 0)
            meridiem = around_match.group(3)
            if meridiem == "pm" and hour < 12:
                hour += 12
            if meridiem == "am" and hour == 12:
                hour = 0
            center = datetime.combine(day, time(hour % 24, minute))
            start = center - timedelta(minutes=45)
            end = center + timedelta(minutes=45)
            label = f"{label} around {_format_clock(center)}".strip() if label else f"around {_format_clock(center)}"

    if start and end and start > end:
        start, end = end, start
    return start, end, label


def _load_candidate_events(query: str, start_at: datetime | None, end_at: datetime | None) -> list[Event]:
    start_text = start_at.isoformat(sep=" ", timespec="seconds") if start_at else None
    end_text = end_at.isoformat(sep=" ", timespec="seconds") if end_at else None
    recent_pool = list_events_between(start_text, end_text, limit=1200)
    lexical_pool = lexical_candidates(query, start_at=start_text, end_at=end_text, limit=180)
    fallback_pool = list_recent_events(limit=500)

    combined: list[Event] = []
    seen_ids: set[int] = set()
    for pool in (lexical_pool, recent_pool, fallback_pool):
        for event in pool:
            if event.id in seen_ids:
                continue
            combined.append(event)
            seen_ids.add(event.id)
    return combined


def _idf_by_token(events: list[Event]) -> dict[str, float]:
    document_frequency: Counter[str] = Counter()
    for event in events:
        for token in set(tokenize(event.searchable_text)):
            document_frequency[token] += 1
    total = max(len(events), 1)
    return {
        token: math.log((1 + total) / (1 + count)) + 1.0
        for token, count in document_frequency.items()
    }


def _fuzzy_overlap(query_tokens: list[str], event_tokens: set[str]) -> float:
    score = 0.0
    for token in query_tokens:
        if len(token) < 4 or token in event_tokens:
            continue
        best = 0.0
        for event_token in event_tokens:
            if abs(len(event_token) - len(token)) > 2:
                continue
            ratio = SequenceMatcher(None, token, event_token).ratio()
            if ratio > best:
                best = ratio
        if best >= 0.82:
            score += best
    return score


def _rank_events(query: str, events: list[Event]) -> list[EventMatch]:
    query_tokens = _meaningful_tokens(query)
    query_embedding = embed_text(query)
    normalized_query = " ".join(tokenize(query))
    idf = _idf_by_token(events)
    now = datetime.now()
    matches: list[EventMatch] = []
    for event in events:
        try:
            event_embedding = json.loads(event.embedding_json)
        except Exception:
            event_embedding = embed_text(event.searchable_text)
        semantic_score = max(cosine_similarity(query_embedding, event_embedding), 0.0)
        event_tokens = set(tokenize(event.searchable_text))
        lexical_score = sum(idf.get(token, 1.0) for token in query_tokens if token in event_tokens)
        fuzzy_score = _fuzzy_overlap(query_tokens, event_tokens)
        searchable_text = " ".join(tokenize(event.searchable_text))
        phrase_match = bool(normalized_query and normalized_query in searchable_text)
        domain = (_domain(event.url) or "").lower()
        app_name = _friendly_app_name(event.application).lower()
        entity_match = any(
            token in domain or token in app_name
            for token in query_tokens
            if len(token) >= 3
        )
        try:
            age_hours = max((now - _parse_timestamp(event.occurred_at)).total_seconds() / 3600.0, 0.0)
        except ValueError:
            age_hours = 0.0
        recency_bonus = max(0.0, 0.12 - min(age_hours / 240.0, 0.12))
        freshness_bonus = 0.03 if "heartbeat" in event.interaction_type else 0.0
        score = (
            (semantic_score * 0.56)
            + (min(lexical_score, 4.0) * 0.16)
            + (min(fuzzy_score, 2.0) * 0.08)
            + (0.18 if phrase_match else 0.0)
            + (0.16 if entity_match else 0.0)
            + recency_bonus
            + freshness_bonus
        )
        if query_tokens and lexical_score == 0 and fuzzy_score == 0 and semantic_score < 0.18:
            continue
        if score <= 0.12:
            continue
        matches.append(
            EventMatch(
                event=event,
                score=score,
                lexical_score=lexical_score,
                semantic_score=semantic_score,
                fuzzy_score=fuzzy_score,
                phrase_match=phrase_match,
                entity_match=entity_match,
            )
        )
    matches.sort(key=lambda item: (item.score, item.event.occurred_at, item.event.id), reverse=True)
    return matches


def _span_key(event: Event) -> tuple[str, str, str]:
    return (
        event.application.lower(),
        (_domain(event.url) or "").lower(),
        (event.window_title or "").strip().lower(),
    )


def _best_event_for_span(events: list[Event], score_by_id: dict[int, float]) -> Event:
    return max(
        events,
        key=lambda event: (
            score_by_id.get(event.id, 0.0),
            len((event.content_text or "").strip()),
            len((event.window_title or "").strip()),
            event.id,
        ),
    )


def _snippet_from_event(event: Event) -> str:
    candidates = [
        (event.content_text or "").strip(),
        (event.window_title or "").strip(),
    ]
    if event.tab_titles:
        candidates.append(" | ".join(event.tab_titles[:3]))
    if event.url:
        candidates.append(event.url)
    for value in candidates:
        if not value:
            continue
        cleaned = re.sub(r"\s+", " ", value)
        if len(cleaned) > 140:
            return f"{cleaned[:137].rstrip()}..."
        return cleaned
    return _friendly_app_name(event.application)


def _match_reason(match: EventMatch | None) -> str:
    if match is None:
        return "Relevant local activity"
    if match.entity_match and match.phrase_match:
        return "Exact entity and phrase match"
    if match.entity_match:
        return "Strong app or site match"
    if match.phrase_match:
        return "Exact phrase match"
    if match.fuzzy_score >= 0.82:
        return "Recovered from close spelling match"
    if match.semantic_score >= 0.48:
        return "Strong semantic match"
    return "Relevant local activity"


def _build_spans(ranked: list[EventMatch]) -> list[ActivitySpan]:
    top_matches = ranked[:64]
    score_by_id = {match.event.id: match.score for match in top_matches}
    match_by_id = {match.event.id: match for match in top_matches}
    ordered = sorted((match.event for match in top_matches), key=lambda item: (item.occurred_at, item.id))
    spans: list[ActivitySpan] = []
    current_events: list[Event] = []
    current_key: tuple[str, str, str] | None = None

    def flush(next_start: datetime | None) -> None:
        nonlocal current_events, current_key
        if not current_events:
            return
        best_event = _best_event_for_span(current_events, score_by_id)
        first = current_events[0]
        start_at = _parse_timestamp(first.occurred_at)
        if next_start is None:
            end_at = start_at + timedelta(seconds=45)
        else:
            end_at = max(next_start, start_at + timedelta(seconds=20))
        duration_seconds = int((end_at - start_at).total_seconds())
        span_score = max(score_by_id.get(event.id, 0.0) for event in current_events)
        spans.append(
            ActivitySpan(
                start_at=start_at,
                end_at=end_at,
                duration_seconds=duration_seconds,
                label=_event_label(best_event),
                application=best_event.application,
                url=best_event.url,
                events=list(current_events),
                relevance=span_score,
                snippet=_snippet_from_event(best_event),
                match_reason=_match_reason(match_by_id.get(best_event.id)),
            )
        )
        current_events = []
        current_key = None

    for index, event in enumerate(ordered):
        event_key = _span_key(event)
        event_time = _parse_timestamp(event.occurred_at)
        next_time = None
        if index + 1 < len(ordered):
            next_time = _parse_timestamp(ordered[index + 1].occurred_at)
        if not current_events:
            current_events = [event]
            current_key = event_key
            if next_time is None:
                flush(next_time)
            continue
        previous_time = _parse_timestamp(current_events[-1].occurred_at)
        gap_seconds = int((event_time - previous_time).total_seconds())
        if current_key == event_key and gap_seconds <= 240:
            current_events.append(event)
        else:
            flush(event_time)
            current_events = [event]
            current_key = event_key
        if next_time is None:
            flush(next_time)

    spans.sort(key=lambda span: (span.relevance, span.start_at), reverse=True)
    deduped: list[ActivitySpan] = []
    seen: set[tuple[str, str, str]] = set()
    for span in spans:
        key = (
            span.application.casefold(),
            (_domain(span.url) or "").casefold(),
            _display_label(span).casefold(),
        )
        if key in seen:
            continue
        deduped.append(span)
        seen.add(key)
    return deduped


def _duration_query(query: str) -> bool:
    text = query.lower()
    return any(
        phrase in text
        for phrase in ("how long", "how much time", "time on", "time spent", "hours", "minutes")
    )


def _yes_no_query(query: str) -> bool:
    text = query.strip().lower()
    return text.startswith(("did ", "have ", "was ", "were ", "do i ", "am i "))


def _last_time_query(query: str) -> bool:
    return "when did i" in query.lower() or "last time" in query.lower()


def _listing_query(query: str) -> bool:
    text = query.lower()
    return text.startswith("which ") or "what apps" in text or "what sites" in text


def _summarize_detail(span: ActivitySpan) -> str:
    app_name = _friendly_app_name(span.application)
    if span.url:
        return f"{_format_clock(span.start_at)} to {_format_clock(span.end_at)} in {app_name} on {_domain(span.url) or span.url}"
    return f"{_format_clock(span.start_at)} to {_format_clock(span.end_at)} in {app_name}: {_display_label(span)}"


def _query_summary(spans: list[ActivitySpan], time_scope: str | None) -> str:
    labels = _unique_span_labels(spans, limit=3)
    if not labels:
        labels = [_friendly_app_name(span.application) for span in spans[:3]]
    count_text = f"{len(spans)} strong local matches"
    if time_scope:
        count_text = f"{count_text} in {time_scope}"
    if not labels:
        return count_text
    if len(labels) == 1:
        return f"{count_text}. Best match: {labels[0]}."
    return f"{count_text}. Top matches include {', '.join(labels[:-1])}, and {labels[-1]}."


def _build_related_queries(query: str, spans: list[ActivitySpan], time_scope: str | None) -> list[str]:
    prompts: list[str] = []
    for span in spans[:3]:
        label = _display_label(span)
        app = _friendly_app_name(span.application)
        if span.url:
            domain = _domain(span.url) or label
            prompts.append(f"How much time did I spend on {domain} today?")
            prompts.append(f"When did I last use {domain}?")
        prompts.append(f"When did I last use {app}?")
        prompts.append(f"Did I use {label} today?")
    if time_scope:
        prompts.append(f"What else was I doing {time_scope}?")
    prompts.append(f"What did I do after {query.strip('?')}?")

    deduped: list[str] = []
    seen: set[str] = set()
    for prompt in prompts:
        key = prompt.casefold()
        if key in seen or key == query.strip().casefold():
            continue
        deduped.append(prompt)
        seen.add(key)
        if len(deduped) >= 3:
            break
    return deduped


def answer_query(query: str) -> QueryAnswer:
    if not query.strip():
        return QueryAnswer(
            answer="Ask a question about what you have been doing.",
            summary="Memact searches only your local activity history.",
            details_label="",
            evidence=[],
            time_scope_label=None,
            result_count=0,
            related_queries=[],
        )

    start_at, end_at, time_scope = _time_window_for_query(query)
    candidates = _load_candidate_events(query, start_at, end_at)
    ranked = _rank_events(query, candidates)
    if not ranked:
        return QueryAnswer(
            answer="I could not find a strong local memory for that yet.",
            summary="Try a clearer app name, site, or time window like today, yesterday evening, or around 3 PM.",
            details_label="",
            evidence=[],
            time_scope_label=time_scope,
            result_count=0,
            related_queries=[],
        )

    spans = _build_spans(ranked)
    if not spans:
        return QueryAnswer(
            answer="I found events, but not enough structure to answer clearly yet.",
            summary="There are matching events in local memory, but they are too weak or fragmented to summarize cleanly.",
            details_label="",
            evidence=[],
            time_scope_label=time_scope,
            result_count=len(ranked),
            related_queries=[],
        )

    relevant_spans = [span for span in spans if span.relevance >= max(spans[0].relevance * 0.42, 0.22)]
    if not relevant_spans:
        relevant_spans = spans[:4]

    summary = _query_summary(relevant_spans, time_scope)
    related_queries = _build_related_queries(query, relevant_spans, time_scope)

    if _duration_query(query):
        total_seconds = sum(span.duration_seconds for span in relevant_spans)
        answer = _format_duration(total_seconds)
        if time_scope:
            answer = f"{answer} in {time_scope}"
        return QueryAnswer(
            answer=answer,
            summary=summary,
            details_label="Show top matches",
            evidence=relevant_spans[:6],
            time_scope_label=time_scope,
            result_count=len(ranked),
            related_queries=related_queries,
        )

    if _last_time_query(query):
        span = relevant_spans[0]
        answer = f"{_format_clock(span.start_at)} on {span.start_at.strftime('%b %d')}"
        return QueryAnswer(
            answer=answer,
            summary=f"Best local match: {_display_label(span)} in {_friendly_app_name(span.application)}.",
            details_label="Show top matches",
            evidence=relevant_spans[:6],
            time_scope_label=time_scope,
            result_count=len(ranked),
            related_queries=related_queries,
        )

    if _yes_no_query(query):
        strongest = relevant_spans[0]
        threshold = 0.25 if time_scope else 0.31
        answer = "I do not have clear evidence for that."
        if strongest.relevance >= threshold:
            answer = f"Yes, most likely around {_format_clock(strongest.start_at)}."
            summary = f"Best evidence points to {_display_label(strongest)} in {_friendly_app_name(strongest.application)}."
        return QueryAnswer(
            answer=answer,
            summary=summary,
            details_label="Show top matches",
            evidence=relevant_spans[:6],
            time_scope_label=time_scope,
            result_count=len(ranked),
            related_queries=related_queries,
        )

    if _listing_query(query):
        labels = _unique_span_labels(relevant_spans, limit=5)
        if not labels:
            labels = [_friendly_app_name(span.application) for span in relevant_spans[:5]]
        answer = ", ".join(labels[:5]) if labels else "I found matching local activity."
        return QueryAnswer(
            answer=answer,
            summary=summary,
            details_label="Show top matches",
            evidence=relevant_spans[:6],
            time_scope_label=time_scope,
            result_count=len(ranked),
            related_queries=related_queries,
        )

    top_spans = relevant_spans[:3]
    if time_scope and len(_meaningful_tokens(query)) <= 4:
        phrases = [_summarize_detail(span) for span in top_spans]
        answer = " ; ".join(phrases)
    else:
        labels = _unique_span_labels(top_spans, limit=3)
        if not labels:
            labels = [_friendly_app_name(span.application) for span in top_spans[:2]]
        if len(labels) == 1:
            answer = f"I found activity related to {labels[0]}."
        elif len(labels) == 2:
            answer = f"I found activity related to {labels[0]} and {labels[1]}."
        else:
            answer = f"I found activity related to {', '.join(labels[:-1])}, and {labels[-1]}."
    return QueryAnswer(
        answer=answer,
        summary=summary,
        details_label="Show top matches",
        evidence=relevant_spans[:6],
        time_scope_label=time_scope,
        result_count=len(ranked),
        related_queries=related_queries,
    )


def dynamic_suggestions(limit: int = 4) -> list[SearchSuggestion]:
    events = list_recent_events(limit=120)
    if not events:
        return [
            SearchSuggestion(
                title="What was I doing today?",
                subtitle="Broad overview of your latest activity.",
                completion="What was I doing today?",
                category="Suggested",
            ),
            SearchSuggestion(
                title="What did I do yesterday evening?",
                subtitle="Good for day-part recall.",
                completion="What did I do yesterday evening?",
                category="Suggested",
            ),
            SearchSuggestion(
                title="When did I last use my browser?",
                subtitle="Find the latest browser activity.",
                completion="When did I last use my browser?",
                category="Suggested",
            ),
        ][:limit]

    apps = Counter()
    domains = Counter()
    for event in events:
        apps[_friendly_app_name(event.application)] += 1
        domain = _domain(event.url)
        if domain:
            domains[domain] += 1

    suggestions: list[SearchSuggestion] = []
    if domains:
        prompt = f"How much time did I spend on {domains.most_common(1)[0][0]} today?"
        suggestions.append(
            SearchSuggestion(
                title=prompt,
                subtitle="Estimate time spent on a specific site.",
                completion=prompt,
                category="Frequent site",
            )
        )
    if apps:
        prompt = f"When did I last use {apps.most_common(1)[0][0]}?"
        suggestions.append(
            SearchSuggestion(
                title=prompt,
                subtitle="Jump straight to the latest app usage.",
                completion=prompt,
                category="Frequent app",
            )
        )
    for prompt, subtitle in (
        ("What was I doing yesterday evening?", "Look at a recent time slice."),
        ("What did I work on this week?", "Summarize broader work patterns."),
        ("Did I open GitHub today?", "Ask a direct yes or no question."),
    ):
        suggestions.append(
            SearchSuggestion(
                title=prompt,
                subtitle=subtitle,
                completion=prompt,
                category="Suggested",
            )
        )

    deduped: list[SearchSuggestion] = []
    seen: set[str] = set()
    for suggestion in suggestions:
        if suggestion.completion.casefold() not in seen:
            deduped.append(suggestion)
            seen.add(suggestion.completion.casefold())
        if len(deduped) >= limit:
            break
    return deduped


def autocomplete_suggestions(prefix: str, limit: int = 5) -> list[SearchSuggestion]:
    typed = prefix.strip()
    if not typed:
        return []

    lower = typed.lower()
    lexical = lexical_candidates(typed, limit=32)
    pool = lexical or list_recent_events(limit=80)

    entity_counts = Counter[str]()
    for event in pool:
        for label in (_domain(event.url), _friendly_app_name(event.application), _event_label(event)):
            if label and len(label.strip()) >= 3:
                entity_counts[label.strip()] += 1

    entity_suggestions: list[SearchSuggestion] = []
    token_matches = _meaningful_tokens(lower)
    for label, _count in entity_counts.most_common(8):
        label_lower = label.lower()
        if token_matches and not any(token in label_lower for token in token_matches):
            continue
        entity_suggestions.extend(
            [
                SearchSuggestion(
                    title=f"When did I last use {label}?",
                    subtitle="Direct lookup for the latest matching activity.",
                    completion=f"When did I last use {label}?",
                    category="Quick answer",
                ),
                SearchSuggestion(
                    title=f"How much time did I spend on {label} today?",
                    subtitle="Estimate time spent in the current day.",
                    completion=f"How much time did I spend on {label} today?",
                    category="Time analysis",
                ),
                SearchSuggestion(
                    title=f"Did I use {label} today?",
                    subtitle="Binary check against recent activity.",
                    completion=f"Did I use {label} today?",
                    category="Verification",
                ),
            ]
        )

    intent_map = {
        "what": [
            SearchSuggestion(
                title="What was I doing today?",
                subtitle="Overview of current-day activity.",
                completion="What was I doing today?",
                category="Explore",
            ),
            SearchSuggestion(
                title="What did I do yesterday evening?",
                subtitle="Focus on a specific time window.",
                completion="What did I do yesterday evening?",
                category="Explore",
            ),
        ],
        "when": [
            SearchSuggestion(
                title="When did I last use Chrome?",
                subtitle="Find the latest app or site usage.",
                completion="When did I last use Chrome?",
                category="Quick answer",
            ),
            SearchSuggestion(
                title="When did I last visit GitHub?",
                subtitle="Resolve recent site activity quickly.",
                completion="When did I last visit GitHub?",
                category="Quick answer",
            ),
        ],
        "how": [
            SearchSuggestion(
                title="How much time did I spend on YouTube today?",
                subtitle="Estimate duration from grouped events.",
                completion="How much time did I spend on YouTube today?",
                category="Time analysis",
            ),
            SearchSuggestion(
                title="How long was I coding today?",
                subtitle="Measure time spent in a work session.",
                completion="How long was I coding today?",
                category="Time analysis",
            ),
        ],
        "did": [
            SearchSuggestion(
                title="Did I open GitHub today?",
                subtitle="Check whether an action likely happened.",
                completion="Did I open GitHub today?",
                category="Verification",
            ),
            SearchSuggestion(
                title="Did I use Discord today?",
                subtitle="Verify activity from local events.",
                completion="Did I use Discord today?",
                category="Verification",
            ),
        ],
        "which": [
            SearchSuggestion(
                title="Which apps did I use today?",
                subtitle="List distinct apps from local history.",
                completion="Which apps did I use today?",
                category="Explore",
            ),
            SearchSuggestion(
                title="Which sites did I visit today?",
                subtitle="List distinct domains from browser activity.",
                completion="Which sites did I visit today?",
                category="Explore",
            ),
        ],
    }

    candidates: list[SearchSuggestion] = []
    for key, suggestions in intent_map.items():
        if lower.startswith(key):
            candidates.extend(suggestions)
            break
    candidates.extend(entity_suggestions)
    if not candidates:
        candidates.extend(dynamic_suggestions(limit=limit))

    deduped: list[SearchSuggestion] = []
    seen: set[str] = set()
    for candidate in candidates:
        if candidate.completion.casefold() in seen:
            continue
        if not lower.startswith(("what", "when", "how", "did", "which")) and lower not in candidate.completion.lower():
            continue
        deduped.append(candidate)
        seen.add(candidate.completion.casefold())
        if len(deduped) >= limit:
            break
    return deduped
