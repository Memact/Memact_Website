import React, { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import {
  AccessClient,
  ACCESS_URL,
  getSessionToken,
  setSessionToken
} from "./memact-access-client.js"

const DEFAULT_SCOPES = [
  "capture:webpage",
  "schema:write",
  "graph:write",
  "memory:write",
  "memory:read_summary"
]

function App() {
  const client = useMemo(() => new AccessClient(ACCESS_URL), [])
  const [mode, setMode] = useState("signin")
  const [session, setSession] = useState(getSessionToken())
  const [user, setUser] = useState(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState("Checking Access.")
  const [error, setError] = useState("")
  const [policy, setPolicy] = useState(null)
  const [apps, setApps] = useState([])
  const [apiKeys, setApiKeys] = useState([])
  const [consents, setConsents] = useState([])
  const [newAppName, setNewAppName] = useState("My Memact App")
  const [newAppDescription, setNewAppDescription] = useState("Uses Memact to form useful schema memory.")
  const [selectedAppId, setSelectedAppId] = useState("")
  const [selectedScopes, setSelectedScopes] = useState(DEFAULT_SCOPES)
  const [oneTimeKey, setOneTimeKey] = useState("")

  useEffect(() => {
    client.health()
      .then(() => setStatus("Access is online."))
      .catch(() => setStatus("Start Access locally to use the portal."))
    client.policy().then(setPolicy).catch(() => {})
  }, [client])

  useEffect(() => {
    if (!session) return
    refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError)
  }, [client, session])

  useEffect(() => {
    if (!selectedAppId && apps[0]?.id) {
      setSelectedAppId(apps[0].id)
    }
  }, [apps, selectedAppId])

  async function handleAuth(event) {
    event.preventDefault()
    setError("")
    setStatus(mode === "signup" ? "Creating account." : "Signing in.")
    try {
      const result = mode === "signup"
        ? await client.signup({ email, password })
        : await client.signin({ email, password })
      setSessionToken(result.session.token)
      setSession(result.session.token)
      setUser(result.user)
      setPassword("")
      setStatus("Signed in.")
    } catch (authError) {
      setError(authError.message)
      setStatus("Access needs attention.")
    }
  }

  async function handleCreateApp(event) {
    event.preventDefault()
    setError("")
    try {
      await client.createApp(session, {
        name: newAppName,
        description: newAppDescription
      })
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError)
      setStatus("App registered.")
    } catch (appError) {
      setError(appError.message)
    }
  }

  async function handleGrantConsent() {
    setError("")
    try {
      await client.grantConsent(session, { app_id: selectedAppId, scopes: selectedScopes })
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError)
      setStatus("Consent saved.")
    } catch (consentError) {
      setError(consentError.message)
    }
  }

  async function handleCreateKey() {
    setError("")
    setOneTimeKey("")
    try {
      const result = await client.createApiKey(session, {
        app_id: selectedAppId,
        name: "Default app key",
        scopes: selectedScopes
      })
      setOneTimeKey(result.key)
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError)
      setStatus("API key created. Copy it now.")
    } catch (keyError) {
      setError(keyError.message)
    }
  }

  async function handleRevokeKey(keyId) {
    setError("")
    try {
      await client.revokeApiKey(session, keyId)
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError)
      setStatus("API key revoked.")
    } catch (keyError) {
      setError(keyError.message)
    }
  }

  function signOut() {
    setSessionToken("")
    setSession("")
    setUser(null)
    setApps([])
    setApiKeys([])
    setConsents([])
    setOneTimeKey("")
    setStatus("Signed out.")
  }

  const scopes = policy?.scopes || {}

  return (
    <main className="page">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Memact home">Memact</a>
        <span className="status-pill">{status}</span>
      </header>

      <section className="hero">
        <p className="eyebrow">Access layer</p>
        <h1>API keys for private schema infrastructure.</h1>
        <p>
          Register apps, grant consent, and let Memact capture allowed activity
          to form nodes, edges, and schema packets. Apps do not receive a raw
          memory dump.
        </p>
      </section>

      {error ? <p className="error" role="alert">{error}</p> : null}

      {!session ? (
        <section className="panel auth-panel">
          <div>
            <p className="eyebrow">{mode === "signup" ? "Create account" : "Sign in"}</p>
            <h2>{mode === "signup" ? "Start with an email and password." : "Open your Access dashboard."}</h2>
            <p className="muted">
              Passwords are sent only to Access and stored there as hashes.
            </p>
          </div>
          <form className="form" onSubmit={handleAuth}>
            <label>
              Email
              <input value={email} type="email" autoComplete="email" onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              Password
              <input value={password} type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={10} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            <button type="submit">{mode === "signup" ? "Create account" : "Sign in"}</button>
            <button type="button" className="ghost" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
              {mode === "signup" ? "Already have an account?" : "Need an account?"}
            </button>
          </form>
        </section>
      ) : (
        <section className="dashboard">
          <div className="dashboard-head">
            <div>
              <p className="eyebrow">Signed in</p>
              <h2>{user?.email}</h2>
              <p className="muted">Plan: free unlimited for now.</p>
            </div>
            <button type="button" className="ghost" onClick={signOut}>Sign out</button>
          </div>

          <div className="grid">
            <section className="panel">
              <p className="eyebrow">Register app</p>
              <form className="form" onSubmit={handleCreateApp}>
                <label>
                  App name
                  <input value={newAppName} onChange={(event) => setNewAppName(event.target.value)} required />
                </label>
                <label>
                  Purpose
                  <textarea value={newAppDescription} onChange={(event) => setNewAppDescription(event.target.value)} />
                </label>
                <button type="submit">Register app</button>
              </form>
            </section>

            <section className="panel">
              <p className="eyebrow">Apps</p>
              {apps.length ? (
                <div className="stack">
                  {apps.map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      className={`app-card ${selectedAppId === app.id ? "is-active" : ""}`}
                      onClick={() => setSelectedAppId(app.id)}
                    >
                      <strong>{app.name}</strong>
                      <span>{app.description || "No description"}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">No apps yet.</p>
              )}
            </section>
          </div>

          <section className="panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Scopes</p>
                <h2>Choose what this app can ask Memact to do.</h2>
              </div>
              <div className="actions">
                <button type="button" className="ghost" disabled={!selectedAppId} onClick={handleGrantConsent}>Save consent</button>
                <button type="button" disabled={!selectedAppId} onClick={handleCreateKey}>Create API key</button>
              </div>
            </div>
            <div className="scope-grid">
              {Object.entries(scopes).map(([scope, definition]) => (
                <label key={scope} className="scope-card">
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope)}
                    onChange={() => {
                      setSelectedScopes((current) => current.includes(scope)
                        ? current.filter((item) => item !== scope)
                        : [...current, scope])
                    }}
                  />
                  <span>
                    <strong>{scope}</strong>
                    <small>{definition.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {oneTimeKey ? (
            <section className="panel key-panel">
              <p className="eyebrow">Copy now</p>
              <h2>One-time API key</h2>
              <code>{oneTimeKey}</code>
              <p className="muted">Memact stores only a hash of this key. It cannot be shown again.</p>
            </section>
          ) : null}

          <div className="grid">
            <section className="panel">
              <p className="eyebrow">API keys</p>
              <div className="stack">
                {apiKeys.length ? apiKeys.map((key) => (
                  <div className="list-card" key={key.id}>
                    <span>
                      <strong>{key.name}</strong>
                      <small>{key.key_prefix}... · {key.revoked_at ? "revoked" : "active"}</small>
                    </span>
                    {!key.revoked_at ? <button type="button" className="ghost" onClick={() => handleRevokeKey(key.id)}>Revoke</button> : null}
                  </div>
                )) : <p className="muted">No API keys yet.</p>}
              </div>
            </section>

            <section className="panel">
              <p className="eyebrow">Consent</p>
              <div className="stack">
                {consents.length ? consents.map((consent) => (
                  <div className="list-card" key={consent.id}>
                    <span>
                      <strong>{apps.find((app) => app.id === consent.app_id)?.name || consent.app_id}</strong>
                      <small>{consent.scopes.join(", ")}</small>
                    </span>
                  </div>
                )) : <p className="muted">No consent saved yet.</p>}
              </div>
            </section>
          </div>
        </section>
      )}
    </main>
  )
}

async function refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError) {
  try {
    const [me, appResult, keyResult, consentResult] = await Promise.all([
      client.me(session),
      client.apps(session),
      client.apiKeys(session),
      client.consents(session)
    ])
    setUser(me.user)
    setApps(appResult.apps)
    setApiKeys(keyResult.api_keys)
    setConsents(consentResult.consents)
    setStatus("Dashboard synced.")
  } catch (error) {
    setError(error.message)
    setStatus("Could not sync dashboard.")
  }
}

createRoot(document.getElementById("root")).render(<App />)
