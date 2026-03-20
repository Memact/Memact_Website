from __future__ import annotations

import json
import sqlite3
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from core.semantic import embed_text


APP_DIR = Path.home() / "AppData" / "Local" / "memact"
LEGACY_APP_DIR = Path.home() / "AppData" / "Local" / "Memact"
DB_PATH = APP_DIR / "memact.db"


@dataclass(slots=True)
class Event:
    id: int
    occurred_at: str
    application: str
    window_title: str
    url: str | None
    interaction_type: str
    content_text: str | None
    exe_path: str | None
    tab_titles_json: str | None
    tab_urls_json: str | None
    searchable_text: str
    embedding_json: str
    source: str

    @property
    def timestamp(self) -> str:
        return self.occurred_at

    @property
    def app_name(self) -> str:
        return self.application

    @property
    def context_title(self) -> str | None:
        return self.content_text

    @property
    def tab_titles(self) -> list[str]:
        return _decode_json_list(self.tab_titles_json)

    @property
    def tab_urls(self) -> list[str]:
        return _decode_json_list(self.tab_urls_json)

    @property
    def tabs(self) -> list[str]:
        return self.tab_titles

    @property
    def urls(self) -> list[str]:
        urls = self.tab_urls
        if urls:
            return urls
        return [self.url] if self.url else []


Anchor = Event


def get_connection() -> sqlite3.Connection:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    legacy_db = LEGACY_APP_DIR / "memact.db"
    if not DB_PATH.exists() and legacy_db.exists():
        shutil.copy2(legacy_db, DB_PATH)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def _decode_json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item).strip() for item in parsed if str(item).strip()]


def _encode_json_list(items: list[str] | None) -> str | None:
    if not items:
        return None
    cleaned = [str(item).strip() for item in items if str(item).strip()]
    if not cleaned:
        return None
    return json.dumps(cleaned, ensure_ascii=True)


def _domain_from_url(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme == "file":
        return "local file"
    if parsed.netloc:
        return parsed.netloc.removeprefix("www.").lower()
    return None


def _compose_searchable_text(
    *,
    application: str,
    window_title: str,
    url: str | None,
    content_text: str | None,
    tab_titles: list[str] | None,
    tab_urls: list[str] | None,
) -> str:
    parts = [
        application or "",
        window_title or "",
        content_text or "",
        url or "",
        _domain_from_url(url) or "",
        " ".join(tab_titles or []),
        " ".join(tab_urls or []),
    ]
    return " ".join(part.strip() for part in parts if part and part.strip())


def _sync_event_fts(connection: sqlite3.Connection, event_id: int) -> None:
    row = connection.execute(
        """
        SELECT
            id,
            searchable_text,
            application,
            window_title,
            COALESCE(url, '') AS url,
            COALESCE(content_text, '') AS content_text
        FROM events
        WHERE id = ?
        """,
        (event_id,),
    ).fetchone()
    connection.execute("DELETE FROM events_fts WHERE rowid = ?", (event_id,))
    if row is None:
        return
    connection.execute(
        """
        INSERT INTO events_fts(rowid, event_id, searchable_text, application, window_title, url, content_text)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            row["id"],
            row["id"],
            row["searchable_text"],
            row["application"],
            row["window_title"],
            row["url"],
            row["content_text"],
        ),
    )


def _events_exist(connection: sqlite3.Connection) -> bool:
    row = connection.execute("SELECT COUNT(*) AS count FROM events").fetchone()
    return bool(row and int(row["count"]) > 0)


def _anchors_table_exists(connection: sqlite3.Connection) -> bool:
    row = connection.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'anchors'
        """
    ).fetchone()
    return row is not None


def _backfill_from_anchors(connection: sqlite3.Connection) -> None:
    if _events_exist(connection) or not _anchors_table_exists(connection):
        return
    rows = connection.execute(
        """
        SELECT
            id,
            COALESCE(session_start, timestamp) AS occurred_at,
            app_name,
            COALESCE(context_title, window_title, '') AS content_text,
            window_title,
            url,
            exe_path,
            tab_snapshot,
            tab_urls
        FROM anchors
        ORDER BY COALESCE(session_start, timestamp) ASC, id ASC
        """
    ).fetchall()
    for row in rows:
        tab_titles = _decode_json_list(row["tab_snapshot"])
        tab_urls = _decode_json_list(row["tab_urls"])
        searchable_text = _compose_searchable_text(
            application=row["app_name"],
            window_title=row["window_title"],
            url=row["url"],
            content_text=row["content_text"],
            tab_titles=tab_titles,
            tab_urls=tab_urls,
        )
        embedding_json = json.dumps(embed_text(searchable_text), ensure_ascii=True)
        cursor = connection.execute(
            """
            INSERT INTO events (
                occurred_at,
                application,
                window_title,
                url,
                interaction_type,
                content_text,
                exe_path,
                tab_titles_json,
                tab_urls_json,
                searchable_text,
                embedding_json,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["occurred_at"],
                row["app_name"],
                row["window_title"],
                row["url"],
                "legacy_import",
                row["content_text"],
                row["exe_path"],
                _encode_json_list(tab_titles),
                _encode_json_list(tab_urls),
                searchable_text,
                embedding_json,
                "legacy",
            ),
        )
        _sync_event_fts(connection, int(cursor.lastrowid))


def init_db() -> None:
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                occurred_at TEXT NOT NULL,
                application TEXT NOT NULL,
                window_title TEXT NOT NULL,
                url TEXT,
                interaction_type TEXT NOT NULL,
                content_text TEXT,
                exe_path TEXT,
                tab_titles_json TEXT,
                tab_urls_json TEXT,
                searchable_text TEXT NOT NULL,
                embedding_json TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'monitor'
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_events_occurred_at
            ON events(occurred_at DESC)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_events_application
            ON events(application)
            """
        )
        connection.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
            USING fts5(
                event_id UNINDEXED,
                searchable_text,
                application,
                window_title,
                url,
                content_text
            )
            """
        )
        _backfill_from_anchors(connection)
        fts_count = int(
            connection.execute("SELECT COUNT(*) AS count FROM events_fts").fetchone()["count"]
        )
        event_count = int(
            connection.execute("SELECT COUNT(*) AS count FROM events").fetchone()["count"]
        )
        if fts_count != event_count:
            connection.execute("DELETE FROM events_fts")
            rows = connection.execute("SELECT id FROM events").fetchall()
            for row in rows:
                _sync_event_fts(connection, int(row["id"]))
        connection.commit()


def append_event(
    *,
    application: str,
    window_title: str,
    url: str | None = None,
    interaction_type: str = "focus",
    content_text: str | None = None,
    exe_path: str | None = None,
    tab_titles: list[str] | None = None,
    tab_urls: list[str] | None = None,
    occurred_at: str | None = None,
    source: str = "monitor",
) -> int:
    timestamp = occurred_at or datetime.now().isoformat(sep=" ", timespec="seconds")
    searchable_text = _compose_searchable_text(
        application=application,
        window_title=window_title,
        url=url,
        content_text=content_text,
        tab_titles=tab_titles,
        tab_urls=tab_urls,
    )
    embedding_json = json.dumps(embed_text(searchable_text), ensure_ascii=True)
    tab_titles_json = _encode_json_list(tab_titles)
    tab_urls_json = _encode_json_list(tab_urls)
    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO events (
                occurred_at,
                application,
                window_title,
                url,
                interaction_type,
                content_text,
                exe_path,
                tab_titles_json,
                tab_urls_json,
                searchable_text,
                embedding_json,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                timestamp,
                application,
                window_title,
                url,
                interaction_type,
                content_text,
                exe_path,
                tab_titles_json,
                tab_urls_json,
                searchable_text,
                embedding_json,
                source,
            ),
        )
        event_id = int(cursor.lastrowid)
        _sync_event_fts(connection, event_id)
        connection.commit()
    try:
        from core.vector_store import upsert_events

        event = Event(
            id=event_id,
            occurred_at=timestamp,
            application=application,
            window_title=window_title,
            url=url,
            interaction_type=interaction_type,
            content_text=content_text,
            exe_path=exe_path,
            tab_titles_json=tab_titles_json,
            tab_urls_json=tab_urls_json,
            searchable_text=searchable_text,
            embedding_json=embedding_json,
            source=source,
        )
        upsert_events([event])
    except Exception:
        pass
    return event_id


def list_events_by_ids(ids: list[int]) -> list[Event]:
    if not ids:
        return []
    placeholders = ", ".join("?" for _ in ids)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                id,
                occurred_at,
                application,
                window_title,
                url,
                interaction_type,
                content_text,
                exe_path,
                tab_titles_json,
                tab_urls_json,
                searchable_text,
                embedding_json,
                source
            FROM events
            WHERE id IN ({placeholders})
            """,
            tuple(ids),
        ).fetchall()
    by_id = {int(row["id"]): Event(**dict(row)) for row in rows}
    return [by_id[event_id] for event_id in ids if event_id in by_id]


def list_recent_events(limit: int = 400) -> list[Event]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                id,
                occurred_at,
                application,
                window_title,
                url,
                interaction_type,
                content_text,
                exe_path,
                tab_titles_json,
                tab_urls_json,
                searchable_text,
                embedding_json,
                source
            FROM events
            ORDER BY occurred_at DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [Event(**dict(row)) for row in rows]


def list_events_between(
    start_at: str | None,
    end_at: str | None,
    *,
    limit: int = 1200,
) -> list[Event]:
    clauses: list[str] = []
    params: list[object] = []
    if start_at is not None:
        clauses.append("occurred_at >= ?")
        params.append(start_at)
    if end_at is not None:
        clauses.append("occurred_at <= ?")
        params.append(end_at)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                id,
                occurred_at,
                application,
                window_title,
                url,
                interaction_type,
                content_text,
                exe_path,
                tab_titles_json,
                tab_urls_json,
                searchable_text,
                embedding_json,
                source
            FROM events
            {where}
            ORDER BY occurred_at DESC, id DESC
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()
    return [Event(**dict(row)) for row in rows]


def list_events_batch(*, offset: int = 0, limit: int = 1000) -> list[Event]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                id,
                occurred_at,
                application,
                window_title,
                url,
                interaction_type,
                content_text,
                exe_path,
                tab_titles_json,
                tab_urls_json,
                searchable_text,
                embedding_json,
                source
            FROM events
            ORDER BY occurred_at ASC, id ASC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()
    return [Event(**dict(row)) for row in rows]


def list_events_around(
    occurred_at: str,
    *,
    before_limit: int = 6,
    after_limit: int = 6,
) -> tuple[list[Event], list[Event]]:
    with get_connection() as connection:
        before_rows = connection.execute(
            """
            SELECT
                id,
                occurred_at,
                application,
                window_title,
                url,
                interaction_type,
                content_text,
                exe_path,
                tab_titles_json,
                tab_urls_json,
                searchable_text,
                embedding_json,
                source
            FROM events
            WHERE occurred_at < ?
            ORDER BY occurred_at DESC, id DESC
            LIMIT ?
            """,
            (occurred_at, before_limit),
        ).fetchall()
        after_rows = connection.execute(
            """
            SELECT
                id,
                occurred_at,
                application,
                window_title,
                url,
                interaction_type,
                content_text,
                exe_path,
                tab_titles_json,
                tab_urls_json,
                searchable_text,
                embedding_json,
                source
            FROM events
            WHERE occurred_at > ?
            ORDER BY occurred_at ASC, id ASC
            LIMIT ?
            """,
            (occurred_at, after_limit),
        ).fetchall()
    before_events = [Event(**dict(row)) for row in reversed(before_rows)]
    after_events = [Event(**dict(row)) for row in after_rows]
    return before_events, after_events


def lexical_candidates(
    query: str,
    *,
    start_at: str | None = None,
    end_at: str | None = None,
    limit: int = 80,
) -> list[Event]:
    normalized = "".join(ch if ch.isalnum() else " " for ch in query)
    tokens = [token.strip() for token in normalized.split() if token.strip()]
    if not tokens:
        return list_recent_events(limit=limit)
    match_query = " ".join(f"{token}*" for token in tokens)
    clauses = ["events_fts MATCH ?"]
    params: list[object] = [match_query]
    if start_at is not None:
        clauses.append("e.occurred_at >= ?")
        params.append(start_at)
    if end_at is not None:
        clauses.append("e.occurred_at <= ?")
        params.append(end_at)
    params.append(limit)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                e.id,
                e.occurred_at,
                e.application,
                e.window_title,
                e.url,
                e.interaction_type,
                e.content_text,
                e.exe_path,
                e.tab_titles_json,
                e.tab_urls_json,
                e.searchable_text,
                e.embedding_json,
                e.source
            FROM events_fts
            INNER JOIN events e ON e.id = events_fts.rowid
            WHERE {' AND '.join(clauses)}
            ORDER BY bm25(events_fts), e.occurred_at DESC
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()
    return [Event(**dict(row)) for row in rows]


def clear_memory() -> None:
    with get_connection() as connection:
        connection.execute("DELETE FROM events_fts")
        connection.execute("DELETE FROM events")
        connection.commit()


def save_anchor(
    *,
    app_name: str,
    window_title: str,
    context_title: str | None = None,
    url: str | None = None,
    tab_snapshot: list[str] | None = None,
    tab_urls: list[str] | None = None,
    scroll_position: str | None = None,
    exe_path: str | None = None,
) -> bool:
    del scroll_position
    append_event(
        application=app_name,
        window_title=window_title,
        url=url,
        interaction_type="legacy_focus",
        content_text=context_title,
        exe_path=exe_path,
        tab_titles=tab_snapshot,
        tab_urls=tab_urls,
        source="legacy",
    )
    return True


def extend_latest_session(
    *,
    app_name: str,
    window_title: str,
    context_title: str | None = None,
    url: str | None = None,
    tab_snapshot: list[str] | None = None,
    tab_urls: list[str] | None = None,
    scroll_position: str | None = None,
    exe_path: str | None = None,
) -> bool:
    del scroll_position
    append_event(
        application=app_name,
        window_title=window_title,
        url=url,
        interaction_type="legacy_heartbeat",
        content_text=context_title,
        exe_path=exe_path,
        tab_titles=tab_snapshot,
        tab_urls=tab_urls,
        source="legacy",
    )
    return True
