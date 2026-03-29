# Memact MVP v1.1

Memact is a local-first memory engine for browsing activity.

The product has two parts:

- the website at `https://www.memact.com`
- an optional Chromium extension that captures browsing activity locally and makes it searchable from the site

Memact is intentionally experimental. The current goal is useful local recall, structured answers, and honest evidence before mass-market polish.

## What Memact Does

- Captures browser memories locally through the desktop extension
- Lets the website search those memories with structured, evidence-backed results
- Supports phone browsers in local web mode
- Tries to skip junk, shell pages, and low-value captures
- Builds relationships between events with an Episodic Graph
- Applies selective memory so stronger memories are kept and weaker ones are compressed or demoted
- Handles PDFs, math-heavy content, chemistry notation, and symbol-heavy text better than a plain snippet search UI
- Shows key points, matched passages, facts, and optionally the full extracted memory

## Current Product Shape

### Website

- React + Vite website
- Hosted at `https://www.memact.com`
- Works on desktop and phone browsers
- Search-first UI with structured result cards
- Memory detail dialog with:
  - key points
  - matched passages
  - facts
  - connected activity
  - optional full extracted text
  - optional raw captured text
  - copy points action

### Desktop Extension

- Chromium-based extension for Edge, Chrome, Brave, Vivaldi, and similar browsers
- Captures browsing activity locally
- Uses local storage and local search indexes
- Opens `https://www.memact.com` when the toolbar icon is clicked
- Can be installed manually through the website setup flow

### Phone Mode

- Runs as a local web shell
- Supports local search UI and local storage fallback
- Does not do desktop-style automatic cross-browser capture
- Exists so the product stays usable on phones while stronger mobile capture paths are still future work

## Major Features

### Structured Answers

Memact does not just dump raw snippets.

Search answers are built from structured memory data:

- overview
- direct answer
- summary
- facts
- key points
- matched passages
- connected activity

The retrieval engine stays the source of truth. The language layer only reshapes already-found facts into cleaner answer cards.

### Selective Memory

Memact assigns a memory action and tier to captures so everything is not treated equally.

Possible actions:

- `retain`
- `compress`
- `demote`
- `skip`

Possible tiers:

- `core`
- `supporting`
- `background`
- `fleeting`

This helps Memact:

- keep strong memories richer
- reduce clutter from weak captures
- avoid low-value memories polluting suggestions
- weight search results by memory importance

### Episodic Graph

Memact connects events to other events with typed relationships and scores.

Examples:

- search result -> opened page
- docs page -> follow-up action
- reading -> coding
- same topic
- same entity
- same session continuation

Each relationship can carry:

- a type
- a score
- a reason

This helps answer:

- what led to this?
- what happened after this?
- what else was connected to this?

### PDF, Math, Chemistry, and Symbol Support

Memact now handles technical content better than a plain browser-history search tool.

Current support includes:

- PDF extraction with `pdf.js`
- KaTeX rendering
- MathJax fallback
- `mhchem` support for chemistry notation
- better symbol font fallbacks for Greek, physics, and mathematical text

This is especially useful for:

- lecture notes
- exam prep PDFs
- formulas
- chemistry equations
- symbol-heavy docs

### Faster Local Search

Memact uses local indexing and caching so search feels more immediate.

Current speed layers include:

- Dexie-backed local storage
- FlexSearch indexes for quick local lookup
- cached result reuse
- faster dynamic suggestions
- structured result-history restore on back navigation

## How Memact Works

1. The extension captures a page locally.
2. Memact extracts the page title, URL, snippet, full text, app, site, time, and session context.
3. Capture intent decides whether the page should be stored fully, stored structurally, kept as metadata only, or skipped.
4. Clutter audit scores the capture for noise, repetition, and low-value formatting.
5. Context extraction builds a structured page profile:
   - page type
   - subject
   - entities
   - topics
   - facts
   - summary
6. Selective memory assigns a tier, action, retention mode, and remember score.
7. Sessions group nearby related activity.
8. The Episodic Graph links strongly related events.
9. Query parsing and ranking search those memories using exact signals first and broader semantic support second.
10. The website renders a structured answer card plus direct supporting evidence.

## Retrieval Model

Memact is not a free-form chatbot.

It uses a local retrieval pipeline that combines:

- exact field matching
- metadata filters
- local embeddings
- reranking
- session support
- selective memory weighting
- episodic graph support
- derivative passages for better evidence display

The current system is designed to feel AI-like in presentation while staying deterministic in retrieval.

## Local Model Layer

Memact includes an optional lightweight local language layer for answer shaping.

Current model path:

- `@xenova/transformers`
- `HuggingFaceTB/SmolLM2-135M-Instruct`

This layer is used to:

- structure visible answer fields more cleanly
- polish wording for supported environments

It is not used to:

- decide the true match
- invent facts
- replace evidence

## Tech Stack

- React
- Vite
- Manifest V3 browser extension
- IndexedDB
- Dexie
- FlexSearch
- `@xenova/transformers`
- SmolLM2 135M Instruct
- `pdfjs-dist`
- KaTeX
- MathJax
- `mhchem`

## Important Local Modules

- `extension/memact/background.js`
  - capture orchestration, storage flow, and extension messaging
- `extension/memact/context-pipeline.js`
  - structured page understanding and cleaned memory text
- `extension/memact/capture-intent.js`
  - decides what kind of page this is and what should be kept
- `extension/memact/clutter-audit.js`
  - scores noisy captures and trims or skips them
- `extension/memact/page-intelligence.js`
  - local usefulness judgement
- `extension/memact/selective-memory.js`
  - memory tiering, retention, and remember scoring
- `extension/memact/query-engine.js`
  - retrieval, reranking, sessions, episodic graph, and answer shaping
- `extension/memact/pdf-support.js`
  - PDF extraction support
- `extension/memact/search-index.js`
  - local fast index support
- `src/lib/webMemoryStore.js`
  - website fallback memory store with Dexie and local indexing
- `src/lib/localLanguageModel.js`
  - optional local structured-answer polish
- `src/components/MathRichText.jsx`
  - math, chemistry, and symbol-friendly rendering

## Privacy

- Local-first by default
- No cloud memory sync in the current product
- No remote AI dependency for retrieval
- No screenshot capture
- No keystroke logging

Memact may download local model files to the device for optional local answer structuring on supported browsers.

## Running Locally

Install dependencies:

```powershell
npm install
```

Start the dev server:

```powershell
npm run dev
```

Build the website:

```powershell
npm run build
```

Package the extension zip:

```powershell
npm run package-extension
```

## Loading The Extension Manually

Use the website menu item `Install Browser Extension`.

That setup flow explains the unpacked install path inside Memact itself.

Manual flow:

1. Open `edge://extensions`, `chrome://extensions`, `brave://extensions`, `opera://extensions`, or `vivaldi://extensions`
2. Turn on Developer mode
3. Click `Load unpacked`
4. Select the extracted folder that directly contains `manifest.json`
5. Reload the Memact website

## Supported Hosts

The extension bridge currently supports:

- `http://localhost`
- `http://127.0.0.1`
- `http://0.0.0.0`
- `https://memact.com`
- `https://www.memact.com`

## Repo Layout

- `src/` - website UI
- `extension/memact/` - browser extension
- `public/` - static website assets
- `assets/` - fonts and visual assets
- `memact_branding/` - logos and brand files
- `scripts/` - packaging and setup helpers

## Status

This is `MVP v1.1`.

It is deployable and useful, but still experimental. Capture cleanliness, search precision, and memory organization are actively improving.

## License

See `LICENSE`.
