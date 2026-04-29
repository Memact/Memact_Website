const SURVEY_PACKET_KEY = 'memact.survey-packets'

const DEFAULT_TOPICS = [
  { id: 'research', label: 'Research direction', source: 'starter' },
  { id: 'decision', label: 'A decision', source: 'starter' },
  { id: 'idea', label: 'An idea', source: 'starter' },
  { id: 'project', label: 'A project', source: 'starter' },
  { id: 'feeling', label: 'A feeling', source: 'starter' },
]

const INTENT_OPTIONS = [
  {
    id: 'origin',
    label: 'Where it started',
    relation: 'origin_candidate',
    question: (topic) => `Where did my thinking about ${topic} first show up?`,
  },
  {
    id: 'influence',
    label: 'What shaped it',
    relation: 'influenced_by',
    question: (topic) => `What has been shaping my thinking about ${topic}?`,
  },
  {
    id: 'repetition',
    label: 'What keeps repeating',
    relation: 'reinforced_by',
    question: (topic) => `What keeps repeating around ${topic}?`,
  },
  {
    id: 'change',
    label: 'What changed recently',
    relation: 'updated_by',
    question: (topic) => `How has my thinking about ${topic} changed recently?`,
  },
  {
    id: 'one_sided',
    label: 'What may be one-sided',
    relation: 'checks_bias',
    question: (topic) => `What could be one-sided around ${topic}?`,
  },
]

const EVIDENCE_OPTIONS = [
  { id: 'sources', label: 'Source links', relation: 'evidenced_by' },
  { id: 'schemas', label: 'Thinking frames', relation: 'mapped_to_schema' },
  { id: 'patterns', label: 'Repeated activity', relation: 'patterned_by' },
  { id: 'contrasts', label: 'Different angles', relation: 'contrasted_with' },
  { id: 'new_signal', label: 'New clue', relation: 'self_reported' },
]

function normalize(value, maxLength = 0) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (maxLength && text.length > maxLength) {
    return `${text.slice(0, maxLength - 3).trim()}...`
  }
  return text
}

function slug(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'survey'
}

function uniqueOptions(options = [], limit = 5) {
  const seen = new Set()
  const output = []
  for (const option of options) {
    const label = normalize(option?.label)
    if (!label) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push({
      id: normalize(option.id) || slug(label),
      label,
      source: normalize(option.source) || 'activity',
      summary: normalize(option.summary, 140),
      relation: normalize(option.relation),
    })
    if (output.length >= limit) break
  }
  return output
}

function compactSourceLabel(source = {}) {
  return normalize(source.title || source.domain || source.url)
}

function friendlySourceLabel(source) {
  const value = normalize(source).toLowerCase()
  if (value === 'schema memory' || value === 'schema') return 'memory'
  if (value === 'pattern' || value === 'influence') return 'repeated activity'
  if (value === 'source') return 'link'
  return normalize(source) || 'activity'
}

function collectTopicOptions(knowledge = {}) {
  const schemaMemories = Array.isArray(knowledge.memory?.schema_packets)
    ? knowledge.memory.schema_packets
    : []
  const schemas = Array.isArray(knowledge.schema?.schemas)
    ? knowledge.schema.schemas
    : []
  const influence = Array.isArray(knowledge.influence?.valid_chains)
    ? knowledge.influence.valid_chains
    : []
  const records = Array.isArray(knowledge.inference?.records)
    ? knowledge.inference.records
    : []

  const options = [
    ...schemaMemories.map((schema) => ({
      id: schema.id,
      label: schema.label,
      source: friendlySourceLabel('schema memory'),
      summary: schema.core_interpretation || schema.summary,
    })),
    ...schemas.map((schema) => ({
      id: schema.id,
      label: schema.label || schema.id,
      source: friendlySourceLabel('schema'),
      summary: schema.summary || schema.state_label,
    })),
    ...influence.map((chain) => ({
      id: `${chain.from}-${chain.to}`,
      label: normalize(chain.to_human_label || chain.to_label || chain.to || chain.from_human_label || chain.from_label || chain.from),
      source: friendlySourceLabel('pattern'),
      summary: chain.summary,
    })),
    ...records.flatMap((record) => (record.canonical_themes || []).map((theme) => ({
      id: `theme-${theme}`,
      label: theme,
      source: 'activity',
      summary: record.source_label,
    }))),
  ]

  return uniqueOptions(options, 5)
}

function collectEvidenceOptions(knowledge = {}) {
  const schemaCount = Number(knowledge.stats?.schemaCount || knowledge.memory?.schema_packets?.length || 0)
  const influenceCount = Number(knowledge.stats?.influenceCount || knowledge.influence?.valid_chains?.length || 0)
  const sources = [
    ...(knowledge.memory?.memories || []).flatMap((memory) => memory.sources || []),
    ...(knowledge.inference?.records || []).flatMap((record) => record.sources || []),
  ]

  const sourceOptions = uniqueOptions(
    sources.map((source) => ({
      id: source.url || source.domain || source.title,
      label: compactSourceLabel(source),
      source: friendlySourceLabel('source'),
      relation: 'evidenced_by',
    })),
    2
  )

  const dynamic = [
    schemaCount ? { id: 'schemas', label: 'Thinking frames', relation: 'mapped_to_schema', source: 'memory' } : null,
    influenceCount ? { id: 'patterns', label: 'Repeated activity', relation: 'patterned_by', source: friendlySourceLabel('influence') } : null,
    ...sourceOptions,
  ].filter(Boolean)

  return uniqueOptions([...dynamic, ...EVIDENCE_OPTIONS], 5)
}

export function buildSurveyDeck(knowledge = {}) {
  const topicOptions = collectTopicOptions(knowledge)
  const hasActivity = Boolean(
    Number(knowledge.stats?.meaningfulActivityCount || 0) ||
      topicOptions.length ||
      knowledge.memory?.memories?.length
  )

  return {
    hasActivity,
    questions: [
      {
        id: 'topic',
        eyebrow: '1 / 3',
        title: 'What should Memact look at?',
        options: topicOptions.length ? topicOptions : DEFAULT_TOPICS,
      },
      {
        id: 'intent',
        eyebrow: '2 / 3',
        title: 'What do you want to understand?',
        options: INTENT_OPTIONS,
      },
      {
        id: 'evidence',
        eyebrow: '3 / 3',
        title: 'What should Memact check first?',
        options: collectEvidenceOptions(knowledge),
      },
    ],
  }
}

export function createSurveyPacket(answers = {}, deck = buildSurveyDeck()) {
  const byId = new Map((deck.questions || []).map((question) => [question.id, question]))
  const topic = answers.topic || byId.get('topic')?.options?.[0] || DEFAULT_TOPICS[0]
  const intent = answers.intent || INTENT_OPTIONS[1]
  const evidence = answers.evidence || EVIDENCE_OPTIONS[1]
  const topicLabel = normalize(topic.label).toLowerCase()
  const intentBuilder = INTENT_OPTIONS.find((item) => item.id === intent.id)?.question || INTENT_OPTIONS[1].question
  const query = intentBuilder(topicLabel)
  const timestamp = new Date().toISOString()
  const id = `survey:${Date.now()}:${slug(topic.label)}`

  return {
    id,
    mode: 'survey',
    created_at: timestamp,
    query,
    answers: {
      topic,
      intent,
      evidence,
    },
    nodes: [
      { id, type: 'survey_response', label: query },
      { id: `schema-candidate:${slug(topic.label)}`, type: 'schema_candidate', label: topic.label },
      { id: `survey-intent:${intent.id}`, type: 'survey_intent', label: intent.label },
      { id: `survey-evidence:${evidence.id}`, type: 'evidence_request', label: evidence.label },
    ],
    edges: [
      {
        from: id,
        to: `schema-candidate:${slug(topic.label)}`,
        type: 'asks_about',
        weight: 0.68,
      },
      {
        from: `schema-candidate:${slug(topic.label)}`,
        to: `survey-intent:${intent.id}`,
        type: intent.relation || 'related',
        weight: 0.64,
      },
      {
        from: `schema-candidate:${slug(topic.label)}`,
        to: `survey-evidence:${evidence.id}`,
        type: evidence.relation || 'evidenced_by',
        weight: 0.58,
      },
    ],
  }
}

export function saveSurveyPacket(packet) {
  if (typeof window === 'undefined' || !packet?.id) return []
  try {
    const raw = window.localStorage.getItem(SURVEY_PACKET_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const current = Array.isArray(parsed) ? parsed : []
    const next = [packet, ...current.filter((item) => item?.id !== packet.id)].slice(0, 24)
    window.localStorage.setItem(SURVEY_PACKET_KEY, JSON.stringify(next))
    return next
  } catch {
    return []
  }
}
