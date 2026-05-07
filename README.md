# Memact Website

Version: `v0.0`

Website is now the Memact Access portal.

It owns one job:

```text
let a developer or user sign in, register an app, grant permissions, and create API keys
```

Website does not capture activity and does not read memory graphs. It talks to
the Access layer inside Supabase, which protects the permission boundary.

The old demo/query website has been archived outside this repo at:

```text
../oldwebsite
```

## Flow

```text
Website -> Supabase Access layer -> scoped API key -> Capture / Inference / Schema / Memory
```

Apps use Memact to capture allowed activity and form schemas. Apps do not get a
blanket dump of a user's private graph.

## Run Locally

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
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
# Optional override for non-standard deploy domains. Defaults to the current origin.
# VITE_AUTH_REDIRECT_URL=http://localhost:3000/dashboard
```

Only use the Supabase anon key in the Website. Never put a service role key,
GitHub OAuth client secret, or private database secret in frontend code.

Before the portal works, apply the Access SQL migration from:

```text
../Access/supabase/migrations/20260507120000_memact_access.sql
```

In Supabase Auth URL settings, allow:

```text
http://localhost:3000/dashboard
https://memact.com/dashboard
```

In Supabase GitHub provider settings, connect the GitHub OAuth App there. The
GitHub OAuth client secret belongs in Supabase, not this repo.

For Render, set:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
# Optional: VITE_AUTH_REDIRECT_URL=https://memact.com/dashboard
```

## Render and SEO

`render.yaml` deploys Website as a Render static site. The site includes:

- canonical URL for `https://www.memact.com/`
- `robots.txt`
- `sitemap.xml`
- Open Graph and Twitter preview tags
- JSON-LD for the web app
- mobile viewport and PWA manifest basics

If Blueprint setup fails, use the direct Dashboard path in
[`RENDER_DIRECT_DEPLOY.md`](./RENDER_DIRECT_DEPLOY.md).

## Current Policy

- Free unlimited access for now.
- API keys are shown once.
- App names are unique per account.
- Deleting an app revokes its active API keys and permissions.
- Scopes and saved permissions are required before apps can use Memact.
- Graph read access is separate from capture/schema write access.
- Supabase is the primary Access backend. The old HTTP Access service is only a fallback for local development.

## App Embed Shape

After creating an API key, Website shows a ready-to-copy embed snippet and a
`Test key` button. App developers do not create their own Supabase project for
Memact access; the snippet uses Memact's public Access endpoint and the scoped
API key created in this portal.

The code shape is:

```js
const MEMACT_ACCESS_URL = "shown-in-the-memact-portal";
const MEMACT_PUBLIC_KEY = "shown-in-the-memact-portal";
const memactApiKey = "mka_key_shown_once";

const response = await fetch(`${MEMACT_ACCESS_URL}/rest/v1/rpc/memact_verify_api_key`, {
  method: "POST",
  headers: {
    apikey: MEMACT_PUBLIC_KEY,
    Authorization: `Bearer ${MEMACT_PUBLIC_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    api_key_input: memactApiKey,
    required_scopes_input: ["capture:webpage", "schema:write"]
  })
});

const access = await response.json();

if (!access?.allowed) throw new Error(access?.error?.message || "Memact access denied.");

console.log("Memact access granted", access.scopes);
```

The API key is verified by Memact before an app can use allowed capture,
schema, graph, or memory permissions. The app receives only the scopes the user
saved for that app.

## License

See `LICENSE`.
