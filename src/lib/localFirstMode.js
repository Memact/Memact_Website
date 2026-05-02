function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function envValue(env, key) {
  return env && Object.prototype.hasOwnProperty.call(env, key) ? env[key] : ''
}

function runtimeEnv() {
  return typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
}

export function isLocalFirstMode(env = runtimeEnv()) {
  const explicit = normalize(envValue(env, 'VITE_MEMACT_LOCAL_FIRST'))
  const mode = normalize(envValue(env, 'VITE_MEMACT_AI_MODE') || 'fallback')
  return explicit === '1' || explicit === 'true' || explicit === 'yes' || mode === 'local'
}

export function isCloudAiAllowed(env = runtimeEnv()) {
  const mode = normalize(envValue(env, 'VITE_MEMACT_AI_MODE') || 'fallback')
  const cloud = normalize(envValue(env, 'VITE_MEMACT_CLOUD_AI'))
  if (isLocalFirstMode(env)) return false
  if (mode === 'off' || cloud === 'off' || cloud === 'false' || cloud === '0') return false
  return true
}

export function getMemactRuntimeMode(env = runtimeEnv()) {
  return {
    local_first: isLocalFirstMode(env),
    cloud_ai_allowed: isCloudAiAllowed(env),
    cloud_ai_role: isCloudAiAllowed(env)
      ? 'assist wording after deterministic evidence retrieval'
      : 'disabled; deterministic local evidence path only',
    local_capabilities: [
      'capture bridge',
      'durable browser memory',
      'lexical retrieval',
      'graph evidence cards',
      'survey self-report memory',
      'deterministic answer fallback',
    ],
  }
}
