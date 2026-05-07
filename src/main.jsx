import React, { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import {
  AccessClient,
  AccessApiError,
  ACCESS_MODE,
  ACCESS_URL
} from "./memact-access-client.js"
import { getAuthRedirectUrl, isSupabaseConfigured, requireSupabase, supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-client.js"
import { hasDuplicateAppName } from "./app-name.js"
import { defaultCategoriesForPolicy, defaultScopesForPolicy, normalizeSelectedCategories, normalizeSelectedScopes } from "./access-policy.js"

function App() {
  const client = useMemo(() => new AccessClient(ACCESS_URL), [])
  const [authSession, setAuthSession] = useState(null)
  const [authUser, setAuthUser] = useState(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [activeTab, setActiveTab] = useState(window.location.pathname === "/dashboard" ? "access" : "login")
  const [user, setUser] = useState(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [authLoading, setAuthLoading] = useState("")
  const [authNotice, setAuthNotice] = useState("")
  const [authFlow, setAuthFlow] = useState(() => detectAuthFlowFromUrl())
  const [status, setStatus] = useState("Checking Access.")
  const [error, setError] = useState("")
  const [canRetryDashboard, setCanRetryDashboard] = useState(false)
  const [policy, setPolicy] = useState(null)
  const [apps, setApps] = useState([])
  const [apiKeys, setApiKeys] = useState([])
  const [consents, setConsents] = useState([])
  const [newAppName, setNewAppName] = useState("")
  const [newAppDescription, setNewAppDescription] = useState("")
  const [newAppDeveloperUrl, setNewAppDeveloperUrl] = useState("")
  const [newAppRedirectUrl, setNewAppRedirectUrl] = useState("")
  const [newAppCategories, setNewAppCategories] = useState(() => defaultCategoriesForPolicy(null))
  const [selectedAppId, setSelectedAppId] = useState("")
  const [selectedScopes, setSelectedScopes] = useState(() => defaultScopesForPolicy(null))
  const [selectedCategories, setSelectedCategories] = useState(() => defaultCategoriesForPolicy(null))
  const [oneTimeKey, setOneTimeKey] = useState("")
  const [oneTimeKeyId, setOneTimeKeyId] = useState("")
  const [oneTimeKeyScopes, setOneTimeKeyScopes] = useState([])
  const [oneTimeKeyCategories, setOneTimeKeyCategories] = useState([])
  const [apiTestResult, setApiTestResult] = useState("")
  const [showAppForm, setShowAppForm] = useState(false)
  const [connectRequest, setConnectRequest] = useState(() => parseConnectRequest())
  const [connectDetails, setConnectDetails] = useState(null)
  const [connectLoading, setConnectLoading] = useState("")
  const [connectNotice, setConnectNotice] = useState("")
  const [setupPassword, setSetupPassword] = useState("")
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState("")
  const [passwordSuccess, setPasswordSuccess] = useState("")
  const [newEmailAddress, setNewEmailAddress] = useState("")
  const [emailChangeSuccess, setEmailChangeSuccess] = useState("")
  const session = authSession?.access_token || ""
  const passwordState = useMemo(() => getPasswordState(setupPassword, setupPasswordConfirm), [setupPassword, setupPasswordConfirm])
  const needsPasswordSetup = Boolean(authUser && shouldOfferPasswordSetup(authUser))

  useEffect(() => {
    client.health()
      .then(() => setStatus(ACCESS_MODE === "supabase" ? "Access is running through Supabase." : "Memact is online."))
      .catch(() => setStatus(ACCESS_MODE === "supabase" ? "Apply the Access Supabase migration to use the portal." : "Start Memact locally to use the portal."))
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
      const detectedFlow = detectAuthFlowFromUrl()
      setAuthSession(nextSession)
      setAuthUser(nextSession?.user || null)
      setAuthFlow(detectedFlow)
      setAuthChecking(false)
      if (nextSession && isConnectPath()) {
        setActiveTab("connect")
      } else if (nextSession && window.location.pathname !== "/dashboard") {
        window.history.replaceState({}, "", "/dashboard")
      }
      if (!nextSession && window.location.pathname === "/dashboard") {
        window.history.replaceState({}, "", "/login")
        setActiveTab("login")
      }
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return
      setAuthSession(nextSession)
      setAuthUser(nextSession?.user || null)
      if (event === "PASSWORD_RECOVERY") {
        setAuthFlow("recovery")
      } else if (event === "SIGNED_IN") {
        setAuthFlow(detectAuthFlowFromUrl())
      } else if (event === "SIGNED_OUT") {
        setAuthFlow("default")
      }
      if (nextSession) {
        if (isConnectPath()) {
          setActiveTab("connect")
        } else {
          setActiveTab(shouldOpenAccountTab(nextSession.user, event === "PASSWORD_RECOVERY" || detectAuthFlowFromUrl() === "recovery") ? "account" : "access")
          window.history.replaceState({}, "", "/dashboard")
        }
      }
    })

    return () => {
      mounted = false
      subscription?.subscription?.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) return
    if (authFlow === "recovery") {
      setActiveTab("account")
      setStatus("Reset your password.")
      setAuthNotice("Choose a new password for your Memact account.")
      return
    }
    if (needsPasswordSetup) {
      setActiveTab("account")
      setStatus("Set a password to make your next login faster.")
    }
  }, [authFlow, needsPasswordSetup, session])

  useEffect(() => {
    const tabName = activeTab === "account" ? "Account" : activeTab === "help" ? "Help" : activeTab === "connect" ? "Connect" : activeTab === "access" ? "API Keys" : "Login"
    document.title = `Memact | ${tabName}`
  }, [activeTab])

  useEffect(() => {
    if (authChecking || !session) return
    refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
  }, [authChecking, client, session])

  useEffect(() => {
    if (!isConnectPath()) return
    const request = parseConnectRequest()
    setConnectRequest(request)
    setActiveTab("connect")
    if (!session || !request.app_id) return

    let cancelled = false
    setConnectLoading("loading")
    setConnectNotice("")
    setStatus("Checking app connection.")
    client.getConnectApp(session, request)
      .then((details) => {
        if (cancelled) return
        setConnectDetails(details)
        setError("")
        setStatus("Review app connection.")
      })
      .catch((connectError) => {
        if (cancelled) return
        setError(connectError.message)
        setStatus("Connect app failed.")
      })
      .finally(() => {
        if (!cancelled) setConnectLoading("")
      })

    return () => {
      cancelled = true
    }
  }, [client, session])

  useEffect(() => {
    setNewAppCategories(defaultCategoriesForPolicy(policy))
  }, [policy])

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

  function handleSelectApp(appId) {
    setSelectedAppId(appId)
    setOneTimeKey("")
    setOneTimeKeyId("")
    setOneTimeKeyScopes([])
    setOneTimeKeyCategories([])
    setApiTestResult("")
  }

  useEffect(() => {
    if (!selectedAppId) return
    const selectedApp = apps.find((app) => app.id === selectedAppId)
    const appConsent = consents.find((consent) => consent.app_id === selectedAppId && !consent.revoked_at)
    const nextScopes = appConsent?.scopes?.length ? appConsent.scopes : defaultScopesForPolicy(policy)
    const nextCategories = appConsent?.categories?.length ? appConsent.categories : selectedApp?.default_categories?.length ? selectedApp.default_categories : defaultCategoriesForPolicy(policy)
    setSelectedScopes(normalizeSelectedScopes(nextScopes, policy))
    setSelectedCategories(normalizeSelectedCategories(nextCategories, policy))
  }, [apps, consents, policy, selectedAppId])

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
          emailRedirectTo: getAuthRedirectTarget()
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

  async function handlePasswordLogin(event) {
    event.preventDefault()
    setError("")
    setAuthNotice("")
    setPasswordSuccess("")
    setAuthLoading("password")
    setStatus("Signing in.")
    try {
      const auth = requireSupabase()
      const { data, error: signInError } = await auth.auth.signInWithPassword({
        email,
        password
      })
      if (signInError) throw signInError
      setPassword("")
      const signedInUser = data?.user
      if (signedInUser && !signedInUser.user_metadata?.memact_password_ready) {
        const { data: updated, error: updateError } = await auth.auth.updateUser({
          data: {
            ...signedInUser.user_metadata,
            memact_password_ready: true,
            memact_password_updated_at: new Date().toISOString()
          }
        })
        if (updateError) throw updateError
        if (updated?.user) {
          setAuthUser(updated.user)
        }
      }
      setStatus("Signed in.")
    } catch (authError) {
      setError(passwordLoginErrorMessage(authError))
      setStatus(authStatusMessage(authError))
    } finally {
      setAuthLoading("")
    }
  }

  async function handleForgotPassword() {
    setError("")
    setPasswordSuccess("")
    setEmailChangeSuccess("")
    if (!email.trim()) {
      setError("Enter your email first so Memact knows where to send the reset link.")
      return
    }
    setAuthLoading("forgot-password")
    setStatus("Sending password reset link.")
    try {
      const { error: resetError } = await requireSupabase().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getAuthRedirectTarget()
      })
      if (resetError) throw resetError
      setAuthNotice("Check your email for the password reset link.")
      setStatus("Password reset link sent.")
    } catch (resetError) {
      setError(String(resetError?.message || "Could not send the password reset link."))
      setStatus(authStatusMessage(resetError))
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
          redirectTo: getAuthRedirectTarget()
        }
      })
      if (oauthError) throw oauthError
    } catch (authError) {
      setError(authError.message)
      setStatus(authStatusMessage(authError))
      setAuthLoading("")
    }
  }

  async function handleSetPassword(event) {
    event.preventDefault()
    setError("")
    setPasswordSuccess("")
    const validationMessage = passwordState.errors[0] || ""
    if (validationMessage) {
      setError(validationMessage)
      return
    }
    setAuthLoading("set-password")
    setStatus("Saving password.")
    try {
      const { data, error: updateError } = await requireSupabase().auth.updateUser({
        password: setupPassword,
        data: {
          ...(authUser?.user_metadata || {}),
          memact_password_ready: true,
          memact_password_updated_at: new Date().toISOString()
        }
      })
      if (updateError) throw updateError
      if (data?.user) {
        setAuthUser(data.user)
      }
      setSetupPassword("")
      setSetupPasswordConfirm("")
      setAuthFlow("default")
      setAuthNotice("")
      setPasswordSuccess("Password saved. Next time you can sign in with email and password.")
      setStatus("Password ready.")
    } catch (passwordError) {
      setError(passwordSetupErrorMessage(passwordError))
      setStatus(authStatusMessage(passwordError))
    } finally {
      setAuthLoading("")
    }
  }

  async function handleChangeEmail(event) {
    event.preventDefault()
    setError("")
    setEmailChangeSuccess("")
    const nextEmail = newEmailAddress.trim().toLowerCase()
    if (!nextEmail) {
      setError("Enter the new email address first.")
      return
    }
    if (nextEmail === (authUser?.email || "").toLowerCase()) {
      setError("Use a different email address.")
      return
    }
    setAuthLoading("change-email")
    setStatus("Sending email change confirmation.")
    try {
      const { data, error: updateError } = await requireSupabase().auth.updateUser({
        email: nextEmail
      })
      if (updateError) throw updateError
      if (data?.user) {
        setAuthUser(data.user)
      }
      setNewEmailAddress("")
      setEmailChangeSuccess("Check both email inboxes to confirm the change, based on your Supabase email settings.")
      setStatus("Email change started.")
    } catch (emailError) {
      setError(String(emailError?.message || "Email change did not finish."))
      setStatus(authStatusMessage(emailError))
    } finally {
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
      scrollElementIntoView("error-message")
      return
    }
    if (hasDuplicateAppName(apps, cleanName)) {
      setError("You already have an app with this name.")
      scrollElementIntoView("error-message")
      return
    }
    try {
      const result = await client.createApp(session, {
        name: cleanName,
        description: newAppDescription.trim(),
        developer_url: newAppDeveloperUrl.trim(),
        redirect_urls: newAppRedirectUrl.trim() ? [newAppRedirectUrl.trim()] : [],
        categories: normalizeSelectedCategories(newAppCategories, policy)
      })
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
      setSelectedAppId(result.app.id)
      setShowAppForm(false)
      setNewAppName("")
      setNewAppDescription("")
      setNewAppDeveloperUrl("")
      setNewAppRedirectUrl("")
      setNewAppCategories(defaultCategoriesForPolicy(policy))
      setOneTimeKey("")
      setOneTimeKeyId("")
      setOneTimeKeyScopes([])
      setOneTimeKeyCategories([])
      setApiTestResult("")
      setStatus("App created.")
      scrollElementIntoView("permissions-panel")
    } catch (appError) {
      setError(appError.message)
      setStatus(statusForAccessError(appError).status)
      scrollElementIntoView("error-message")
    }
  }

  async function handleRetryDashboard() {
    if (authChecking || !session) return
    await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
  }

  async function handleDeleteApp() {
    if (!selectedAppId) return
    const app = apps.find((item) => item.id === selectedAppId)
    const appName = app?.name || "this app"
    const confirmed = window.confirm(`Delete ${appName}? Its API keys will stop working.`)
    if (!confirmed) return
    setError("")
    setCanRetryDashboard(false)
    setStatus("Deleting app.")
    try {
      await client.deleteApp(session, selectedAppId)
      setSelectedAppId("")
      setOneTimeKey("")
      setOneTimeKeyId("")
      setOneTimeKeyScopes([])
      setOneTimeKeyCategories([])
      setApiTestResult("")
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
      setStatus("App deleted.")
      scrollElementIntoView("app-panel")
    } catch (deleteError) {
      setError(deleteError.message)
      setStatus(statusForAccessError(deleteError).status)
      scrollElementIntoView("error-message")
    }
  }

  async function handleGrantConsent() {
    setError("")
    try {
      await client.grantConsent(session, {
        app_id: selectedAppId,
        scopes: normalizeSelectedScopes(selectedScopes, policy),
        categories: normalizeSelectedCategories(selectedCategories, policy)
      })
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
      setStatus("Permissions saved.")
      scrollElementIntoView("permissions-panel")
    } catch (consentError) {
      setError(consentError.message)
      scrollElementIntoView("error-message")
    }
  }

  async function handleCreateKey() {
    setError("")
    setOneTimeKey("")
    setOneTimeKeyId("")
    setOneTimeKeyScopes([])
    setOneTimeKeyCategories([])
    const keyScopes = normalizeSelectedScopes(selectedScopes, policy)
    const keyCategories = normalizeSelectedCategories(selectedCategories, policy)
    try {
      const result = await client.createApiKey(session, {
        app_id: selectedAppId,
        name: "Default app key",
        scopes: keyScopes,
        categories: keyCategories
      })
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
      setOneTimeKey(result.key)
      setOneTimeKeyId(result.api_key?.id || "")
      setOneTimeKeyScopes(keyScopes)
      setOneTimeKeyCategories(keyCategories)
      setApiTestResult("")
      setStatus("API key created. Copy it now.")
      scrollElementIntoView("one-time-key-panel")
    } catch (keyError) {
      setError(keyError.message)
      scrollElementIntoView("error-message")
    }
  }

  async function handleRevokeKey(keyId) {
    setError("")
    try {
      await client.revokeApiKey(session, keyId)
      if (keyId === oneTimeKeyId) {
        setOneTimeKey("")
        setOneTimeKeyId("")
        setOneTimeKeyScopes([])
        setOneTimeKeyCategories([])
        setApiTestResult("")
      }
      await refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard)
      setStatus("API key revoked.")
      scrollElementIntoView("api-keys-panel")
    } catch (keyError) {
      setError(keyError.message)
      scrollElementIntoView("error-message")
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
      const result = await client.verifyApiKey(oneTimeKey, oneTimeKeyScopes, oneTimeKeyCategories)
      const verifiedScopes = Array.isArray(result.scopes) ? result.scopes : []
      setApiTestResult(`Verified for ${verifiedScopes.length} scope${verifiedScopes.length === 1 ? "" : "s"}.`)
      setStatus("API key works.")
      scrollElementIntoView("one-time-key-panel")
    } catch (testError) {
      setError(testError.message)
      setStatus("API key test failed.")
      scrollElementIntoView("error-message")
    }
  }

  async function handleConnectApprove() {
    if (!connectRequest?.app_id) return
    setError("")
    setConnectNotice("")
    setConnectLoading("approve")
    setStatus("Connecting app.")
    try {
      const result = await client.connectApp(session, connectRequest)
      const connectionId = result?.consent?.id || ""
      setConnectNotice("App connected. You can close this tab or return to the app.")
      setStatus("App connected.")
      if (connectRequest.redirect_uri) {
        window.location.href = buildConnectRedirect(connectRequest.redirect_uri, {
          connected: "1",
          connection_id: connectionId,
          state: connectRequest.state
        })
      }
    } catch (connectError) {
      setError(connectError.message)
      setStatus("Connect app failed.")
      scrollElementIntoView("error-message")
    } finally {
      setConnectLoading("")
    }
  }

  function handleConnectCancel() {
    setStatus("Connection cancelled.")
    if (connectRequest.redirect_uri) {
      window.location.href = buildConnectRedirect(connectRequest.redirect_uri, {
        connected: "0",
        state: connectRequest.state
      })
      return
    }
    window.history.replaceState({}, "", "/dashboard")
    setActiveTab("access")
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
    setOneTimeKeyId("")
    setOneTimeKeyScopes([])
    setOneTimeKeyCategories([])
    setApiTestResult("")
    setActiveTab("login")
    setStatus("Signed out.")
    window.history.replaceState({}, "", "/login")
  }

  const scopes = policy?.scopes || {}
  const showAuth = !session

  return (
    <main className={showAuth ? "page page-auth" : "page"}>
      <header className="topbar">
        <a className="logo-link" href="https://www.memact.com/" aria-label="Go to memact.com">
          <img className="logo-img" src="/logo.png" alt="Memact" />
        </a>
        {session ? (
          <nav className="tabs" aria-label="Memact portal tabs">
            <button type="button" className={activeTab === "access" ? "tab is-active" : "tab"} onClick={() => setActiveTab("access")}>API Keys</button>
            <button type="button" className={activeTab === "account" ? "tab is-active" : "tab"} onClick={() => setActiveTab("account")}>Account</button>
            <button type="button" className={activeTab === "help" ? "tab is-active" : "tab"} onClick={() => setActiveTab("help")}>Help</button>
          </nav>
        ) : null}
        <span className="status-pill">{status}</span>
      </header>

      {error ? <p id="error-message" className="error" role="alert">{error} {canRetryDashboard ? <button type="button" className="inline-retry" onClick={handleRetryDashboard}>Retry</button> : null}</p> : null}
      {authChecking ? <p className="status-line">Checking login.</p> : null}

      {session && activeTab === "connect" ? (
        <ConnectPage
          connectRequest={connectRequest}
          connectDetails={connectDetails}
          loading={connectLoading}
          notice={connectNotice}
          onApprove={handleConnectApprove}
          onCancel={handleConnectCancel}
        />
      ) : session ? (
        <Dashboard
          activeTab={activeTab}
          user={user}
          authUser={authUser}
          apps={apps}
          apiKeys={apiKeys}
          consents={consents}
          scopes={scopes}
          categories={policy?.activity_categories || {}}
          selectedAppId={selectedAppId}
          selectedScopes={selectedScopes}
          selectedCategories={selectedCategories}
          newAppName={newAppName}
          newAppDescription={newAppDescription}
          newAppDeveloperUrl={newAppDeveloperUrl}
          newAppRedirectUrl={newAppRedirectUrl}
          newAppCategories={newAppCategories}
          oneTimeKey={oneTimeKey}
          oneTimeKeyScopes={oneTimeKeyScopes}
          oneTimeKeyCategories={oneTimeKeyCategories}
          apiTestResult={apiTestResult}
          showAppForm={showAppForm}
          setSelectedAppId={handleSelectApp}
          setSelectedScopes={setSelectedScopes}
          setSelectedCategories={setSelectedCategories}
          setNewAppName={setNewAppName}
          setNewAppDescription={setNewAppDescription}
          setNewAppDeveloperUrl={setNewAppDeveloperUrl}
          setNewAppRedirectUrl={setNewAppRedirectUrl}
          setNewAppCategories={setNewAppCategories}
          setShowAppForm={setShowAppForm}
          onCreateApp={handleCreateApp}
          onDeleteApp={handleDeleteApp}
          onGrantConsent={handleGrantConsent}
          onCreateKey={handleCreateKey}
          onRevokeKey={handleRevokeKey}
          onCopyKey={copyOneTimeKey}
          onTestKey={testOneTimeKey}
          onSignOut={signOut}
          authLoading={authLoading}
          needsPasswordSetup={needsPasswordSetup}
          setupPassword={setupPassword}
          setupPasswordConfirm={setupPasswordConfirm}
          passwordState={passwordState}
          passwordSuccess={passwordSuccess}
          setSetupPassword={setSetupPassword}
          setSetupPasswordConfirm={setSetupPasswordConfirm}
          onSetPassword={handleSetPassword}
          newEmailAddress={newEmailAddress}
          setNewEmailAddress={setNewEmailAddress}
          emailChangeSuccess={emailChangeSuccess}
          authFlow={authFlow}
          onChangeEmail={handleChangeEmail}
        />
      ) : (
        <Landing
          connectRequest={connectRequest}
          showAuth={showAuth}
          email={email}
          password={password}
          authLoading={authLoading}
          authNotice={authNotice}
          setEmail={setEmail}
          setPassword={setPassword}
          onEmailLogin={handleEmailLogin}
          onPasswordLogin={handlePasswordLogin}
          onForgotPassword={handleForgotPassword}
          onGithubLogin={handleGithubLogin}
        />
      )}
    </main>
  )
}

function Landing({ connectRequest, showAuth, email, password, authLoading, authNotice, setEmail, setPassword, onEmailLogin, onPasswordLogin, onForgotPassword, onGithubLogin }) {
  const isConnecting = Boolean(connectRequest?.app_id && isConnectPath())
  return (
    <section className={showAuth ? "landing landing-with-auth" : "landing"}>
      <div className="hero-copy">
        <h1>{isConnecting ? "Sign in to connect Memact." : "Manage access to Memact."}</h1>
        <p>
          {isConnecting
            ? "Memact will show the app name, exact permissions, and activity categories before anything is connected."
            : "Sign in, register apps, save permissions, and create scoped API keys. Apps can use Memact through clear permissions while your memory data stays protected by default."}
        </p>
      </div>

      {showAuth ? (
        <section className="panel auth-panel" aria-label="Memact login">
          <p className="eyebrow">Login</p>
          <h2>Login.</h2>
          <p className="muted">
            Use your email and password, or start with a secure email link and set a password right after.
          </p>
          {authNotice ? <p className="success" role="status">{authNotice}</p> : null}
          <form className="form" onSubmit={onPasswordLogin}>
            <label>
              Email
              <input value={email} type="email" inputMode="email" autoComplete="email" onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              Password
              <input value={password} type="password" autoComplete="current-password" placeholder="Enter your password" onChange={(event) => setPassword(event.target.value)} required />
            </label>
            <button type="submit" disabled={authLoading === "password"}>
              {authLoading === "password" ? "Signing in..." : "Continue with Password"}
            </button>
            <button type="button" className="text-button" disabled={authLoading === "forgot-password"} onClick={onForgotPassword}>
              {authLoading === "forgot-password" ? "Sending reset link..." : "Forgot password?"}
            </button>
            <button type="button" className="ghost" disabled={authLoading === "email"} onClick={onEmailLogin}>
              {authLoading === "email" ? "Sending link..." : "Email me a login link"}
            </button>
            <div className="auth-divider" aria-hidden="true"><span>or</span></div>
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
  categories,
  selectedAppId,
  selectedScopes,
  selectedCategories,
  newAppName,
  newAppDescription,
  newAppDeveloperUrl,
  newAppRedirectUrl,
  newAppCategories,
  oneTimeKey,
  oneTimeKeyScopes,
  oneTimeKeyCategories,
  apiTestResult,
  showAppForm,
  setSelectedAppId,
  setSelectedScopes,
  setSelectedCategories,
  setNewAppName,
  setNewAppDescription,
  setNewAppDeveloperUrl,
  setNewAppRedirectUrl,
  setNewAppCategories,
  setShowAppForm,
  onCreateApp,
  onDeleteApp,
  onGrantConsent,
  onCreateKey,
  onRevokeKey,
  onCopyKey,
  onTestKey,
  onSignOut,
  authLoading,
  needsPasswordSetup,
  setupPassword,
  setupPasswordConfirm,
  passwordState,
  passwordSuccess,
  setSetupPassword,
  setSetupPasswordConfirm,
  onSetPassword,
  newEmailAddress,
  setNewEmailAddress,
  emailChangeSuccess,
  authFlow,
  onChangeEmail
}) {
  const hasApps = apps.length > 0
  const isCreatingApp = showAppForm || !hasApps
  const selectedApp = hasApps ? apps.find((app) => app.id === selectedAppId) : null
  const selectedKeys = apiKeys.filter((key) => key.app_id === selectedAppId)
  const selectedConsent = consents.find((consent) => consent.app_id === selectedAppId && !consent.revoked_at)
  const scopesChanged = selectedConsent ? !sameValues(selectedScopes, selectedConsent.scopes) : true
  const categoriesChanged = selectedConsent ? !sameValues(selectedCategories, selectedConsent.categories || []) : true
  const consentChanged = scopesChanged || categoriesChanged
  const canCreateKey = Boolean(selectedAppId && selectedConsent && !consentChanged && selectedScopes.length && selectedCategories.length)
  const permissionsHint = !selectedAppId
    ? "Create app first."
    : selectedConsent
      ? consentChanged
        ? "Save permissions first."
        : ""
      : "Save permissions first."
  const createKeyHint = !selectedAppId
    ? "Create app first."
    : !selectedConsent
      ? "Save permissions first."
      : consentChanged
        ? "Save permissions first."
        : ""
  const appHeading = isCreatingApp
    ? hasApps ? "Create a new app." : "Create your first app."
    : selectedApp?.name || "Select an app."
  const appDescription = !isCreatingApp && selectedApp
    ? selectedApp.description || "No description added."
    : "Each app gets its own permissions and API keys."
  const dashboardLabel = activeTab === "account" ? "Account" : activeTab === "help" ? "Help" : "API keys"
  const dashboardSubtitle = activeTab === "account"
    ? "Manage your account and session."
    : activeTab === "help"
      ? "Plain-English help for Memact Access."
      : "Create app-specific keys with clear permission scopes."

  const provider = user?.provider || authUser?.app_metadata?.provider || authUser?.identities?.[0]?.provider || "email"
  const avatar = user?.avatar_url || authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture || ""
  const displayEmail = user?.email || authUser?.email || ""

  return (
    <section className="dashboard">
      <div className="dashboard-head panel slim-panel">
        <div>
          <p className="eyebrow">{dashboardLabel}</p>
          <h2>{displayEmail}</h2>
          <p className="muted">{dashboardSubtitle}</p>
        </div>
        <button type="button" className="ghost" onClick={onSignOut}>Sign out</button>
      </div>

      {activeTab === "help" ? (
        <HelpPanel />
      ) : activeTab === "account" ? (
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
          {provider === "email" ? (
            <section className="password-panel">
              <div>
                <p className="eyebrow">Password</p>
                <h2>{authFlow === "recovery" ? "Reset your password." : needsPasswordSetup ? "Set a password." : "Update your password."}</h2>
                <p className="muted">
                  {authFlow === "recovery"
                    ? "Your recovery link worked. Choose a new password to finish getting back into Memact."
                    : needsPasswordSetup
                    ? "You are signed in through the email link. Set a strong password now so the next login is faster."
                    : "Keep a strong password on this account so you can sign in without requesting a new link."}
                </p>
              </div>
              {passwordSuccess ? <p className="success" role="status">{passwordSuccess}</p> : null}
              <form className="form" onSubmit={onSetPassword}>
                <label>
                  New password
                  <input
                    value={setupPassword}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Create a strong password"
                    onChange={(event) => setSetupPassword(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Confirm password
                  <input
                    value={setupPasswordConfirm}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat the password"
                    onChange={(event) => setSetupPasswordConfirm(event.target.value)}
                    required
                  />
                </label>
                <div className="password-strength" data-strength={passwordState.level}>
                  <div className="password-strength-bar">
                    <span style={{ width: `${passwordState.percent}%` }} />
                  </div>
                  <strong>{passwordState.label}</strong>
                </div>
                <ul className="password-rules" aria-label="Password requirements">
                  {passwordState.checks.map((check) => (
                    <li key={check.label} className={check.ok ? "is-passed" : ""}>{check.label}</li>
                  ))}
                </ul>
                <button type="submit" disabled={!passwordState.canSubmit || authLoading === "set-password"}>
                  {authLoading === "set-password" ? "Saving password..." : authFlow === "recovery" ? "Reset password" : needsPasswordSetup ? "Save password" : "Update password"}
                </button>
              </form>
            </section>
          ) : null}
          {provider === "email" ? (
            <section className="password-panel">
              <div>
                <p className="eyebrow">Email</p>
                <h2>Change your email.</h2>
                <p className="muted">
                  Start an email change here. Supabase will send verification based on your project email settings.
                </p>
              </div>
              {emailChangeSuccess ? <p className="success" role="status">{emailChangeSuccess}</p> : null}
              <form className="form" onSubmit={onChangeEmail}>
                <label>
                  New email address
                  <input
                    value={newEmailAddress}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="Enter the new email address"
                    onChange={(event) => setNewEmailAddress(event.target.value)}
                    required
                  />
                </label>
                <button type="submit" disabled={authLoading === "change-email"}>
                  {authLoading === "change-email" ? "Sending confirmation..." : "Change email"}
                </button>
              </form>
            </section>
          ) : null}
        </section>
      ) : (
        <>
          <section id="app-panel" className="panel app-workspace">
            <div className="section-head">
              <div>
                <p className="eyebrow">App</p>
                <h2>{appHeading}</h2>
                <p className="muted">{appDescription}</p>
              </div>
              {hasApps ? (
                <div className="section-toolbar">
                  {!isCreatingApp && selectedApp ? (
                    <button type="button" className="ghost danger" onClick={onDeleteApp}>Delete app</button>
                  ) : null}
                  <button type="button" className="new-app-button" aria-label={isCreatingApp ? "Cancel app creation" : "Create app"} onClick={() => setShowAppForm((current) => !current)}>
                    {isCreatingApp ? "Cancel" : "New app"}
                  </button>
                </div>
              ) : null}
            </div>

            {isCreatingApp ? (
              <form className="form app-create-form" onSubmit={onCreateApp}>
                <label>
                  App name
                  <input value={newAppName} placeholder="Example: Personal capture layer" onChange={(event) => setNewAppName(event.target.value)} required />
                </label>
                <label>
                  Developer website
                  <input value={newAppDeveloperUrl} type="url" placeholder="Optional: https://example.com" onChange={(event) => setNewAppDeveloperUrl(event.target.value)} />
                </label>
                <label>
                  Connect redirect URL
                  <input value={newAppRedirectUrl} type="url" placeholder="Optional: where users return after connecting" onChange={(event) => setNewAppRedirectUrl(event.target.value)} />
                </label>
                <label>
                  Purpose
                  <textarea value={newAppDescription} placeholder="Optional: What will this app use Memact for?" onChange={(event) => setNewAppDescription(event.target.value)} />
                </label>
                <div>
                  <p className="eyebrow">Activity categories</p>
                  <p className="muted">Pick the kinds of activity this app is allowed to work with. This keeps apps narrow by design.</p>
                  <CategoryGrid
                    categories={categories}
                    selected={newAppCategories}
                    onToggle={(category) => toggleValue(setNewAppCategories, category)}
                  />
                </div>
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
            <section id="permissions-panel" className="panel">
              <div className="section-head">
                <div className="section-copy">
                  <p className="eyebrow">Permissions</p>
                  <h2>Choose what this app can ask Memact to do.</h2>
                  <p className="muted">
                    {selectedConsent
                      ? consentChanged ? "Permissions changed. Save them before creating the next key." : "Permissions are saved for this app. Change scopes or categories any time."
                      : "Save permissions before creating a usable API key."}
                  </p>
                </div>
                <div className="actions section-actions">
                  <span className="tooltip-wrap" title={permissionsHint || undefined}>
                    <button type="button" className="ghost" disabled={!selectedAppId || !selectedScopes.length || !selectedCategories.length} onClick={onGrantConsent}>Save permissions</button>
                  </span>
                  <span className="tooltip-wrap" title={createKeyHint || undefined}>
                    <button type="button" disabled={!canCreateKey} onClick={onCreateKey}>Create API key</button>
                  </span>
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
              <div className="category-section">
                <p className="eyebrow">Activity categories</p>
                <p className="muted">An app can only work inside the selected categories. A news app can stay on news; an AI-conversation app can stay on AI tools.</p>
                <CategoryGrid
                  categories={categories}
                  selected={selectedCategories}
                  onToggle={(category) => toggleValue(setSelectedCategories, category)}
                />
              </div>
            </section>

            <section id="api-keys-panel" className="panel">
              <p className="eyebrow">API keys</p>
              <div className="stack">
                {selectedKeys.length ? selectedKeys.map((key) => (
                  <div className="list-card" key={key.id}>
                    <span>
                      <strong>{key.name}</strong>
                      <small>{key.key_prefix}... | {key.revoked_at ? "revoked" : "active"}</small>
                      <small>{formatListLabels(categories, key.categories || [])}</small>
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
        <section id="one-time-key-panel" className="panel key-panel">
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
            <pre><code>{buildEmbedCode(oneTimeKey, oneTimeKeyScopes, oneTimeKeyCategories, selectedApp)}</code></pre>
          </div>
          <p className="muted">Memact stores only a hash. This raw key cannot be shown again.</p>
        </section>
      ) : null}

    </section>
  )
}

function CategoryGrid({ categories, selected, onToggle }) {
  const entries = Object.entries(categories || {})
  if (!entries.length) return <p className="muted">Activity category policy is loading.</p>
  return (
    <div className="category-grid">
      {entries.map(([category, definition]) => (
        <label key={category} className="scope-card category-card">
          <input
            type="checkbox"
            checked={selected.includes(category)}
            onChange={() => onToggle(category)}
          />
          <span>
            <strong>{definition.label || category}</strong>
            <small>{definition.description || category}</small>
          </span>
        </label>
      ))}
    </div>
  )
}

function ConnectPage({ connectRequest, connectDetails, loading, notice, onApprove, onCancel }) {
  const app = connectDetails?.app
  const scopes = connectDetails?.scopes || {}
  const categories = connectDetails?.activity_categories || {}
  const requestedScopes = connectDetails?.requested_scopes || connectRequest?.scopes || []
  const requestedCategories = connectDetails?.requested_categories || connectRequest?.categories || []
  const appName = app?.name || "this app"

  return (
    <section className="connect-shell">
      <article className="panel connect-card">
        <p className="eyebrow">Connect app</p>
        <h1>Connect {appName} to Memact.</h1>
        {app?.developer_url ? (
          <p className="muted">Developer website: <a href={app.developer_url} target="_blank" rel="noreferrer">{app.developer_url}</a></p>
        ) : null}
        <p className="muted">
          This app will only receive the Memact permissions and activity categories you approve. You can disconnect it later from Memact Access.
        </p>

        {loading === "loading" ? <p className="status-line">Loading app details.</p> : null}
        {notice ? <p className="success" role="status">{notice}</p> : null}

        <div className="connect-grid">
          <section className="permission-list">
            <p className="eyebrow">Permissions</p>
            {requestedScopes.length ? requestedScopes.map((scope) => (
              <div className="mini-row" key={scope}>
                <strong>{scopeLabel(scopes, scope)}</strong>
                <small>{scopes[scope]?.description || scope}</small>
              </div>
            )) : <p className="muted">No permissions requested.</p>}
          </section>
          <section className="permission-list">
            <p className="eyebrow">Activity categories</p>
            {requestedCategories.length ? requestedCategories.map((category) => (
              <div className="mini-row" key={category}>
                <strong>{categoryLabel(categories, category)}</strong>
                <small>{categories[category]?.description || category}</small>
              </div>
            )) : <p className="muted">No categories requested.</p>}
          </section>
        </div>

        <section className="permission-list">
          <p className="eyebrow">Safety boundary</p>
          <div className="mini-row">
            <strong>No raw memory dump by default.</strong>
            <small>Memact verifies the app, user permission, requested scopes, and selected categories before allowing access.</small>
          </div>
          <div className="mini-row">
            <strong>Blocked uses stay blocked.</strong>
            <small>Apps may not use Memact for surveillance, selling raw personal memory, manipulative targeting, or sensitive eligibility decisions.</small>
          </div>
        </section>

        <div className="connect-actions">
          <button type="button" onClick={onApprove} disabled={!app?.id || loading === "approve"}>
            {loading === "approve" ? "Connecting..." : "Connect App"}
          </button>
          <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </article>
    </section>
  )
}

function HelpPanel() {
  const faqs = [
    {
      question: "What is Memact?",
      answer: "Memact is infrastructure for turning allowed digital activity into useful schema memory: evidence, nodes, edges, and summaries that apps can use with permission."
    },
    {
      question: "Does an app get my whole memory graph?",
      answer: "No. Apps get only the permissions and activity categories you approve. Raw graph access is a separate sensitive permission."
    },
    {
      question: "What are activity categories?",
      answer: "They narrow where an app can work. A propaganda detector can ask for news articles. A study app can ask for research pages. An AI-conversation app can ask for AI assistant activity."
    },
    {
      question: "What does Connect App do?",
      answer: "It works like Discord authorization. The app sends you to Memact, you review permissions, and Memact creates a connection only if you approve."
    },
    {
      question: "What is a schema packet?",
      answer: "A schema packet is a small knowledge-graph memory bundle: evidence, content units, nodes, edges, and a summary of what the activity seems to represent."
    },
    {
      question: "What is not allowed?",
      answer: "Apps should not sell raw memory, watch users without permission, manipulate people, or use Memact for credit, employment, insurance, housing, or sensitive targeting decisions."
    }
  ]

  return (
    <section className="panel help-panel">
      <p className="eyebrow">Help</p>
      <h2>Memact in plain words.</h2>
      <p className="muted">
        Memact gives apps a permissioned way to create useful memory from activity. The user stays in control of what the app can ask Memact to do.
      </p>
      <div className="faq-grid">
        {faqs.map((faq) => (
          <article className="mini-row" key={faq.question}>
            <strong>{faq.question}</strong>
            <small>{faq.answer}</small>
          </article>
        ))}
      </div>
    </section>
  )
}

async function refreshDashboard(client, session, setUser, setApps, setApiKeys, setConsents, setStatus, setError, setCanRetryDashboard) {
  setCanRetryDashboard(false)
  try {
    const [me, dashboard] = await Promise.all([
      client.me(session),
      client.dashboard(session)
    ])
    setUser(me.user)
    setApps(dashboard.apps || [])
    setApiKeys(dashboard.api_keys || [])
    setConsents(dashboard.consents || [])
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
      message: ACCESS_MODE === "supabase" ? "Could not reach Supabase Access. Check the Website env vars and project settings." : "Could not reach Access. Make sure it is running.",
      status: ACCESS_MODE === "supabase" ? "Supabase Access offline." : "Access offline."
    }
  }
  if (error instanceof AccessApiError) {
    if (error.status === 401) return { message: "Please sign in again.", status: "Login expired." }
    if (error.status === 403) return { message: "Access denied for this dashboard.", status: "Access denied." }
    if (error.status === 409) return { message: "This app already exists.", status: "Dashboard sync failed." }
    if (error.status >= 500) return { message: ACCESS_MODE === "supabase" ? "Supabase Access needs the SQL migration or project setup." : "Access service had a server error. Check Access logs.", status: "Dashboard sync failed." }
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

function passwordLoginErrorMessage(error) {
  const message = String(error?.message || "")
  if (/invalid login credentials/i.test(message)) {
    return "Email or password did not match. You can use the email link if this is your first login."
  }
  return message || "Password login did not finish."
}

function passwordSetupErrorMessage(error) {
  const message = String(error?.message || "")
  if (/same password/i.test(message)) {
    return "Choose a new password that is different from the last one."
  }
  if (/password/i.test(message) && /weak|short|strength/i.test(message)) {
    return "Use a stronger password before saving it."
  }
  return message || "Password setup did not finish."
}

function shouldOfferPasswordSetup(user) {
  if (!user) return false
  const provider = user.app_metadata?.provider || user.identities?.[0]?.provider || "email"
  if (provider !== "email") return false
  return !Boolean(user.user_metadata?.memact_password_ready)
}

function shouldOpenAccountTab(user, isRecoveryFlow) {
  return isRecoveryFlow || shouldOfferPasswordSetup(user)
}

function detectAuthFlowFromUrl() {
  if (typeof window === "undefined") return "default"
  const query = `${window.location.search || ""}${window.location.hash || ""}`.toLowerCase()
  if (query.includes("type=recovery")) return "recovery"
  return "default"
}

function isConnectPath() {
  return typeof window !== "undefined" && window.location.pathname === "/connect"
}

function parseConnectRequest() {
  if (typeof window === "undefined") {
    return { app_id: "", scopes: [], categories: [], redirect_uri: "", state: "" }
  }
  const params = new URLSearchParams(window.location.search)
  return {
    app_id: params.get("app_id") || "",
    scopes: parseListParam(params.get("scopes")),
    categories: parseListParam(params.get("categories")),
    redirect_uri: params.get("redirect_uri") || "",
    state: params.get("state") || ""
  }
}

function parseListParam(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function getAuthRedirectTarget() {
  if (isConnectPath()) {
    return window.location.href
  }
  return getAuthRedirectUrl()
}

function buildConnectRedirect(redirectUri, values) {
  try {
    const url = new URL(redirectUri)
    Object.entries(values || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value)
      }
    })
    return url.toString()
  } catch {
    return "/dashboard"
  }
}

function getPasswordState(password, confirmPassword) {
  const checks = [
    { label: "At least 12 characters", ok: password.length >= 12 },
    { label: "One uppercase letter", ok: /[A-Z]/.test(password) },
    { label: "One lowercase letter", ok: /[a-z]/.test(password) },
    { label: "One number", ok: /\d/.test(password) },
    { label: "One special character", ok: /[^A-Za-z0-9]/.test(password) },
    { label: "Passwords match", ok: password.length > 0 && password === confirmPassword }
  ]
  const passedCount = checks.filter((check) => check.ok).length
  const percent = Math.round((passedCount / checks.length) * 100)
  const level = percent >= 100 ? "strong" : percent >= 67 ? "good" : percent >= 34 ? "fair" : "weak"
  const label = level === "strong" ? "Strong password" : level === "good" ? "Good password" : level === "fair" ? "Needs more strength" : "Weak password"
  const errors = checks.filter((check) => !check.ok).map((check) => check.label)
  return {
    checks,
    percent,
    level,
    label,
    errors,
    canSubmit: errors.length === 0
  }
}

function sameValues(first = [], second = []) {
  const firstList = [...first].sort()
  const secondList = [...second].sort()
  return firstList.length === secondList.length && firstList.every((value, index) => value === secondList[index])
}

function toggleValue(setter, value) {
  setter((current) => current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value])
}

function scopeLabel(scopes, scope) {
  return scopes?.[scope]?.label || scope
}

function categoryLabel(categories, category) {
  return categories?.[category]?.label || category
}

function formatListLabels(definitions, values = []) {
  const labels = values.map((value) => definitions?.[value]?.label || value)
  return labels.length ? labels.join(", ") : "No categories"
}

function scrollElementIntoView(id) {
  if (typeof window === "undefined") return
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    })
  })
}

function buildEmbedCode(apiKey, scopes = [], categories = [], app = null) {
  const appId = app?.id || "app_id_from_memact_portal"
  const redirectUrl = app?.redirect_urls?.[0] || app?.developer_url || "https://your-app.example.com/memact/callback"
  const connectUrl = buildPortalConnectUrl(appId, scopes, categories, redirectUrl)
  if (ACCESS_MODE === "supabase") {
    const accessUrl = SUPABASE_URL || "https://memact.supabase.co"
    const publicKey = SUPABASE_ANON_KEY || "MEMACT_PUBLIC_ACCESS_KEY"
    return `// 1. Put this URL behind your own "Connect Memact" button.
const memactConnectUrl = "${connectUrl}";

// 2. After the user approves, Memact redirects back with ?connected=1&connection_id=...
const memactConnectionId = "connection_id_from_connect_redirect";

// 3. Verify the API key, user connection, scopes, and activity categories before doing work.
const MEMACT_ACCESS_URL = "${accessUrl}";
const MEMACT_PUBLIC_ACCESS_KEY = "${publicKey}";
const memactApiKey = "${apiKey || "mka_key_shown_once"}";
const requiredScopes = ${JSON.stringify(scopes, null, 2)};
const activityCategories = ${JSON.stringify(categories, null, 2)};

const response = await fetch(\`\${MEMACT_ACCESS_URL}/rest/v1/rpc/memact_verify_api_key\`, {
  method: "POST",
  headers: {
    "apikey": MEMACT_PUBLIC_ACCESS_KEY,
    "Authorization": \`Bearer \${MEMACT_PUBLIC_ACCESS_KEY}\`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    api_key_input: memactApiKey,
    required_scopes_input: requiredScopes,
    activity_categories_input: activityCategories,
    consent_id_input: memactConnectionId
  })
});

const access = await response.json();
if (!access?.allowed) {
  throw new Error(access?.error?.message || "Memact access denied.");
}

console.log("Memact access granted", {
  app: access.app?.name,
  scopes: access.scopes,
  categories: access.categories
});

// 4. Topic-wise integration examples.
// Capture: pass only allowed activity from these categories into your Capture adapter.
// Schema: write schema packets with evidence, nodes, and edges, not raw private dumps.
// Memory: request summaries/evidence/graph objects only if the approved scopes include them.`
  }

  return `import { createMemactCaptureClient } from "./memact-capture-client.mjs";

const memact = createMemactCaptureClient({
  accessUrl: "${ACCESS_URL}",
  apiKey: "${apiKey || "mka_key_shown_once"}"
});

const { snapshot } = await memact.getLocalSnapshot({
  scopes: ${JSON.stringify(scopes, null, 2)},
  categories: ${JSON.stringify(categories, null, 2)},
  connectionId: "connection_id_from_connect_redirect"
});

console.log(snapshot.counts);`
}

function buildPortalConnectUrl(appId, scopes = [], categories = [], redirectUrl = "") {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://memact.com"
  const url = new URL("/connect", origin)
  url.searchParams.set("app_id", appId)
  if (scopes.length) url.searchParams.set("scopes", scopes.join(","))
  if (categories.length) url.searchParams.set("categories", categories.join(","))
  if (redirectUrl) url.searchParams.set("redirect_uri", redirectUrl)
  return url.toString()
}

createRoot(document.getElementById("root")).render(<App />)
