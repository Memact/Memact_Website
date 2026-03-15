from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from urllib.parse import urlparse

from core.database import Event, lexical_candidates, list_events_between, list_recent_events
from core.semantic import cosine_similarity, embed_text, tokenize


@dataclass(slots=True)
class EventMatch:
    event: Event
    score: float
    lexical_overlap: int
    semantic_score: float


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


@dataclass(slots=True)
class QueryAnswer:
    answer: str
    details_label: str
    evidence: list[ActivitySpan]
    time_scope_label: str | None


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


def _time_window_for_query(query: str) -> tuple[datetime | None, datetime | None, str | None]:
    text = query.lower()
    now = datetime.now()
    today = date.today()

    if "today" in text:
        start = datetime.combine(today, time.min)
        end = datetime.combine(today, time.max)
        return start, end, "today"
    if "yesterday" in text:
        day = today - timedelta(days=1)
        start = datetime.combine(day, time.min)
        end = datetime.combine(day, time.max)
        return start, end, "yesterday"
    if "this week" in text:
        start_day = today - timedelta(days=today.weekday())
        start = datetime.combine(start_day, time.min)
        end = datetime.combine(today, time.max)
        return start, end, "this week"
    if "last week" in text:
        end_day = today - timedelta(days=today.weekday() + 1)
        start_day = end_day - timedelta(days=6)
        start = datetime.combine(start_day, time.min)
        end = datetime.combine(end_day, time.max)
        return start, end, "last week"

    day = today
    if "morning" in text:
        return datetime.combine(day, time(5, 0)), datetime.combine(day, time(11, 59, 59)), "this morning"
    if "afternoon" in text:
        return datetime.combine(day, time(12, 0)), datetime.combine(day, time(16, 59, 59)), "this afternoon"
    if "evening" in text:
        return datetime.combine(day, time(17, 0)), datetime.combine(day, time(21, 59, 59)), "this evening"
    if "tonight" in text:
        return datetime.combine(day, time(18, 0)), datetime.combine(day, time(23, 59, 59)), "tonight"

    around_match = re.search(r"\b(?:around|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", text)
    if around_match:
        hour = int(around_match.group(1))
        minute = int(around_match.group(2) or 0)
        meridiem = around_match.group(3)
        if meridiem == "pm" and hour < 12:
            hour += 12
        if meridiem == "am" and hour == 12:
            hour = 0
        center = datetime.combine(today, time(hour % 24, minute))
        return center - timedelta(minutes=45), center + timedelta(minutes=45), f"around {around_match.group(0).split(None, 1)[1]}"

    return None, None, None


def _load_candidate_events(query: str, start_at: datetime | None, end_at: datetime | None) -> list[Event]:
    start_text = start_at.isoformat(sep=" ", timespec="seconds") if start_at else None
    end_text = end_at.isoformat(sep=" ", timespec="seconds") if end_at else None
    candidates = list_events_between(start_text, end_text, limit=1200)
    if len(candidates) < 120:
        seen_ids = {event.id for event in candidates}
        for event in lexical_candidates(query, start_at=start_text, end_at=end_text, limit=120):
            if event.id not in seen_ids:
                candidates.append(event)
                seen_ids.add(event.id)
    if not candidates:
        candidates = list_recent_events(limit=400)
    return candidates


def _rank_events(query: str, events: list[Event]) -> list[EventMatch]:
    query_tokens = set(tokenize(query))
    query_embedding = embed_text(query)
    matches: list[EventMatch] = []
    for event in events:
        try:
            event_embedding = json.loads(event.embedding_json)
        except Exception:
            event_embedding = embed_text(event.searchable_text)
        semantic_score = max(cosine_similarity(query_embedding, event_embedding), 0.0)
        event_tokens = set(tokenize(event.searchable_text))
        lexical_overlap = len(query_tokens & event_tokens)
        freshness_bonus = 0.03 if "heartbeat" in event.interaction_type else 0.0
        score = semantic_score + (lexical_overlap * 0.12) + freshness_bonus
        if score <= 0:
            continue
        matches.append(
            EventMatch(
                event=event,
                score=score,
                lexical_overlap=lexical_overlap,
                semantic_score=semantic_score,
            )
        )
    matches.sort(key=lambda item: (item.score, item.event.occurred_at), reverse=True)
    return matches


def _span_key(event: Event) -> tuple[str, str, str]:
    return (
        event.application.lower(),
        (_domain(event.url) or "").lower(),
        (event.window_title or "").strip().lower(),
    )


def _build_spans(events: list[Event], ranked: list[EventMatch]) -> list[ActivitySpan]:
    score_by_id = {match.event.id: match.score for match in ranked}
    ordered = sorted(events, key=lambda item: (item.occurred_at, item.id))
    spans: list[ActivitySpan] = []
    current_events: list[Event] = []
    current_key: tuple[str, str, str] | None = None

    def flush(next_start: datetime | None) -> None:
        nonlocal current_events, current_key
        if not current_events:
            return
        first = current_events[0]
        start_at = _parse_timestamp(first.occurred_at)
        if next_start is None:
            end_at = start_at + timedelta(seconds=45)
        else:
            end_at = max(next_start, start_at + timedelta(seconds=15))
        duration_seconds = int((end_at - start_at).total_seconds())
        span_score = max(score_by_id.get(event.id, 0.0) for event in current_events)
        spans.append(
            ActivitySpan(
                start_at=start_at,
                end_at=end_at,
                duration_seconds=duration_seconds,
                label=_event_label(first),
                application=first.application,
                url=first.url,
                events=list(current_events),
                relevance=span_score,
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
        if current_key == event_key and gap_seconds <= 180:
            current_events.append(event)
        else:
            flush(event_time)
            current_events = [event]
            current_key = event_key
        if next_time is None:
            flush(next_time)

    spans.sort(key=lambda span: (span.relevance, span.start_at), reverse=True)
    return spans


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


def _summarize_detail(span: ActivitySpan) -> str:
    app_name = _friendly_app_name(span.application)
    if span.url:
        return f"{_format_clock(span.start_at)} to {_format_clock(span.end_at)} in {app_name} on {_domain(span.url) or span.url}"
    return f"{_format_clock(span.start_at)} to {_format_clock(span.end_at)} in {app_name}: {span.label}"


def answer_query(query: str) -> QueryAnswer:
    if not query.strip():
        return QueryAnswer(
            answer="Ask a question about what you have been doing.",
            details_label="",
            evidence=[],
            time_scope_label=None,
        )

    start_at, end_at, time_scope = _time_window_for_query(query)
    candidates = _load_candidate_events(query, start_at, end_at)
    ranked = _rank_events(query, candidates)
    if not ranked:
        return QueryAnswer(
            answer="I could not find a strong local memory for that yet.",
            details_label="",
            evidence=[],
            time_scope_label=time_scope,
        )

    spans = _build_spans(candidates, ranked[:24])
    if not spans:
        return QueryAnswer(
            answer="I found events, but not enough structure to answer clearly yet.",
            details_label="",
            evidence=[],
            time_scope_label=time_scope,
        )

    relevant_spans = [span for span in spans if span.relevance >= max(spans[0].relevance * 0.45, 0.18)]
    if not relevant_spans:
        relevant_spans = spans[:3]

    if _duration_query(query):
        total_seconds = sum(span.duration_seconds for span in relevant_spans)
        answer = _format_duration(total_seconds)
        if time_scope:
            answer = f"{answer} {time_scope}".strip()
        return QueryAnswer(
            answer=answer,
            details_label="View details",
            evidence=relevant_spans[:6],
            time_scope_label=time_scope,
        )

    if _last_time_query(query):
        span = relevant_spans[0]
        answer = f"{_format_clock(span.start_at)} on {span.start_at.strftime('%b %d')}"
        return QueryAnswer(
            answer=answer,
            details_label="View details",
            evidence=relevant_spans[:5],
            time_scope_label=time_scope,
        )

    if _yes_no_query(query):
        strongest = relevant_spans[0]
        threshold = 0.22 if time_scope else 0.28
        if strongest.relevance >= threshold:
            answer = f"Yes, most likely around {_format_clock(strongest.start_at)}."
        else:
            answer = "I do not have clear evidence for that."
        return QueryAnswer(
            answer=answer,
            details_label="View details",
            evidence=relevant_spans[:5],
            time_scope_label=time_scope,
        )

    top_spans = relevant_spans[:3]
    if time_scope and len(tokenize(query)) <= 4:
        phrases = [_summarize_detail(span) for span in top_spans]
        answer = " ; ".join(phrases)
    else:
        labels = ", ".join(span.label for span in top_spans[:3])
        answer = f"I found activity related to {labels}."
    return QueryAnswer(
        answer=answer,
        details_label="View details",
        evidence=top_spans,
        time_scope_label=time_scope,
    )


def dynamic_suggestions(limit: int = 4) -> list[str]:
    events = list_recent_events(limit=120)
    if not events:
        return [
            "What was I doing today?",
            "What did I do yesterday evening?",
            "When did I last use my browser?",
        ][:limit]

    apps = Counter()
    domains = Counter()
    time_examples: list[str] = []
    for event in events:
        apps[_friendly_app_name(event.application)] += 1
        domain = _domain(event.url)
        if domain:
            domains[domain] += 1
        try:
            stamp = _parse_timestamp(event.occurred_at)
            time_examples.append(stamp.strftime("%#I:%M %p"))
        except ValueError:
            continue

    suggestions: list[str] = []
    if domains:
        suggestions.append(f"How much time did I spend on {domains.most_common(1)[0][0]} today?")
    if apps:
        suggestions.append(f"When did I last use {apps.most_common(1)[0][0]}?")
    suggestions.append("What was I doing yesterday evening?")
    if time_examples:
        suggestions.append(f"What was I doing around {time_examples[0]}?")
    suggestions.append("What did I work on this week?")

    deduped: list[str] = []
    seen: set[str] = set()
    for suggestion in suggestions:
        if suggestion not in seen:
            deduped.append(suggestion)
            seen.add(suggestion)
        if len(deduped) >= limit:
            break
    return deduped
