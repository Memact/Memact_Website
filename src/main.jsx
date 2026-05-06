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
  const [authMode, setAuthMode] = useState("signin")
  const [session, setSession] = useState(getSessionToken())
  const [activeTab, setActiveTab] = useState(getSessionToken() ? "api-keys" : "login")
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
      .then(() => setStatus("Memact is online."))
      .catch(() => setStatus("Start Memact locally to use the portal."))
    client.policy().then(setPolicy).catch(() => {})
  }, [client])

  useEffect(() => {
    const tabName = activeTab === "apps" ? "Apps" : activeTab === "api-keys" ? "API Keys" : "Login"
    document.title = `Memact | ${tabName}`
  }, [activeTab])

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
    setStatus(authMode === "signup" ? "Creating account." : "Signing in.")
    try {
      const result = authMode === "signup"
        ? await client.signup({ email, password })
        : await client.signin({ email, password })
      setSessionToken(result.session.token)
      setSession(result.session.token)
      setUser(result.user)
      setPassword("")
      setActiveTab("api-keys")
      setStatus(authMode === "signup" ? "Account created." : "Signed in.")
    } catch (authError) {
      setError(authError.message)
      setStatus(authStatusMessage(authError, authMode))
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

  async function copyOneTimeKey() {
    if (!oneTimeKey) return
    try {
      await navigator.clipboard.writeText(oneTimeKey)
      setStatus("API key copied.")
    } catch {
      setStatus("Copy failed. Select the key manually.")
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
    setActiveTab("login")
    setStatus("Signed out.")
  }

  const scopes = policy?.scopes || {}
  const showAuth = !session

  return (
    <main className="page">
      <header className="topbar">
        <a className="logo-link" href="https://www.memact.com/" aria-label="Go to memact.com">
          <img className="logo-img" src="/logo.png" alt="Memact" />
        </a>
        {session ? (
          <nav className="tabs" aria-label="Memact portal tabs">
            <button type="button" className={activeTab === "api-keys" ? "tab is-active" : "tab"} onClick={() => setActiveTab("api-keys")}>API Keys</button>
            <button type="button" className={activeTab === "apps" ? "tab is-active" : "tab"} onClick={() => setActiveTab("apps")}>Apps</button>
          </nav>
        ) : null}
        <span className="status-pill">{status}</span>
      </header>

      {error ? <p className="error" role="alert">{error}</p> : null}

      {session ? (
        <Dashboard
          activeTab={activeTab}
          user={user}
          apps={apps}
          apiKeys={apiKeys}
          consents={consents}
          scopes={scopes}
          selectedAppId={selectedAppId}
          selectedScopes={selectedScopes}
          newAppName={newAppName}
          newAppDescription={newAppDescription}
          oneTimeKey={oneTimeKey}
          setSelectedAppId={setSelectedAppId}
          setSelectedScopes={setSelectedScopes}
          setNewAppName={setNewAppName}
          setNewAppDescription={setNewAppDescription}
          onCreateApp={handleCreateApp}
          onGrantConsent={handleGrantConsent}
          onCreateKey={handleCreateKey}
          onRevokeKey={handleRevokeKey}
          onCopyKey={copyOneTimeKey}
          onSignOut={signOut}
        />
      ) : (
        <Landing
          showAuth={showAuth}
          authMode={authMode}
          email={email}
          password={password}
          setAuthMode={setAuthMode}
          setEmail={setEmail}
          setPassword={setPassword}
          onAuth={handleAuth}
        />
      )}
    </main>
  )
}

function Landing({ showAuth, authMode, email, password, setAuthMode, setEmail, setPassword, onAuth }) {
  return (
    <section className={showAuth ? "landing landing-with-auth" : "landing"}>
      <div className="hero-copy">
        <h1>Manage access to Memact.</h1>
        <p>
          Sign in, register apps, grant consent, and create scoped API keys.
          Apps can use Memact through clear permissions while your memory data
          stays protected by default.
        </p>
      </div>

      {showAuth ? (
        <section className="panel auth-panel" aria-label="Memact login">
          <p className="eyebrow">{authMode === "signup" ? "Create account" : "Login"}</p>
          <h2>{authMode === "signup" ? "Create account." : "Login."}</h2>
          <p className="muted">
            Passwords are sent to Memact only and stored as hashes. Raw passwords
            are never written to the database.
          </p>
          <form className="form" onSubmit={onAuth}>
            <label>
              Email
              <input value={email} type="email" inputMode="email" autoComplete="email" onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              Password
              <input value={password} type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} minLength={10} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            <button type="submit">{authMode === "signup" ? "Create account" : "Login"}</button>
            <button type="button" className="ghost" onClick={() => setAuthMode(authMode === "signup" ? "signin" : "signup")}>
              {authMode === "signup" ? "I already have an account" : "Create a new account"}
            </button>
          </form>
        </section>
      ) : null}
    </section>
  )
}

function Dashboard({
  activeTab,
  user,
  apps,
  apiKeys,
  consents,
  scopes,
  selectedAppId,
  selectedScopes,
  newAppName,
  newAppDescription,
  oneTimeKey,
  setSelectedAppId,
  setSelectedScopes,
  setNewAppName,
  setNewAppDescription,
  onCreateApp,
  onGrantConsent,
  onCreateKey,
  onRevokeKey,
  onCopyKey,
  onSignOut
}) {
  return (
    <section className="dashboard">
      <div className="dashboard-head panel slim-panel">
        <div>
          <p className="eyebrow">{activeTab === "apps" ? "Apps" : "API keys"}</p>
          <h2>{user?.email}</h2>
          <p className="muted">Free unlimited while Memact is early.</p>
        </div>
        <button type="button" className="ghost" onClick={onSignOut}>Sign out</button>
      </div>

      {activeTab === "apps" ? (
        <div className="grid">
          <section className="panel">
            <p className="eyebrow">Register app</p>
            <form className="form" onSubmit={onCreateApp}>
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

          <AppList apps={apps} selectedAppId={selectedAppId} setSelectedAppId={setSelectedAppId} />
        </div>
      ) : (
        <div className="grid">
          <section className="panel">
            <div className="section-head">
              <div className="section-copy">
                <p className="eyebrow">Scopes</p>
                <h2>Choose what this app can ask Memact to do.</h2>
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
            <div className="actions section-actions">
              <button type="button" className="ghost" disabled={!selectedAppId} onClick={onGrantConsent}>Save consent</button>
              <button type="button" disabled={!selectedAppId} onClick={onCreateKey}>Create API key</button>
            </div>
          </section>

          <AppList apps={apps} selectedAppId={selectedAppId} setSelectedAppId={setSelectedAppId} />
        </div>
      )}

      {oneTimeKey ? (
        <section className="panel key-panel">
          <div>
            <p className="eyebrow">Copy now</p>
            <h2>One-time API key</h2>
          </div>
          <div className="key-box">
            <code>{oneTimeKey}</code>
            <button type="button" onClick={onCopyKey}>Copy key</button>
          </div>
          <p className="muted">Memact stores only a hash. This raw key cannot be shown again.</p>
        </section>
      ) : null}

      {activeTab === "api-keys" ? <div className="grid">
        <section className="panel">
          <p className="eyebrow">API keys</p>
          <div className="stack">
            {apiKeys.length ? apiKeys.map((key) => (
              <div className="list-card" key={key.id}>
                <span>
                  <strong>{key.name}</strong>
                  <small>{key.key_prefix}... | {key.revoked_at ? "revoked" : "active"}</small>
                </span>
                {!key.revoked_at ? <button type="button" className="ghost" onClick={() => onRevokeKey(key.id)}>Revoke</button> : null}
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
      </div> : null}
    </section>
  )
}

function AppList({ apps, selectedAppId, setSelectedAppId }) {
  return (
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
        <p className="muted">Register an app first.</p>
      )}
    </section>
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

function authStatusMessage(error, authMode) {
  const message = String(error?.message || "").toLowerCase()
  if (message.includes("failed to fetch") || message.includes("networkerror")) {
    return "Start Memact locally to login."
  }
  if (message.includes("email or password")) {
    return "Check email or password."
  }
  if (message.includes("account already exists")) {
    return "Account already exists."
  }
  if (message.includes("at least 10")) {
    return "Use a longer password."
  }
  return authMode === "signup" ? "Account was not created." : "Login did not finish."
}

createRoot(document.getElementById("root")).render(<App />)
