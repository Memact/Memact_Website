# Memact Website

Version: `v0.0`

Website is now the Memact Access portal.

It owns one job:

```text
let a developer or user sign in, register an app, grant permissions, and create API keys
```

Website does not capture activity and does not read memory graphs. It talks to
Access, which protects the permission boundary.

The old demo/query website has been archived outside this repo at:

```text
../oldwebsite
```

## Flow

```text
Website -> Access -> scoped API key -> Capture / Inference / Schema / Memory
```

Apps use Memact to capture allowed activity and form schemas. Apps do not get a
blanket dump of a user's private graph.

## Run Locally

Start Access first:

```powershell
cd ../Access
npm install
npm run dev
```

Start Website:

```powershell
cd ../interface
npm install
npm run dev
```

Open:

```text
http://localhost:3000/
```

Build:

```powershell
npm run build
```

## Configuration

Create `.env`:

```text
VITE_MEMACT_ACCESS_URL=http://127.0.0.1:8787
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
# Optional override for non-standard deploy domains. Defaults to the current origin.
# VITE_AUTH_REDIRECT_URL=http://localhost:3000/dashboard
```

Only use the Supabase anon key in the Website. Never put a service role key or
GitHub OAuth client secret in frontend code.

In Supabase Auth URL settings, allow:

```text
http://localhost:3000/dashboard
https://memact.com/dashboard
```

In Supabase GitHub provider settings, connect the GitHub OAuth App there. The
GitHub OAuth client secret belongs in Supabase, not this repo.

For Render, set:

```text
VITE_MEMACT_ACCESS_URL=https://memact-access.onrender.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
# Optional: VITE_AUTH_REDIRECT_URL=https://memact.com/dashboard
```

Change the URL if the Access service uses a custom domain.

## Render and SEO

`render.yaml` deploys Website as a Render static site and points it at the
Access service URL above. The site includes:

- canonical URL for `https://www.memact.com/`
- `robots.txt`
- `sitemap.xml`
- Open Graph and Twitter preview tags
- JSON-LD for the web app
- mobile viewport and PWA manifest basics

## Current Policy

- Free unlimited access for now.
- API keys are shown once.
- App names are unique per account.
- Deleting an app revokes its active API keys and permissions.
- Scopes and saved permissions are required before apps can use Memact.
- Graph read access is separate from capture/schema write access.

## App Embed Shape

After creating an API key, Website shows a ready-to-copy embed snippet and a
`Test key` button. The code shape is:

```js
import { createMemactCaptureClient } from "./memact-capture-client.mjs";

const memact = createMemactCaptureClient({
  accessUrl: "https://memact-access.onrender.com",
  apiKey: "mka_key_shown_once"
});

const { snapshot } = await memact.getLocalSnapshot({
  scopes: ["capture:webpage", "schema:write", "graph:write", "memory:write", "memory:read_summary"]
});

console.log(snapshot.counts);
```

The API key is verified by Access before the app can read from the local
Capture bridge.

## License

See `LICENSE`.
