# Render Direct Deploy

Use this if Render Blueprint setup fails.

This keeps Website as a Render Static Site on Render's CDN. It is not a downgrade from the Blueprint path.

## 1. Create The Static Site

In Render:

```text
New -> Static Site
Repository: https://github.com/Memact/Website
Branch: main
Name: memact-website
Build Command: npm ci && npm run build
Publish Directory: dist
```

## 2. Environment Variables

Add:

```text
VITE_SUPABASE_URL=<your Supabase project URL>
VITE_SUPABASE_ANON_KEY=<your Supabase anon key>
VITE_AUTH_REDIRECT_URL=https://memact.com/dashboard
```

## 3. Rewrite Rule

In the Static Site settings, add:

```text
Action: Rewrite
Source: /*
Destination: /index.html
```

This keeps `/dashboard` working after refresh.

## 4. Headers

Add these headers in the Static Site settings.

For path `/*`:

```text
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

For path `/assets/*`:

```text
Cache-Control: public, max-age=31536000, immutable
```

For path `/logo.png`:

```text
Cache-Control: public, max-age=86400
```

For path `/index.html`:

```text
Cache-Control: public, max-age=0, must-revalidate
```

## 5. Domains

Add both custom domains:

```text
memact.com
www.memact.com
```

Then copy the DNS records Render gives you into your domain provider.

## 6. Supabase Redirects

In Supabase Auth URL settings, allow:

```text
http://localhost:3000/dashboard
https://memact.com/dashboard
https://www.memact.com/dashboard
https://memact-website.onrender.com/dashboard
```

If Render gives the Website a different `.onrender.com` URL, add that exact dashboard URL too.

Before testing the portal, apply the Access SQL migration from:

```text
../Access/supabase/migrations/20260507120000_memact_access.sql
```

That migration turns Supabase into the Access backend, so Website no longer
needs a separate hosted Access service.

For GitHub OAuth, the GitHub callback URL belongs to Supabase:

```text
https://<your-project>.supabase.co/auth/v1/callback
```

## 7. Verify

Open:

```text
https://memact.com
https://memact.com/dashboard
```

Both should load the Website. Login should redirect back to `/dashboard`.
