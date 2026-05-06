export const ACCESS_URL = import.meta.env.VITE_MEMACT_ACCESS_URL || "http://127.0.0.1:8787"
const SESSION_KEY = "memact.access.session"

export function getSessionToken() {
  return localStorage.getItem(SESSION_KEY) || ""
}

export function setSessionToken(token) {
  if (token) {
    localStorage.setItem(SESSION_KEY, token)
  } else {
    localStorage.removeItem(SESSION_KEY)
  }
}

export class AccessApiError extends Error {
  constructor(status, message, code = "request_failed", raw = null) {
    super(message || "Request failed.")
    this.name = "AccessApiError"
    this.status = status
    this.code = code
    this.raw = raw
  }
}

export class AccessClient {
  constructor(baseUrl) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "")
  }

  health() {
    return this.get("/health")
  }

  policy() {
    return this.get("/v1/policy")
  }

  signup(body) {
    return this.post("/v1/auth/signup", body)
  }

  signin(body) {
    return this.post("/v1/auth/signin", body)
  }

  me(session) {
    return this.get("/v1/me", session)
  }

  apps(session) {
    return this.get("/v1/apps", session)
  }

  createApp(session, body) {
    return this.post("/v1/apps", body, session)
  }

  apiKeys(session) {
    return this.get("/v1/api-keys", session)
  }

  createApiKey(session, body) {
    return this.post("/v1/api-keys", body, session)
  }

  revokeApiKey(session, keyId) {
    return this.post("/v1/api-keys/revoke", { key_id: keyId }, session)
  }

  consents(session) {
    return this.get("/v1/consents", session)
  }

  grantConsent(session, body) {
    return this.post("/v1/consents", body, session)
  }

  verifyApiKey(apiKey, requiredScopes = []) {
    return this.request("/v1/access/verify", {
      method: "POST",
      apiKey,
      body: { required_scopes: requiredScopes }
    })
  }

  async get(path, session = "") {
    return this.request(path, { method: "GET", session })
  }

  async post(path, body, session = "") {
    return this.request(path, { method: "POST", session, body })
  }

  async request(path, { method, session = "", apiKey = "", body } = {}) {
    const headers = { "Content-Type": "application/json" }
    if (session) headers.Authorization = `Bearer ${session}`
    if (apiKey) headers["X-Memact-API-Key"] = apiKey
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })
    const text = await response.text()
    const data = parseResponseBody(text)
    if (!response.ok) {
      const errorPayload = data && typeof data === "object" ? data.error : null
      throw new AccessApiError(
        response.status,
        errorPayload?.message || response.statusText || "Request failed.",
        errorPayload?.code || "request_failed",
        data
      )
    }
    return data && typeof data === "object" ? data : {}
  }
}

function parseResponseBody(text) {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
