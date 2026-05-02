function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function splitSentences(value) {
  return normalize(value)
    .split(/(?<=[.!?])\s+/)
    .map(normalize)
    .filter(Boolean)
}

function collectEvidence(results = [], explanation = {}) {
  const terms = new Set()
  const evidenceIds = new Set()
  const addTerm = (value) => {
    const text = normalize(value).toLowerCase()
    if (text) terms.add(text)
  }
  const addId = (value) => {
    const text = normalize(value)
    if (text) evidenceIds.add(text)
  }

  for (const result of Array.isArray(results) ? results : []) {
    addTerm(result.title)
    addTerm(result.domain)
    addTerm(result.url)
    addTerm(result.structuredSummary)
    addId(result.id)
  }

  const evidence = explanation?.request?.evidence || explanation?.evidence || {}
  for (const source of evidence.origin_sources || []) {
    addTerm(source.title)
    addTerm(source.domain)
    addTerm(source.url)
    addId(source.id)
  }
  for (const memory of evidence.memory_signals || []) {
    addTerm(memory.label)
    addTerm(memory.summary)
    addId(memory.id)
  }
  for (const schema of evidence.cognitive_schema_memories || []) {
    addTerm(schema.label)
    addTerm(schema.summary)
    addId(schema.id)
    ;(schema.evidence_packet_ids || []).forEach(addId)
  }
  for (const item of evidence.rag_context?.context_items || []) {
    addTerm(item.label)
    addTerm(item.summary)
    addId(item.id)
    ;(item.evidence_packet_ids || []).forEach(addId)
  }
  return { terms, evidenceIds }
}

function mentionsSourceClaim(sentence) {
  return /\b(source|origin|came from|shaped|influenced|because|behind it|strongest match|connected to)\b/i.test(sentence)
}

function hasGrounding(sentence, evidence) {
  const lower = sentence.toLowerCase()
  if (!mentionsSourceClaim(sentence)) return true
  if (!evidence.evidenceIds.size && !evidence.terms.size) return false
  for (const term of evidence.terms) {
    if (term.length >= 4 && lower.includes(term)) return true
  }
  return /\bmay|appears|possible|overlaps|related\b/i.test(sentence) && evidence.evidenceIds.size > 0
}

export function verifyAnswerGrounding(answerMeta, { results = [], explanation = {} } = {}) {
  if (!answerMeta) return answerMeta
  const evidence = collectEvidence(results, explanation)
  const answerSentences = splitSentences(answerMeta.answer)
  const summarySentences = splitSentences(answerMeta.summary || answerMeta.overview)
  const allSentences = [...answerSentences, ...summarySentences]
  const unsupported = allSentences.filter((sentence) => !hasGrounding(sentence, evidence))

  if (!unsupported.length) {
    return {
      ...answerMeta,
      grounding: {
        verified: true,
        evidence_count: evidence.evidenceIds.size,
      },
    }
  }

  const safeSummary = evidence.evidenceIds.size || evidence.terms.size
    ? 'Memact found related activity, but removed unsupported wording from the answer.'
    : 'No strong digital origin was found.'

  return {
    ...answerMeta,
    answer: evidence.evidenceIds.size || evidence.terms.size
      ? 'This pattern appears related, but the exact origin is not proven.'
      : 'No strong digital origin was found.',
    summary: safeSummary,
    evidenceState: evidence.evidenceIds.size || evidence.terms.size ? answerMeta.evidenceState : 'unknown_origin',
    grounding: {
      verified: false,
      evidence_count: evidence.evidenceIds.size,
      removed_sentences: unsupported,
    },
  }
}
