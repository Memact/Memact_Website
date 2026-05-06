import React, { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import {
  AccessClient,
  AccessApiError,
  ACCESS_URL
} from "./memact-access-client.js"
import { getAuthRedirectUrl, isSupabaseConfigured, requireSupabase, supabase } from "./supabase-client.js"
import { hasDuplicateAppName } from "./app-name.js"

const DEFAULT_SCOPES = [
  "capture:webpage",
  "schema:write",
  "graph:write",
  "memory:write",
  "memory:read_summary"
]

function App() {
  const client = useMemo(() => new AccessClient(ACCESS_URL), [])
  const [authSession, setAuthSession] = useState(null)
  const [authUser, setAuthUser] = useState(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [activeTab, setActiveTab] = useState(window.location.pathname === "/dashboard" ? "access" : "login")
  const [user, setUser] = useState(null)
  const [email, setEmail] = useState("")
  const [authLoading, setAuthLoading] = useState("")
  const [authNotice, setAuthNotice] = useState("")
  const [status, setStatus] = useState("Checking Access.")
  const [error, setError] = useState("")
  const [canRetryDashboard, setCanRetryDashboard] = useState(false)
  const [policy, setPolicy] = useState(null)
  const [apps, setApps] = useState([])
  const [apiKeys, setApiKeys] = useState([])
  const [consents, setConsents] = useState([])
  const [newAppName, setNewAppName] = useState("")
  const [newAppDescription, setNewAppDescription] = useState("")
  const [selectedAppId, setSelectedAppId] = useState("")
  const [selectedScopes, setSelectedScopes] = useState(DEFAULT_SCOPES)
  const [oneTimeKey, setOneTimeKey] = useState("")
  const [apiTestResult, setApiTestResult] = useState("")
  const [showAppForm, setShowAppForm] = useState(false)
  const session = authSession?.access_token || ""

  useEffect(() => {
    client.health()
      .then(() => setStatus("Memact is online."))
      .catch(() => setStatus("Start Memact locally to use the portal."))
    client.policy().then(setPolicy).catch(() => {})
  }, [client])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthChecking(false)
      setStatus("Supabase env vars are missing.")
      return undefined
    }

    let mounted = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) {
        setError(error.message)
      }
      const nextSession = data?.session || null
      setAuthSession(nextSession)
      setAuthUser(nextSession?.user || null)
      setAuthChecking(false)
      if (nextSession && window.location.pathname !== "/dashboard") {
        window.history.replaceState({}, "", "/dashboard")
      }
      if (!nextSession && window.location.pathname === "/dashboard") {
        window.history.replaceState({}, "", "/login")
        setActiveTab("login")
      }
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setAuthSession(nextSession)
      setAuthUser(nextSession?.user || null)
      if (nextSession) {
        setActiveTab("access")
        window.history.replaceState({}, "", "/dashboard")
      }
    })

    return () => {
      mounted = false
      subscription?.subscription?.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const tabName = activeTab === "account" ? "Account" : activeTab === "access" ? "API Keys" : "Login"
    document.title = `Memact | ${tabName}`
  }, [activeTab])

  useEffect(() => {
    if (authChecking || !session) return
    refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
  }, [authChecking, client, session])

  useEffect(() => {
    if (apps.length === 1 && selectedAppId !== apps[0].id) {
      setSelectedAppId(apps[0].id)
      return
    }
    if (selectedAppId && !apps.some((app) => app.id === selectedAppId)) {
      setSelectedAppId(apps[0]?.id || "")
      return
    }
    if (!selectedAppId && apps[0]?.id) {
      setSelectedAppId(apps[0].id)
    }
  }, [apps, selectedAppId])

  useEffect(() => {
    if (!selectedAppId) return
    const appConsent = consents.find((consent) => consent.app_id === selectedAppId && !consent.revoked_at)
    setSelectedScopes(appConsent?.scopes?.length ? appConsent.scopes : DEFAULT_SCOPES)
  }, [consents, selectedAppId])

  async function handleEmailLogin(event) {
    event.preventDefault()
    setError("")
    setAuthNotice("")
    setAuthLoading("email")
    setStatus("Sending login link.")
    try {
      const { error: otpError } = await requireSupabase().auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: getAuthRedirectUrl()
        }
      })
      if (otpError) throw otpError
      setAuthNotice("Check your email for the login link.")
      setStatus("Login link sent.")
    } catch (authError) {
      setError(authError.message)
      setStatus(authStatusMessage(authError))
    } finally {
      setAuthLoading("")
    }
  }

  async function handleGithubLogin() {
    setError("")
    setAuthNotice("")
    setAuthLoading("github")
    setStatus("Opening GitHub login.")
    try {
      const { error: oauthError } = await requireSupabase().auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: getAuthRedirectUrl()
        }
      })
      if (oauthError) throw oauthError
    } catch (authError) {
      setError(authError.message)
      setStatus(authStatusMessage(authError))
      setAuthLoading("")
    }
  }

  async function handleCreateApp(event) {
    event.preventDefault()
    setError("")
    setCanRetryDashboard(false)
    const cleanName = newAppName.trim()
    if (!cleanName) {
      setError("App name is required.")
      return
    }
    if (hasDuplicateAppName(apps, cleanName)) {
      setError("You already have an app with this name.")
      return
    }
    try {
      const result = await client.createApp(session, {
        name: cleanName,
        description: newAppDescription.trim()
      })
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
      setSelectedAppId(result.app.id)
      setShowAppForm(false)
      setNewAppName("")
      setNewAppDescription("")
      setStatus("App created.")
    } catch (appError) {
      setError(appError.message)
      setStatus(statusForAccessError(appError).status)
    }
  }

  async function handleRetryDashboard() {
    if (authChecking || !session) return
    await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
  }

  async function handleGrantConsent() {
    setError("")
    try {
      await client.grantConsent(session, { app_id: selectedAppId, scopes: selectedScopes })
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
      setStatus("Permissions saved.")
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
      setApiTestResult("")
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
      setStatus("API key created. Copy it now.")
    } catch (keyError) {
      setError(keyError.message)
    }
  }

  async function handleRevokeKey(keyId) {
    setError("")
    try {
      await client.revokeApiKey(session, keyId)
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
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

  async function testOneTimeKey() {
    if (!oneTimeKey) return
    setError("")
    setApiTestResult("")
    setStatus("Testing API key.")
    try {
      const result = await client.verifyApiKey(oneTimeKey, selectedScopes)
      setApiTestResult(`Verified for ${result.scopes.length} scope${result.scopes.length === 1 ? "" : "s"}.`)
      setStatus("API key works.")
    } catch (testError) {
      setError(testError.message)
      setStatus("API key test failed.")
    }
  }

  async function signOut() {
    setError("")
    setStatus("Signing out.")
    try {
      if (supabase) {
        const { error: signOutError } = await supabase.auth.signOut()
        if (signOutError) throw signOutError
      }
    } catch (signOutError) {
      setError(signOutError.message)
    }
    setAuthSession(null)
    setAuthUser(null)
    setUser(null)
    setApps([])
    setApiKeys([])
    setConsents([])
    setOneTimeKey("")
    setApiTestResult("")
    setActiveTab("login")
    setStatus("Signed out.")
    window.history.replaceState({}, "", "/login")
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
            <button type="button" className={activeTab === "access" ? "tab is-active" : "tab"} onClick={() => setActiveTab("access")}>API Keys</button>
            <button type="button" className={activeTab === "account" ? "tab is-active" : "tab"} onClick={() => setActiveTab("account")}>Account</button>
          </nav>
        ) : null}
        <span className="status-pill">{status}</span>
      </header>

      {error ? <p className="error" role="alert">{error} {canRetryDashboard ? <button type="button" className="inline-retry" onClick={handleRetryDashboard}>Retry</button> : null}</p> : null}
      {authChecking ? <p className="status-line">Checking login.</p> : null}

      {session ? (
        <Dashboard
          activeTab={activeTab}
          user={user}
          authUser={authUser}
          apps={apps}
          apiKeys={apiKeys}
          consents={consents}
          scopes={scopes}
          selectedAppId={selectedAppId}
          selectedScopes={selectedScopes}
          newAppName={newAppName}
          newAppDescription={newAppDescription}
          oneTimeKey={oneTimeKey}
          apiTestResult={apiTestResult}
          showAppForm={showAppForm}
          setSelectedAppId={setSelectedAppId}
          setSelectedScopes={setSelectedScopes}
          setNewAppName={setNewAppName}
          setNewAppDescription={setNewAppDescription}
          setShowAppForm={setShowAppForm}
          onCreateApp={handleCreateApp}
          onGrantConsent={handleGrantConsent}
          onCreateKey={handleCreateKey}
          onRevokeKey={handleRevokeKey}
          onCopyKey={copyOneTimeKey}
          onTestKey={testOneTimeKey}
          onSignOut={signOut}
        />
      ) : (
        <Landing
          showAuth={showAuth}
          email={email}
          authLoading={authLoading}
          authNotice={authNotice}
          setEmail={setEmail}
          onEmailLogin={handleEmailLogin}
          onGithubLogin={handleGithubLogin}
        />
      )}
    </main>
  )
}

function Landing({ showAuth, email, authLoading, authNotice, setEmail, onEmailLogin, onGithubLogin }) {
  return (
    <section className={showAuth ? "landing landing-with-auth" : "landing"}>
      <div className="hero-copy">
        <h1>Manage access to Memact.</h1>
        <p>
          Sign in, register apps, save permissions, and create scoped API keys.
          Apps can use Memact through clear permissions while your memory data
          stays protected by default.
        </p>
      </div>

      {showAuth ? (
        <section className="panel auth-panel" aria-label="Memact login">
          <p className="eyebrow">Login</p>
          <h2>Login.</h2>
          <p className="muted">
            Enter your email and Memact will send a secure login link.
          </p>
          {authNotice ? <p className="success" role="status">{authNotice}</p> : null}
          <form className="form" onSubmit={onEmailLogin}>
            <label>
              Email
              <input value={email} type="email" inputMode="email" autoComplete="email" onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <button type="submit" disabled={authLoading === "email"}>
              {authLoading === "email" ? "Sending link..." : "Continue with Email"}
            </button>
            <button type="button" className="ghost" disabled={authLoading === "github"} onClick={onGithubLogin}>
              {authLoading === "github" ? "Opening GitHub..." : "Continue with GitHub"}
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
  authUser,
  apps,
  apiKeys,
  consents,
  scopes,
  selectedAppId,
  selectedScopes,
  newAppName,
  newAppDescription,
  oneTimeKey,
  apiTestResult,
  showAppForm,
  setSelectedAppId,
  setSelectedScopes,
  setNewAppName,
  setNewAppDescription,
  setShowAppForm,
  onCreateApp,
  onGrantConsent,
  onCreateKey,
  onRevokeKey,
  onCopyKey,
  onTestKey,
  onSignOut
}) {
  const hasApps = apps.length > 0
  const isCreatingApp = showAppForm || !hasApps
  const selectedApp = hasApps ? apps.find((app) => app.id === selectedAppId) : null
  const selectedKeys = apiKeys.filter((key) => key.app_id === selectedAppId)
  const selectedConsent = consents.find((consent) => consent.app_id === selectedAppId && !consent.revoked_at)
  const consentChanged = selectedConsent ? !sameScopes(selectedScopes, selectedConsent.scopes) : true
  const canCreateKey = Boolean(selectedAppId && selectedConsent && !consentChanged)
  const appHeading = isCreatingApp
    ? hasApps ? "Create a new app." : "Create your first app."
    : selectedApp?.name || "Select an app."
  const appDescription = !isCreatingApp && selectedApp
    ? selectedApp.description || "No description added."
    : "Each app gets its own permissions and API keys."

  const provider = user?.provider || authUser?.app_metadata?.provider || authUser?.identities?.[0]?.provider || "email"
  const avatar = user?.avatar_url || authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture || ""
  const displayEmail = user?.email || authUser?.email || ""

  return (
    <section className="dashboard">
      <div className="dashboard-head panel slim-panel">
        <div>
          <p className="eyebrow">{activeTab === "account" ? "Account" : "API keys"}</p>
          <h2>{displayEmail}</h2>
          <p className="muted">{activeTab === "account" ? "Manage your account and session." : "Create app-specific keys with clear permission scopes."}</p>
        </div>
        <button type="button" className="ghost" onClick={onSignOut}>Sign out</button>
      </div>

      {activeTab === "account" ? (
        <section className="panel account-panel">
          <p className="eyebrow">Account</p>
          <div className="identity-card">
            {avatar ? <img src={avatar} alt="" /> : <span aria-hidden="true">{displayEmail.slice(0, 1).toUpperCase()}</span>}
            <div>
              <h2>{displayEmail}</h2>
              <p className="muted">Signed in with {provider}.</p>
            </div>
          </div>
          <div className="account-grid">
            <div className="metric-card">
              <span>Plan</span>
              <strong>Free unlimited</strong>
            </div>
            <div className="metric-card">
              <span>Registered apps</span>
              <strong>{apps.length}</strong>
            </div>
            <div className="metric-card">
              <span>Active API keys</span>
              <strong>{apiKeys.filter((key) => !key.revoked_at).length}</strong>
            </div>
          </div>
          <p className="muted">
            Permissions mean you choose exactly which actions a registered app can ask Memact to perform. If a scope is not saved for that app, its API key cannot use that permission.
          </p>
        </section>
      ) : (
        <>
          <section className="panel app-workspace">
            <div className="section-head">
              <div>
                <p className="eyebrow">App</p>
                <h2>{appHeading}</h2>
                <p className="muted">{appDescription}</p>
              </div>
              {hasApps ? (
                <button type="button" className="new-app-button" aria-label={isCreatingApp ? "Cancel app creation" : "Create app"} onClick={() => setShowAppForm((current) => !current)}>
                  {isCreatingApp ? "Cancel" : "New app"}
                </button>
              ) : null}
            </div>

            {isCreatingApp ? (
              <form className="form app-create-form" onSubmit={onCreateApp}>
                <label>
                  App name
                  <input value={newAppName} placeholder="Example: Personal capture layer" onChange={(event) => setNewAppName(event.target.value)} required />
                </label>
                <label>
                  Purpose
                  <textarea value={newAppDescription} placeholder="Optional: What will this app use Memact for?" onChange={(event) => setNewAppDescription(event.target.value)} />
                </label>
                <button type="submit">Create app</button>
              </form>
            ) : null}

            {hasApps ? (
              <div className="app-switcher" aria-label="Select app">
                {apps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    className={`app-chip ${selectedAppId === app.id ? "is-active" : ""}`}
                    onClick={() => setSelectedAppId(app.id)}
                  >
                    {app.name}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <div className="access-layout">
            <section className="panel">
              <div className="section-head">
                <div className="section-copy">
                  <p className="eyebrow">Permissions</p>
                  <h2>Choose what this app can ask Memact to do.</h2>
                  <p className="muted">
                    {selectedConsent
                      ? consentChanged ? "Scopes changed. Save permissions before creating the next key." : "Permissions are saved for this app. Change scopes any time."
                      : "Save permissions before creating a usable API key."}
                  </p>
                </div>
                <div className="actions section-actions">
                  <button type="button" className="ghost" disabled={!selectedAppId || !selectedScopes.length} onClick={onGrantConsent}>Save permissions</button>
                  <button type="button" disabled={!canCreateKey} onClick={onCreateKey}>Create API key</button>
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

            <section className="panel">
              <p className="eyebrow">API keys</p>
              <div className="stack">
                {selectedKeys.length ? selectedKeys.map((key) => (
                  <div className="list-card" key={key.id}>
                    <span>
                      <strong>{key.name}</strong>
                      <small>{key.key_prefix}... | {key.revoked_at ? "revoked" : "active"}</small>
                    </span>
                    {!key.revoked_at ? <button type="button" className="ghost" onClick={() => onRevokeKey(key.id)}>Revoke</button> : null}
                  </div>
                )) : <p className="muted">{selectedAppId ? "No API keys for this app yet." : "Select an app to view API keys."}</p>}
              </div>
            </section>
          </div>
        </>
      )}

      {oneTimeKey ? (
        <section className="panel key-panel">
          <div>
            <p className="eyebrow">Copy now</p>
            <h2>One-time API key</h2>
          </div>
          <div className="key-box">
            <code>{oneTimeKey}</code>
            <div className="key-actions">
              <button type="button" onClick={onCopyKey}>Copy key</button>
              <button type="button" className="ghost" onClick={onTestKey}>Test key</button>
            </div>
          </div>
          {apiTestResult ? <p className="success" role="status">{apiTestResult}</p> : null}
          <div className="embed-code">
            <p className="eyebrow">Embed</p>
            <pre><code>{buildEmbedCode(oneTimeKey, selectedScopes)}</code></pre>
          </div>
          <p className="muted">Memact stores only a hash. This raw key cannot be shown again.</p>
        </section>
      ) : null}

    </section>
  )
}

async function refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard) {
  setCanRetryDashboard(false)
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
    setError("")
    setStatus("Dashboard synced.")
  } catch (error) {
    const next = statusForAccessError(error)
    setError(next.message)
    setStatus(next.status)
    setCanRetryDashboard(true)
  }
}

function statusForAccessError(error) {
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(error?.message || ""))) {
    return {
      message: "Could not reach Access. Make sure it is running.",
      status: "Access offline."
    }
  }
  if (error instanceof AccessApiError) {
    if (error.status === 401) return { message: "Please sign in again.", status: "Login expired." }
    if (error.status === 403) return { message: "Access denied for this dashboard.", status: "Access denied." }
    if (error.status === 409) return { message: "This app already exists.", status: "Dashboard sync failed." }
    if (error.status >= 500) return { message: "Access service had a server error. Check Access logs.", status: "Dashboard sync failed." }
  }
  return {
    message: error?.message || "Dashboard sync failed.",
    status: "Dashboard sync failed."
  }
}


function authStatusMessage(error) {
  const message = String(error?.message || "").toLowerCase()
  if (message.includes("failed to fetch") || message.includes("networkerror")) {
    return "Login did not connect."
  }
  if (message.includes("supabase is not configured")) {
    return "Supabase env vars are missing."
  }
  return "Login did not finish."
}

function sameScopes(first = [], second = []) {
  const firstList = [...first].sort()
  const secondList = [...second].sort()
  return firstList.length === secondList.length && firstList.every((scope, index) => scope === secondList[index])
}

function buildEmbedCode(apiKey, scopes = []) {
  return `import { createMemactCaptureClient } from "./memact-capture-client.mjs";

const memact = createMemactCaptureClient({
  accessUrl: "${ACCESS_URL}",
  apiKey: "${apiKey || "mka_key_shown_once"}"
});

const { snapshot } = await memact.getLocalSnapshot({
  scopes: ${JSON.stringify(scopes, null, 2)}
});

console.log(snapshot.counts);`
}

createRoot(document.getElementById("root")).render(<App />)
