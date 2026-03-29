import Dexie from 'dexie'
import { Index as FlexSearchIndex } from 'flexsearch'

const LEGACY_WEB_MEMORY_KEY = 'memact.web-memories'
const WEB_DB_NAME = 'memact-web-memory'
const MAX_WEB_MEMORIES = 180
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'did',
  'find',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'show',
  'that',
  'the',
  'this',
  'to',
  'was',
  'what',
  'where',
  'with',
  'you',
])

const webDb = new Dexie(WEB_DB_NAME)
webDb.version(1).stores({
  memories: 'id, &fingerprint, occurred_at, domain, month_key, title, page_type, application',
})

let initPromise = null
let statePromise = null

function normalize(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeRichText(value) {
  const text = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = text
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split(/\n+/)
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
    )
    .filter(Boolean)
  return blocks.join('\n\n').trim()
}

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function safeDate(value) {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? new Date(timestamp) : new Date()
}

function memoryDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function displayUrl(url) {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.hostname.replace(/^www\./, '')}${pathname}`
  } catch {
    return normalize(url)
  }
}

function monthKey(value) {
  const date = safeDate(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(value) {
  const date = safeDate(`${value}-01T12:00:00Z`)
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function compactText(value, maxLength = 260) {
  const text = normalize(value)
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 3).trim()}...`
}

function hashSeed(value) {
  const text = String(value || '')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function chooseVariant(seed, variants) {
  if (!Array.isArray(variants) || !variants.length) return ''
  return variants[hashSeed(seed) % variants.length]
}

function ensureSentence(value) {
  const text = normalize(value)
  if (!text) return ''
  return /[.!?]$/.test(text) ? text : `${text}.`
}

function joinNarrative(parts, maxLength = 320) {
  return compactText(
    parts
      .map((part) => ensureSentence(part))
      .filter(Boolean)
      .join(' '),
    maxLength
  )
}

function quoteLabel(value) {
  const text = normalize(value).replace(/^["']|["']$/g, '')
  return text ? `"${text}"` : '"this memory"'
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function tokenize(value) {
  return Array.from(
    new Set(
      normalize(value)
        .toLowerCase()
        .replace(/[^a-z0-9@#./+-]+/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
    )
  )
}

function memoryFingerprint(memory) {
  return [
    normalize(memory.url).toLowerCase(),
    normalize(memory.title).toLowerCase(),
    normalize(memory.full_text).slice(0, 220).toLowerCase(),
  ]
    .filter(Boolean)
    .join('|')
}

function readLegacyMemories() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LEGACY_WEB_MEMORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function clearLegacyMemories() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LEGACY_WEB_MEMORY_KEY)
  } catch {
    // Ignore legacy cleanup failures.
  }
}

function readSharePayload(searchParams) {
  const payload = {
    url: normalize(searchParams.get('url') || searchParams.get('target_url')),
    title: normalize(searchParams.get('title')),
    text: normalizeRichText(
      searchParams.get('text') || searchParams.get('body') || searchParams.get('description')
    ),
  }

  if (!payload.url && !payload.title && !payload.text) {
    return null
  }

  return payload
}

function stripShareParams() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const keys = ['share', 'shared', 'url', 'target_url', 'title', 'text', 'body', 'description']
  let changed = false
  keys.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  })
  if (changed) {
    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState({}, '', next)
  }
}

function buildMemoryFromShare(payload, environment) {
  const url = payload.url
  const domain = memoryDomain(url)
  const title =
    normalize(payload.title) ||
    (domain ? `${titleCase(domain)} page` : '') ||
    'Shared memory'
  const fullText = normalizeRichText(payload.text) || title
  const snippet = compactText(fullText, 300)
  const occurredAt = new Date().toISOString()
  const browserName = environment?.name || (environment?.mobile ? 'Phone browser' : 'Browser')

  return normalizeMemoryRecord({
    id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    url,
    display_url: displayUrl(url),
    domain,
    application: browserName,
    occurred_at: occurredAt,
    interaction_type: environment?.mobile ? 'Share' : 'Save',
    window_title: title,
    title,
    content_text: snippet,
    full_text: fullText,
    raw_full_text: fullText,
    page_type: 'shared',
    page_type_label: 'Shared page',
    structured_summary: domain
      ? `Saved shared page from ${domain}.`
      : 'Saved shared memory on this device.',
    display_excerpt: snippet,
    fact_items: [
      { label: 'Source', value: domain || browserName },
      { label: 'Mode', value: environment?.mobile ? 'Phone browser' : 'Web browser' },
    ],
    context_subject: title,
    context_entities: [],
    context_topics: tokenize(title).slice(0, 4),
    search_results: [],
    derivative_items: fullText
      .split(/\n{2,}/)
      .map((entry, index) => ({
        kind: 'passage',
        label: `Passage ${index + 1}`,
        text: compactText(entry, 220),
      }))
      .filter((entry) => entry.text),
    source: 'web',
    duplicate_count: 1,
  })
}

function normalizeMemoryRecord(memory) {
  const occurredAt = memory?.occurred_at || new Date().toISOString()
  const title = normalize(memory?.title || memory?.window_title || 'Local memory')
  const url = normalize(memory?.url)
  const fullText = normalizeRichText(memory?.full_text || memory?.raw_full_text || memory?.content_text)
  const structuredSummary = normalize(memory?.structured_summary || memory?.content_text)
  const snippet = normalize(memory?.content_text || memory?.display_excerpt || structuredSummary || fullText)
  const domain = normalize(memory?.domain || memoryDomain(url))
  const derivativeItems = Array.isArray(memory?.derivative_items)
    ? memory.derivative_items
        .map((entry) => ({
          kind: normalize(entry?.kind),
          label: normalize(entry?.label),
          text: normalizeRichText(entry?.text),
        }))
        .filter((entry) => entry.text)
    : []

  return {
    ...memory,
    id: normalize(memory?.id) || `web-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    fingerprint: normalize(memory?.fingerprint) || memoryFingerprint(memory),
    occurred_at: occurredAt,
    month_key: monthKey(occurredAt),
    url,
    display_url: normalize(memory?.display_url || displayUrl(url)),
    domain,
    title,
    window_title: title,
    content_text: snippet,
    full_text: fullText,
    raw_full_text: normalizeRichText(memory?.raw_full_text || fullText),
    structured_summary: structuredSummary || compactText(fullText, 280),
    display_excerpt: normalize(memory?.display_excerpt || compactText(snippet || fullText, 280)),
    page_type: normalize(memory?.page_type || 'shared'),
    page_type_label: normalize(memory?.page_type_label || 'Shared page'),
    context_subject: normalize(memory?.context_subject || title),
    context_entities: Array.isArray(memory?.context_entities) ? memory.context_entities : [],
    context_topics: Array.isArray(memory?.context_topics) ? memory.context_topics : tokenize(title).slice(0, 4),
    fact_items: Array.isArray(memory?.fact_items) ? memory.fact_items : [],
    search_results: Array.isArray(memory?.search_results) ? memory.search_results : [],
    derivative_items: derivativeItems,
    source: normalize(memory?.source || 'web'),
    duplicate_count: Math.max(1, Number(memory?.duplicate_count || 1)),
    search_blob: normalize(
      [
        title,
        url,
        domain,
        structuredSummary,
        snippet,
        fullText,
        normalize(memory?.context_subject),
        ...(Array.isArray(memory?.context_topics) ? memory.context_topics : []),
        ...(Array.isArray(memory?.context_entities) ? memory.context_entities : []),
        ...derivativeItems.map((entry) => `${entry.label} ${entry.text}`),
      ]
        .filter(Boolean)
        .join(' ')
    ),
  }
}

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      await webDb.open()
      const legacyMemories = Array.from(
        new Map(
          readLegacyMemories()
            .map(normalizeMemoryRecord)
            .slice(0, MAX_WEB_MEMORIES)
            .map((memory) => [memory.fingerprint, memory])
        ).values()
      )
      if (legacyMemories.length) {
        const existingCount = await webDb.memories.count()
        if (!existingCount) {
          await webDb.memories.bulkPut(legacyMemories)
        }
        clearLegacyMemories()
      }
    })()
  }

  await initPromise
}

function createSearchIndex() {
  return new FlexSearchIndex({
    charset: 'latin:advanced',
    tokenize: 'forward',
    resolution: 9,
    cache: 128,
  })
}

function createSuggestionSeed(memories) {
  const latest = new Map()
  const counts = new Map()

  const addSuggestion = (key, suggestion) => {
    counts.set(key, (counts.get(key) || 0) + 1)
    const current = latest.get(key)
    const nextTime = Date.parse(suggestion.timestamp || '') || 0
    if (!current || nextTime > (Date.parse(current.timestamp || '') || 0)) {
      latest.set(key, suggestion)
    }
  }

  memories.forEach((memory) => {
    if (memory.domain) {
      addSuggestion(`domain:${memory.domain}`, {
        id: `domain:${memory.domain}`,
        category: 'Saved site',
        title: `Show activity from ${memory.domain}`,
        subtitle: `${memory.domain} saved locally on this device.`,
        completion: `Show activity from ${memory.domain}`,
        timestamp: memory.occurred_at,
      })
    }

    if (memory.title) {
      addSuggestion(`title:${memory.title}`, {
        id: `title:${memory.title}`,
        category: 'Saved page',
        title: `What did I save about "${compactText(memory.title, 46)}"?`,
        subtitle:
          compactText(memory.structured_summary || memory.content_text, 72) ||
          'Saved locally on this device.',
        completion: `What did I save about "${memory.title}"?`,
        timestamp: memory.occurred_at,
      })
    }

    addSuggestion(`month:${memory.month_key}`, {
      id: `month:${memory.month_key}`,
      category: 'Saved month',
      title: `Show memories from ${formatMonthLabel(memory.month_key)}`,
      subtitle: `Memories saved in ${formatMonthLabel(memory.month_key)}.`,
      completion: `Show memories from ${formatMonthLabel(memory.month_key)}`,
      timestamp: memory.occurred_at,
    })
  })

  return [...latest.entries()]
    .map(([key, suggestion]) => ({
      ...suggestion,
      key,
      weight: counts.get(key) || 1,
      search_blob: normalize(
        [suggestion.title, suggestion.subtitle, suggestion.completion, suggestion.category].join(' ')
      ),
    }))
    .sort((left, right) => {
      if (right.weight !== left.weight) return right.weight - left.weight
      return (Date.parse(right.timestamp || '') || 0) - (Date.parse(left.timestamp || '') || 0)
    })
}

async function buildState() {
  await ensureInitialized()
  const memories = (await webDb.memories.orderBy('occurred_at').reverse().limit(MAX_WEB_MEMORIES).toArray()).map(
    normalizeMemoryRecord
  )

  const searchIndex = createSearchIndex()
  const byId = new Map()
  for (const memory of memories) {
    byId.set(String(memory.id), memory)
    if (memory.search_blob) {
      searchIndex.add(String(memory.id), memory.search_blob)
    }
  }

  const suggestions = createSuggestionSeed(memories)
  const suggestionIndex = createSearchIndex()
  const suggestionsById = new Map()
  for (const suggestion of suggestions) {
    suggestionsById.set(String(suggestion.id), suggestion)
    if (suggestion.search_blob) {
      suggestionIndex.add(String(suggestion.id), suggestion.search_blob)
    }
  }

  return {
    memories,
    searchIndex,
    byId,
    suggestions,
    suggestionIndex,
    suggestionsById,
  }
}

async function getState() {
  if (!statePromise) {
    statePromise = buildState()
  }
  return statePromise
}

function invalidateState() {
  statePromise = null
}

async function upsertMemory(memory) {
  await ensureInitialized()
  const normalizedMemory = normalizeMemoryRecord(memory)
  const existing = await webDb.memories.where('fingerprint').equals(normalizedMemory.fingerprint).first()

  if (existing) {
    await webDb.memories.put(
      normalizeMemoryRecord({
        ...existing,
        ...normalizedMemory,
        id: existing.id || normalizedMemory.id,
        duplicate_count: Math.max(1, Number(existing.duplicate_count || 1) + 1),
        occurred_at: normalizedMemory.occurred_at,
      })
    )
  } else {
    await webDb.memories.put(normalizedMemory)
  }

  invalidateState()
}

function inTimeFilter(memory, timeFilter) {
  if (!timeFilter) return true
  const time = Date.parse(memory.occurred_at || '')
  if (!Number.isFinite(time)) return true
  const now = Date.now()
  const date = new Date(time)
  const today = new Date(now)

  if (timeFilter === 'today') {
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    )
  }

  if (timeFilter === 'yesterday') {
    const yesterday = new Date(now - 24 * 60 * 60 * 1000)
    return (
      date.getFullYear() === yesterday.getFullYear() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getDate() === yesterday.getDate()
    )
  }

  const daysSince = (now - time) / (24 * 60 * 60 * 1000)
  if (timeFilter === 'this week') return daysSince <= 7
  if (timeFilter === 'last week') return daysSince > 7 && daysSince <= 14
  return true
}

function parseStructuredQuery(rawQuery) {
  const query = normalize(rawQuery)
  const lowered = query.toLowerCase()
  const domainMatch = lowered.match(/(?:show activity from|activity from|from)\s+("?)([^"]+)\1$/i)
  if (domainMatch?.[2]) {
    return { type: 'domain', value: normalize(domainMatch[2]) }
  }

  const monthMatch = query.match(/show memories from\s+(.+)$/i)
  if (monthMatch?.[1]) {
    return { type: 'month', value: normalize(monthMatch[1]) }
  }

  const topicMatch = query.match(/(?:what did i save about|where did i see|find)\s+("?)([^"]+)\1/i)
  if (topicMatch?.[2]) {
    return { type: 'topic', value: normalize(topicMatch[2]) }
  }

  return { type: 'match', value: query }
}

function recencyScore(value) {
  const time = Date.parse(value || '')
  if (!Number.isFinite(time)) return 0
  const days = Math.max(0, (Date.now() - time) / (24 * 60 * 60 * 1000))
  return 1 / (1 + days / 4)
}

function scoreMemory(memory, parsedQuery) {
  const value = normalize(parsedQuery.value)
  const loweredValue = value.toLowerCase()
  const title = normalize(memory.title).toLowerCase()
  const domain = normalize(memory.domain).toLowerCase()
  const url = normalize(memory.url).toLowerCase()
  const snippet = normalize(memory.content_text).toLowerCase()
  const fullText = normalize(memory.full_text).toLowerCase()
  const derivatives = Array.isArray(memory.derivative_items)
    ? memory.derivative_items.map((item) => normalize(item.text).toLowerCase()).join(' ')
    : ''
  const tokens = tokenize(value)

  if (parsedQuery.type === 'domain') {
    const exactDomain = domain === loweredValue || domain.includes(loweredValue)
    if (!exactDomain) return 0
    return 0.86 + recencyScore(memory.occurred_at) * 0.14
  }

  if (parsedQuery.type === 'month') {
    const memoryMonth = formatMonthLabel(monthKey(memory.occurred_at)).toLowerCase()
    if (memoryMonth !== loweredValue.toLowerCase()) return 0
    return 0.88 + recencyScore(memory.occurred_at) * 0.12
  }

  let score = 0
  if (title === loweredValue) score += 1
  if (title.includes(loweredValue)) score += 0.5
  if (domain === loweredValue || domain.includes(loweredValue)) score += 0.42
  if (url.includes(loweredValue)) score += 0.3
  if (snippet.includes(loweredValue)) score += 0.26
  if (fullText.includes(loweredValue)) score += 0.18
  if (derivatives.includes(loweredValue)) score += 0.2

  if (tokens.length) {
    const titleHits = tokens.filter((token) => title.includes(token)).length / tokens.length
    const snippetHits = tokens.filter((token) => snippet.includes(token)).length / tokens.length
    const fullHits = tokens.filter((token) => fullText.includes(token)).length / tokens.length
    const derivativeHits = tokens.filter((token) => derivatives.includes(token)).length / tokens.length
    score += titleHits * 0.45 + snippetHits * 0.22 + fullHits * 0.16 + derivativeHits * 0.18
  }

  score += recencyScore(memory.occurred_at) * 0.18
  return score
}

function buildAnswer(query, results, modeLabel) {
  const label = query || 'local memories'
  if (!results.length) {
    return {
      overview: chooseVariant(`web-empty-overview:${label}`, [
        `No strong local match for ${quoteLabel(label)}`,
        `Nothing clear yet for ${quoteLabel(label)}`,
        `No saved match for ${quoteLabel(label)}`,
      ]),
      answer: '',
      summary: joinNarrative([
        modeLabel === 'phone'
          ? `No saved phone memories matched ${quoteLabel(label)} yet`
          : `No saved web memories matched ${quoteLabel(label)} yet`,
        chooseVariant(`web-empty-tip:${label}`, [
          'Try adding a site, page title, or time clue',
          'A more specific phrase usually works better',
          'Searching with one concrete detail helps narrow it down',
        ]),
      ]),
      detailItems: [{ label: 'Matches', value: '0' }],
      signals: [],
      sessionSummary: '',
      sessionPrompts: [],
      relatedQueries: [],
      detailsLabel: 'Matching memories',
    }
  }

  const primary = results[0]
  const location = [primary?.application, primary?.domain].filter(Boolean).join(' on ')

  return {
    overview: chooseVariant(`web-overview:${label}`, [
      `Best local match for ${quoteLabel(label)}`,
      `Strongest saved result for ${quoteLabel(label)}`,
      `What Memact found for ${quoteLabel(label)}`,
    ]),
    answer: results[0].title || label,
    summary: joinNarrative([
      chooseVariant(`web-lead:${label}:${primary?.title}`, [
        `${quoteLabel(primary?.title || label)} is the strongest saved match${location ? ` in ${location}` : ''}`,
        `The clearest saved match points to ${quoteLabel(primary?.title || label)}${location ? ` in ${location}` : ''}`,
        `${quoteLabel(primary?.title || label)} stands out as the best local result${location ? ` in ${location}` : ''}`,
      ]),
      primary?.structured_summary || primary?.content_text || '',
      chooseVariant(`web-evidence:${label}:${results.length}`, [
        `Memact found ${pluralize(results.length, 'matching memory')} for this search`,
        `${pluralize(results.length, 'saved memory')} support this result`,
        `This answer is backed by ${pluralize(results.length, 'matching capture')}`,
      ]),
    ]),
    detailItems: [
      { label: 'Mode', value: modeLabel === 'phone' ? 'Phone browser' : 'Web browser' },
      { label: 'Matches', value: String(results.length) },
    ],
    signals: [],
    sessionSummary: '',
    sessionPrompts: [],
    relatedQueries: [],
    detailsLabel: 'Matching memories',
  }
}

export async function initializeWebMemoryStore(environment) {
  await ensureInitialized()

  if (typeof window === 'undefined') {
    return { imported: false, memoryCount: 0 }
  }

  const url = new URL(window.location.href)
  const isShareRequest = url.searchParams.get('share') === '1' || url.searchParams.get('shared') === '1'
  const payload = readSharePayload(url.searchParams)

  if (!isShareRequest && !payload) {
    const count = await webDb.memories.count()
    return { imported: false, memoryCount: count }
  }

  if (!payload) {
    stripShareParams()
    const count = await webDb.memories.count()
    return { imported: false, memoryCount: count }
  }

  await upsertMemory(buildMemoryFromShare(payload, environment))
  stripShareParams()
  const count = await webDb.memories.count()
  return { imported: true, memoryCount: count }
}

export async function webMemoryStatus(environment) {
  await ensureInitialized()
  const count = await webDb.memories.count()
  return {
    ready: true,
    transport: 'web-fallback',
    mode: environment?.mobile ? 'phone' : 'web',
    memoryCount: count,
  }
}

export async function webMemoryStats() {
  await ensureInitialized()
  const count = await webDb.memories.count()
  return {
    eventCount: count,
    sessionCount: count,
  }
}

export async function webMemorySuggestions(query = '', timeFilter = null, limit = 12) {
  const state = await getState()
  const filteredSuggestions = state.suggestions.filter((suggestion) =>
    inTimeFilter({ occurred_at: suggestion.timestamp }, timeFilter)
  )

  const normalizedQuery = normalize(query)
  if (!normalizedQuery) {
    return filteredSuggestions.slice(0, limit).map(({ key, weight, timestamp, search_blob, ...rest }) => rest)
  }

  const ids = state.suggestionIndex.search(normalizedQuery, Math.max(limit * 6, 24))
  const ranked = []
  const seen = new Set()

  for (const id of ids || []) {
    const suggestion = state.suggestionsById.get(String(id))
    if (!suggestion || seen.has(String(id))) {
      continue
    }
    if (!inTimeFilter({ occurred_at: suggestion.timestamp }, timeFilter)) {
      continue
    }
    seen.add(String(id))
    ranked.push(suggestion)
  }

  if (!ranked.length) {
    for (const suggestion of filteredSuggestions) {
      const haystack = normalize(
        [suggestion.title, suggestion.subtitle, suggestion.completion, suggestion.category].join(' ')
      ).toLowerCase()
      if (
        normalizedQuery
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean)
          .every((token) => haystack.includes(token))
      ) {
        ranked.push(suggestion)
      }
      if (ranked.length >= limit) {
        break
      }
    }
  }

  return ranked
    .slice(0, limit)
    .map(({ key, weight, timestamp, search_blob, ...rest }) => rest)
}

export async function webMemorySearch(query, limit = 20, environment) {
  const state = await getState()
  const parsedQuery = parseStructuredQuery(query)
  const modeLabel = environment?.mobile ? 'phone' : 'web'
  const normalizedQuery = normalize(parsedQuery.value)

  let candidateMemories = state.memories
  if (parsedQuery.type === 'match' || parsedQuery.type === 'topic') {
    const ids = normalizedQuery
      ? state.searchIndex.search(normalizedQuery, Math.max(limit * 24, 80))
      : []
    if (Array.isArray(ids) && ids.length) {
      candidateMemories = ids
        .map((id) => state.byId.get(String(id)))
        .filter(Boolean)
      if (candidateMemories.length < Math.min(limit * 3, 40)) {
        const seen = new Set(candidateMemories.map((memory) => String(memory.id)))
        for (const memory of state.memories) {
          if (seen.has(String(memory.id))) {
            continue
          }
          candidateMemories.push(memory)
          if (candidateMemories.length >= Math.max(limit * 4, 60)) {
            break
          }
        }
      }
    }
  }

  const ranked = candidateMemories
    .map((memory) => ({
      ...memory,
      score: scoreMemory(memory, parsedQuery),
    }))
    .filter((memory) => memory.score >= 0.16)
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(right.occurred_at || '') - Date.parse(left.occurred_at || '')
    )
    .slice(0, limit)

  return {
    results: ranked,
    answer: buildAnswer(parsedQuery.value, ranked, modeLabel),
  }
}

export async function clearWebMemories() {
  await ensureInitialized()
  try {
    await webDb.memories.clear()
    invalidateState()
    clearLegacyMemories()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message || error || 'Could not clear local memories.') }
  }
}
