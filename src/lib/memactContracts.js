export const MEMACT_CONTRACT_VERSION = '0.1.0'
export const MEMACT_EXPLANATION_VERSION = '0.1.0'

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function nowIso() {
  return new Date().toISOString()
}

function asCount(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function compactArray(value, limit = 8) {
  return (Array.isArray(value) ? value : []).slice(0, limit)
}

function sourceFromCandidate(candidate) {
  const firstSource = candidate?.sources?.[0] || {}
  return {
    id: normalize(candidate?.id),
    label: normalize(candidate?.source_label),
    score: Number(candidate?.score || 0),
    url: normalize(firstSource.url),
    title: normalize(firstSource.title || candidate?.source_label),
    domain: normalize(firstSource.domain),
    occurred_at: normalize(firstSource.occurred_at || firstSource.started_at),
    overlapping_terms: compactArray(candidate?.overlapping_terms, 12),
    canonical_themes: compactArray(candidate?.canonical_themes, 12),
  }
}

export function createRuntimeContext({
  environment = {},
  mode = 'unknown',
  surface = 'website',
  capabilities = {},
} = {}) {
  return {
    contract: 'memact.runtime_context',
    version: MEMACT_CONTRACT_VERSION,
    generated_at: nowIso(),
    surface,
    mode,
    platform: {
      mobile: Boolean(environment.mobile),
      extension_capable: Boolean(environment.extensionCapable),
      standalone: Boolean(environment.standalone),
    },
    capabilities: {
      local_capture: mode === 'extension',
      local_web_memory: mode === 'web-fallback',
      android_client_ready: true,
      api_explanation_ready: true,
      deterministic_evidence_required: true,
      ...capabilities,
    },
  }
}

export function createKnowledgeEnvelope({
  snapshot,
  inference,
  memory,
  schema,
  influence,
  suggestionSeed = [],
} = {}) {
  const safeSnapshot = snapshot && typeof snapshot === 'object'
    ? snapshot
    : { events: [], sessions: [], activities: [] }

  return {
    contract: 'memact.knowledge_envelope',
    version: MEMACT_CONTRACT_VERSION,
    generated_at: nowIso(),
    source: {
      system: 'capture',
      schema_version: safeSnapshot.schema_version || 1,
      generated_at: safeSnapshot.generated_at || null,
    },
    snapshot: safeSnapshot,
    inference,
    memory,
    schema,
    influence,
    packetNetwork: inference?.packet_network || { nodes: [], edges: [] },
    schemaNetwork: schema?.schema_network || { nodes: [], edges: [] },
    suggestionSeed,
    stats: {
      eventCount: asCount(safeSnapshot?.counts?.events || safeSnapshot?.events?.length),
      activityCount: asCount(safeSnapshot?.counts?.activities || safeSnapshot?.activities?.length),
      sessionCount: asCount(safeSnapshot?.counts?.sessions || safeSnapshot?.sessions?.length),
      meaningfulActivityCount: asCount(inference?.source?.meaningful_activity_count || inference?.records?.length),
      skippedActivityCount: asCount(inference?.source?.skipped_activity_count || inference?.skipped_records?.length),
      memoryCount: asCount(memory?.stats?.memoryCount || memory?.memories?.length),
      activityMemoryCount: asCount(memory?.stats?.activityMemoryCount || memory?.activity_memories?.length),
      schemaMemoryCount: asCount(memory?.stats?.schemaMemoryCount || memory?.schema_packets?.length),
      schemaCount: asCount(schema?.schemas?.length),
      influenceCount: asCount(influence?.valid_chains?.length),
    },
  }
}

export function createApiExplanationRequest({
  query,
  origin,
  relevantSchemas,
  relevantCognitiveSchemas,
  relevantMemories,
  relevantInfluence,
  answer,
  knowledge,
} = {}) {
  return {
    contract: 'memact.api_explanation_request',
    version: MEMACT_EXPLANATION_VERSION,
    generated_at: nowIso(),
    query: normalize(query),
    policy: {
      ai_role: 'short_answer_from_minimal_schema_packet',
      deterministic_reasoning_done: true,
      cloud_payload_minimized: true,
      must_not_invent_sources: true,
      must_not_claim_causality: true,
      must_preserve_uncertainty: true,
    },
    deterministic_answer: answer || null,
    evidence: {
      origin_sources: compactArray(origin?.candidates, 6).map(sourceFromCandidate),
      schema_signals: compactArray(relevantSchemas, 4).map((item) => ({
        id: normalize(item?.id),
        label: normalize(item?.label),
        state: normalize(item?.state),
        summary: normalize(item?.summary),
        matched_themes: compactArray(item?.matched_themes, 10),
      })),
      memory_signals: compactArray(relevantMemories, 5).map((item) => ({
        id: normalize(item?.id),
        type: normalize(item?.type),
        label: normalize(item?.label),
        summary: normalize(item?.summary),
        strength: Number(item?.strength || 0),
        retrieval_score: Number(item?.retrieval_score || 0),
        themes: compactArray(item?.themes, 10),
        sources: compactArray(item?.sources, 4).map((source) => ({
          title: normalize(source?.title),
          domain: normalize(source?.domain),
          url: normalize(source?.url),
        })),
      })),
      cognitive_schema_memories: compactArray(relevantCognitiveSchemas, 4).map((item) => ({
        id: normalize(item?.id),
        label: normalize(item?.label),
        summary: normalize(item?.summary),
        core_interpretation: normalize(item?.core_interpretation),
        action_tendency: normalize(item?.action_tendency),
        emotional_signature: compactArray(item?.emotional_signature, 6),
        marker_categories: compactArray(item?.marker_categories, 6),
        formation_metrics: item?.formation_metrics || {},
        strength: Number(item?.strength || 0),
        retrieval_score: Number(item?.retrieval_score || 0),
        support: asCount(item?.support),
        themes: compactArray(item?.themes, 10),
        evidence_packet_ids: compactArray(item?.evidence_packet_ids, 10),
      })),
      influence_signals: compactArray(relevantInfluence, 4).map((chain) => ({
        from: normalize(chain?.from),
        to: normalize(chain?.to),
        count: asCount(chain?.count),
        confidence: Number(chain?.confidence || 0),
        summary: normalize(chain?.summary),
      })),
    },
    stats: knowledge?.stats || {},
  }
}

export function createThoughtExplanationEnvelope({
  query,
  origin,
  relevantSchemas,
  relevantCognitiveSchemas,
  relevantMemories,
  relevantInfluence,
  answer,
  knowledge,
} = {}) {
  const apiExplanationRequest = createApiExplanationRequest({
    query,
    origin,
    relevantSchemas,
    relevantCognitiveSchemas,
    relevantMemories,
    relevantInfluence,
    answer,
    knowledge,
  })

  return {
    contract: 'memact.thought_explanation',
    version: MEMACT_EXPLANATION_VERSION,
    generated_at: nowIso(),
    query: normalize(query),
    deterministic: true,
    answer: answer || null,
    origin,
    relevantSchemas,
    relevantCognitiveSchemas,
    relevantMemories,
    relevantInfluence,
    apiExplanationRequest,
  }
}
