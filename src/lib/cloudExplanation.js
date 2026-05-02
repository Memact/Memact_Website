import { isCloudAiAllowed } from './localFirstMode.js'
import { filterCloudPayloadForPrivacy } from './privacyFilter.js'

const MAX_SOURCES = 4
const MAX_MEMORY_SIGNALS = 5
const MAX_SCHEMA_SIGNALS = 3
const MAX_INFLUENCE_SIGNALS = 3

function normalize(value, maxLength = 0) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return ''
  if (maxLength && text.length > maxLength) {
    return `${text.slice(0, maxLength - 3).trim()}...`
  }
  return text
}

function compactArray(value, limit) {
  return (Array.isArray(value) ? value : []).slice(0, limit)
}

function cleanAnswerMeta(value) {
  if (!value || typeof value !== 'object') return null
  return {
    overview: normalize(value.overview, 140),
    answer: normalize(value.answer, 180),
    summary: normalize(value.summary, 360),
    signals: compactArray(value.signals, 5).map((item) => normalize(item, 120)).filter(Boolean),
    detailItems: compactArray(value.detailItems, 5)
      .map((item) => ({
        label: normalize(item?.label, 40),
        value: normalize(item?.value, 80),
      }))
      .filter((item) => item.label && item.value),
  }
}

function cleanSource(result) {
  return {
    title: normalize(result?.title, 140),
    domain: normalize(result?.domain, 80),
    url: normalize(result?.url, 260),
    source_type: normalize(result?.source, 40),
    summary:
      normalize(result?.structuredSummary, 240) ||
      normalize(result?.displayExcerpt, 240) ||
      normalize(result?.snippet, 240),
    themes: compactArray(result?.contextTopics, 6).map((item) => normalize(item, 48)).filter(Boolean),
  }
}

function cleanExplanationRequest(explanationRequest = {}) {
  const evidence = explanationRequest.evidence || {}

  return {
    contract: normalize(explanationRequest.contract, 80),
    version: normalize(explanationRequest.version, 24),
    query: normalize(explanationRequest.query, 180),
    policy: {
      ai_role: 'short_answer_from_minimal_schema_packet',
      deterministic_reasoning_done: true,
      cloud_payload_minimized: true,
      must_not_invent_sources: true,
      must_not_claim_causality: true,
      must_preserve_uncertainty: true,
    },
    deterministic_answer: cleanAnswerMeta(explanationRequest.deterministic_answer),
    evidence: {
      origin_sources: compactArray(evidence.origin_sources, MAX_SOURCES).map((item) => ({
        label: normalize(item?.label, 140),
        title: normalize(item?.title, 140),
        domain: normalize(item?.domain, 80),
        url: normalize(item?.url, 260),
        score: Number(item?.score || 0),
        overlapping_terms: compactArray(item?.overlapping_terms, 10)
          .map((term) => normalize(term, 40))
          .filter(Boolean),
        canonical_themes: compactArray(item?.canonical_themes, 8)
          .map((theme) => normalize(theme, 40))
          .filter(Boolean),
      })),
      schema_signals: compactArray(evidence.schema_signals, MAX_SCHEMA_SIGNALS).map((item) => ({
        label: normalize(item?.label, 120),
        state: normalize(item?.state, 60),
        summary: normalize(item?.summary, 220),
        matched_themes: compactArray(item?.matched_themes, 8)
          .map((theme) => normalize(theme, 40))
          .filter(Boolean),
      })),
      memory_signals: compactArray(evidence.memory_signals, MAX_MEMORY_SIGNALS).map((item) => ({
        id: normalize(item?.id, 120),
        type: normalize(item?.type, 60),
        label: normalize(item?.label, 140),
        summary: normalize(item?.summary, 220),
        strength: Number(item?.strength || 0),
        retrieval_score: Number(item?.retrieval_score || 0),
        themes: compactArray(item?.themes, 8)
          .map((theme) => normalize(theme, 40))
          .filter(Boolean),
        sources: compactArray(item?.sources, 3).map((source) => ({
          title: normalize(source?.title, 120),
          domain: normalize(source?.domain, 80),
          url: normalize(source?.url, 220),
        })),
      })),
      cognitive_schema_memories: compactArray(evidence.cognitive_schema_memories, MAX_SCHEMA_SIGNALS).map((item) => ({
        id: normalize(item?.id, 120),
        label: normalize(item?.label, 140),
        summary: normalize(item?.summary, 220),
        core_interpretation: normalize(item?.core_interpretation, 220),
        action_tendency: normalize(item?.action_tendency, 180),
        emotional_signature: compactArray(item?.emotional_signature, 5)
          .map((value) => normalize(value, 50))
          .filter(Boolean),
        marker_categories: compactArray(item?.marker_categories, 5)
          .map((value) => normalize(value, 40))
          .filter(Boolean),
        strength: Number(item?.strength || 0),
        retrieval_score: Number(item?.retrieval_score || 0),
        support: Number(item?.support || 0),
        themes: compactArray(item?.themes, 8)
          .map((theme) => normalize(theme, 40))
          .filter(Boolean),
        evidence_packet_ids: compactArray(item?.evidence_packet_ids, 8)
          .map((id) => normalize(id, 80))
          .filter(Boolean),
      })),
      rag_context: evidence.rag_context
        ? {
            contract: normalize(evidence.rag_context.contract, 80),
            version: normalize(evidence.rag_context.version, 24),
            policy: evidence.rag_context.policy || {},
            retrieval_steps: compactArray(evidence.rag_context.retrieval_steps, 6)
              .map((step) => normalize(step, 90))
              .filter(Boolean),
            memory_lanes: {
              cognitive_schema: compactArray(evidence.rag_context.memory_lanes?.cognitive_schema, 3).map((item) => ({
                label: normalize(item?.label, 120),
                strength: Number(item?.strength || 0),
                retrieval_score: Number(item?.retrieval_score || 0),
              })),
              activity: compactArray(evidence.rag_context.memory_lanes?.activity, 3).map((item) => ({
                label: normalize(item?.label, 120),
                strength: Number(item?.strength || 0),
                retrieval_score: Number(item?.retrieval_score || 0),
              })),
              relation: compactArray(evidence.rag_context.memory_lanes?.relation, 5).map((item) => ({
                type: normalize(item?.type, 60),
                from: normalize(item?.from, 120),
                to: normalize(item?.to, 120),
                weight: Number(item?.weight || 0),
              })),
            },
            relation_trails: compactArray(evidence.rag_context.relation_trails, 6).map((relation) => ({
              type: normalize(relation?.type, 60),
              category: normalize(relation?.category, 60),
              from: normalize(relation?.from, 120),
              to: normalize(relation?.to, 120),
              weight: Number(relation?.weight || 0),
              confidence: Number(relation?.confidence || 0),
              reason: normalize(relation?.reason, 160),
            })),
            context_items: compactArray(evidence.rag_context.context_items, 6).map((item) => ({
              id: normalize(item?.id, 120),
              type: normalize(item?.type, 60),
              label: normalize(item?.label, 140),
              summary: normalize(item?.summary, 220),
              core_interpretation: normalize(item?.core_interpretation, 220),
              action_tendency: normalize(item?.action_tendency, 180),
              retrieval_score: Number(item?.retrieval_score || 0),
              strength: Number(item?.strength || 0),
              themes: compactArray(item?.themes, 8).map((theme) => normalize(theme, 40)).filter(Boolean),
              evidence_packet_ids: compactArray(item?.evidence_packet_ids, 8).map((id) => normalize(id, 80)).filter(Boolean),
            })),
            sources: compactArray(evidence.rag_context.sources, 4).map((source) => ({
              title: normalize(source?.title, 120),
              domain: normalize(source?.domain, 80),
              url: normalize(source?.url, 220),
            })),
          }
        : null,
      influence_signals: compactArray(evidence.influence_signals, MAX_INFLUENCE_SIGNALS).map((chain) => ({
        from: normalize(chain?.from, 80),
        to: normalize(chain?.to, 80),
        count: Number(chain?.count || 0),
        confidence: Number(chain?.confidence || 0),
        summary: normalize(chain?.summary, 220),
      })),
    },
    stats: {
      eventCount: Number(explanationRequest.stats?.eventCount || 0),
      schemaCount: Number(explanationRequest.stats?.schemaCount || 0),
      memoryCount: Number(explanationRequest.stats?.memoryCount || 0),
      influenceCount: Number(explanationRequest.stats?.influenceCount || 0),
    },
  }
}

function buildPayload({ query, explanation, answerMeta, results }) {
  const request =
    explanation?.apiExplanationRequest ||
    {
      query,
      deterministic_answer: answerMeta,
      evidence: {},
      stats: {},
    }

  return {
    query: normalize(query, 180),
    request: cleanExplanationRequest(request),
    sources: compactArray(results, MAX_SOURCES).map(cleanSource).filter((source) => source.title || source.url),
  }
}

function normalizeCloudResponse(value) {
  if (!value || typeof value !== 'object') return null
  const answer = value.answer || value

  return {
    overview: normalize(answer.overview, 140),
    answer: normalize(answer.answer, 180),
    summary: normalize(answer.summary, 360),
    provider: normalize(value.provider || 'gemini', 40),
    model: normalize(value.model || 'gemini-2.5-flash', 80),
    applied: Boolean(value.applied ?? answer.summary),
  }
}

export async function requestCloudExplanation({ query, explanation, answerMeta, results }) {
  const endpoint = normalize(import.meta.env.VITE_MEMACT_GEMINI_ENDPOINT)
  if (!endpoint || !answerMeta || !isCloudAiAllowed()) {
    return null
  }

  const payload = filterCloudPayloadForPrivacy(buildPayload({ query, explanation, answerMeta, results }))

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return null
    }

    return normalizeCloudResponse(await response.json())
  } catch {
    return null
  }
}

function followUpEndpoint() {
  const explicit = normalize(import.meta.env.VITE_MEMACT_GEMINI_FOLLOWUP_ENDPOINT)
  if (explicit) return explicit

  const answerEndpoint = normalize(import.meta.env.VITE_MEMACT_GEMINI_ENDPOINT)
  if (!answerEndpoint) return ''

  if (answerEndpoint.includes('/api/gemini-answer')) {
    return answerEndpoint.replace('/api/gemini-answer', '/api/gemini-followups')
  }

  return ''
}

function historyTitleEndpoint() {
  const explicit = normalize(import.meta.env.VITE_MEMACT_GEMINI_HISTORY_TITLE_ENDPOINT)
  if (explicit) return explicit

  const answerEndpoint = normalize(import.meta.env.VITE_MEMACT_GEMINI_ENDPOINT)
  if (!answerEndpoint) return ''

  if (answerEndpoint.includes('/api/gemini-answer')) {
    return answerEndpoint.replace('/api/gemini-answer', '/api/gemini-history-title')
  }

  return ''
}

function normalizeFollowUpQuestions(value) {
  const questions = Array.isArray(value?.questions) ? value.questions : []
  return questions
    .map((question, index) => ({
      id: normalize(question?.id, 48) || `ai-${index + 1}`,
      title: normalize(question?.title, 96),
      options: compactArray(question?.options, 4)
        .map((option, optionIndex) => ({
          id: normalize(option?.id, 48) || `option-${optionIndex + 1}`,
          label: normalize(option?.label || option, 64),
        }))
        .filter((option) => option.label),
    }))
    .filter((question) => question.title && question.options.length >= 2)
    .slice(0, 3)
}

function normalizeHistoryTitle(value) {
  const raw = typeof value === 'string' ? value : value?.title
  return normalize(raw, 56)
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[?.!]+$/g, '')
}

export async function requestCloudFollowUpQuestions({
  query,
  mode = 'prompt',
  reason = 'weak_context',
  round = 0,
  avoidQuestions = [],
}) {
  const endpoint = followUpEndpoint()
  if (!endpoint || !isCloudAiAllowed()) {
    return []
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query: normalize(query, 180),
        mode: normalize(mode, 40),
        reason: normalize(reason, 80),
        round: Number(round) || 0,
        avoid_questions: compactArray(avoidQuestions, 8)
          .map((question) => normalize(question, 96))
          .filter(Boolean),
      }),
    })

    if (!response.ok) {
      return []
    }

    return normalizeFollowUpQuestions(await response.json())
  } catch {
    return []
  }
}

export async function requestCloudHistoryTitle({
  mode = 'prompt',
  query,
  candidateTitle = '',
  packet = null,
}) {
  const endpoint = historyTitleEndpoint()
  if (!endpoint || !isCloudAiAllowed() || normalize(mode).toLowerCase() !== 'survey') {
    return ''
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mode: normalize(mode, 40),
        query: normalize(query, 180),
        candidate_title: normalize(candidateTitle, 80),
        packet,
      }),
    })

    if (!response.ok) {
      return ''
    }

    return normalizeHistoryTitle(await response.json())
  } catch {
    return ''
  }
}
