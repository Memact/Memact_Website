# Memact

Version: `MVP v1.5`

Memact is the product layer on top of Captanet and Influnet.

It is the interface where users search their memory stream, inspect evidence, and eventually understand how digital exposure shaped their attention over time.

## Product Stack

- `Captanet`
  The foundation memory engine. It captures browser activity, extracts context, filters noise, builds sessions and activities, and exports structured snapshots.
- `Influnet`
  The deterministic influence engine. It reads Captanet snapshots and surfaces repeated transitions, trajectories, source evidence, drift, and formation signals.
- `Memact`
  The product shell. It turns those underlying systems into a user-facing experience with search, evidence cards, setup flows, and local web fallback support.

In short:

- Captanet answers: `What happened?`
- Influnet answers: `What tended to lead to what?`
- Memact answers: `How does the user actually experience and inspect that memory?`

## What This Repo Is

This repository is the Memact website and interaction layer.

It is intentionally separate from the new foundation repos:

- Captanet repo: [https://github.com/Memact/Captanet](https://github.com/Memact/Captanet)
- Influnet repo: [https://github.com/Memact/Influnet](https://github.com/Memact/Influnet)

This repo still contains a website-facing extension bundle for local integration and packaging, but the architectural source of truth for the memory and influence layers now lives in those dedicated repositories.

## What Memact Does

- presents a local-first search interface over captured memory
- shows evidence-backed result cards instead of opaque chatbot answers
- supports local browser-extension integration on desktop
- supports local web fallback behavior on unsupported/mobile environments
- explains the Captanet -> Influnet story more clearly in the product shell
- keeps the visible experience useful even when the lower layers stay deterministic and evidence-first

## Current Experience

### Home Layer

- explains the product as memory infrastructure for the internet
- introduces Captanet, Influnet, and Memact as separate layers
- frames the demo flow so a pitch audience can understand the stack quickly

### Search Layer

- structured result cards
- key points, matched passages, facts, and connected activity
- result history and local suggestions
- privacy and setup dialogs

### Setup Layer

- browser-aware extension setup guidance
- local-first messaging
- extension-required vs web-fallback modes

## Relationship To Captanet And Influnet

Memact should consume the lower layers cleanly rather than re-owning their internals.

Recommended direction:

1. Captanet captures and exports a snapshot.
2. Influnet analyzes that snapshot into transitions, trajectories, and formation signals.
3. Memact renders those outputs in a way users can inspect, search, and trust.

That dependency direction matters:

- Memact can depend on Captanet and Influnet
- Captanet must not depend on Memact
- Influnet should analyze Captanet outputs, not website internals

## Local Runbook

Prerequisites:

- Node.js `20+`
- npm `10+`

Install:

```powershell
npm install
```

Run the local website:

```powershell
npm run dev
```

Build the production website:

```powershell
npm run build
```

Package the website-facing extension bundle:

```powershell
npm run package-extension
```

## Manual Extension Flow

1. Open `edge://extensions`, `chrome://extensions`, `brave://extensions`, `opera://extensions`, or `vivaldi://extensions`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select the folder that directly contains `manifest.json`
5. Reload the Memact website

## Suggested Demo Flow

For a live demo:

1. Run Captanet and let it collect real browsing activity.
2. Export a Captanet snapshot into the shared workspace root.
3. Run Influnet in the terminal to generate report, graph, and pitch artifacts.
4. Use Memact to show the search and evidence layer that sits on top of that stack.

That sequence makes the system feel real:

- capture
- structure
- influence analysis
- user-facing inspection

## Repo Layout

- `src/`
  Website UI and interaction layer.
- `extension/memact/`
  Website-facing extension bundle used for local setup and packaging in this repo.
- `public/`
  Static website assets.
- `assets/`
  Fonts and visual assets.
- `memact_branding/`
  Logos and brand files.
- `scripts/`
  Packaging and local setup helpers.

## Status

This repository is `MVP v1.5`.

It is product-facing, demoable, and locally runnable. The long-term system architecture now lives more cleanly across:

- Memact for interface and product experience
- Captanet for memory capture and structure
- Influnet for deterministic influence analysis

## License

See `LICENSE`.
