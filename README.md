# Memact

Memact is a private desktop memory engine for personal actions.

It continuously records local action events on your Windows machine, builds a local semantic memory index, and lets you ask natural-language questions such as:

- What did I do yesterday evening?
- When did I last use Chrome?
- How much time did I spend on youtube.com today?
- Did I look at the grocery order?

Memact is designed around one interaction:

`Ask Memact...`

## Product principles

- local only
- no cloud services
- no external APIs
- no remote LLM calls
- append-only event history
- semantic search over actions, not dashboards

## Architecture

The current product flow is:

```text
event capture
-> event store
-> local semantic embeddings
-> semantic + lexical retrieval
-> query engine
-> answer + supporting evidence
```

### Event capture

Memact records raw action events such as:

- timestamp
- application
- window title
- URL when available
- interaction type
- captured content text when available
- browser tab titles and URLs when the local extension is enabled

Events are appended to the local database and are not auto-mutated into sessions or groups.

### Local memory engine

The query engine uses local embeddings plus lexical retrieval to interpret open-ended questions.

- If a local transformer model is available, Memact uses it
- If not, Memact falls back to a deterministic local embedding path so the app remains private and functional

## Interface

The desktop app intentionally stays minimal:

- `memact` wordmark
- one large centered search field
- dynamic suggestions from recent activity
- one clear answer
- optional supporting details
- top-right menu for setup and privacy actions

## Browser extension

Memact includes a local extension in [extension/memact](C:\Users\sujay\Downloads\memact\extension\memact) for Chromium-based browsers.

When enabled, it sends the current window's tab data to the local Memact bridge at `http://127.0.0.1:38453`.

No browser data is sent off-device.

## Storage

The local SQLite database lives at:

`%USERPROFILE%\AppData\Local\memact\memact.db`

## Dependencies

- Python 3.11+
- PyQt6
- pywinauto
- sentence-transformers

Install with:

```powershell
pip install -r requirements.txt
```

## Run

```powershell
python main.py
```

## Notes

- This is a Windows-first prototype.
- The semantic engine is fully local.
- Exact app restoration is no longer the main product promise; Memact is focused on remembering and answering questions about actions.
