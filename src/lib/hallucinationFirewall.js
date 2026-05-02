function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function lower(value) {
  return normalize(value).toLowerCase()
}

function collectEvidenceTerms({ results = [], explanation = {} } = {}) {
  const terms = new Set()
  const ids = new Set()
  const addTerm = (value) => {
    const text = lower(value)
    if (text.length >= 4) terms.add(text)
  }
  const addId = (value) => {
    const text = normalize(value)
    if (text) ids.add(text)
  }

  ;(Array.isArray(results) ? results : []).forEach((result) => {
    addTerm(result.title)
    addTerm(result.domain)
    addTerm(result.url)
    addTerm(result.structuredSummary)
    addTerm(result.displayExcerpt)
    addId(result.id)
  })

  const evidence = explanation?.request?.evidence || explanation?.evidence || {}
  ;(evidence.origin_sources || []).forEach((source) => {
    addTerm(source.title || source.label)
    addTerm(source.domain)
    addTerm(source.url)
    addId(source.id || source.evidence_id)
  })
  ;(evidence.cognitive_schema_memories || []).forEach((schema) => {
    addTerm(schema.label)
    addTerm(schema.summary)
    addId(schema.id)
    ;(schema.evidence_packet_ids || []).forEach(addId)
  })
  ;(evidence.rag_context?.context_items || []).forEach((item) => {
    addTerm(item.label)
    addTerm(item.summary)
    addId(item.id)
    ;(item.evidence_packet_ids || []).forEach(addId)
  })

  return { terms, ids }
}

function sourceClaim(text) {
  return /\b(source|origin|came from|shaped|influenced|caused|because|led to|made you|why you)\b/i.test(text)
}

function causalOverclaim(text) {
  return /\b(caused|made you|you believe this because|your subconscious|this is why you|predicts your next thought)\b/i.test(text)
}

function sensitiveMentalClaim(text) {
  return /\b(diagnosis|disorder|depressed|suicidal|mentally ill|subconscious)\b/i.test(text)
}

function hasEvidenceTerm(text, evidence) {
  const value = lower(text)
  for (const term of evidence.terms) {
    if (value.includes(term)) return true
  }
  return false
}

function hasUncertainty(text) {
  return /\b(may|might|appears|possible|overlaps|related|could|not proven|no strong)\b/i.test(text)
}

function softenOverclaim(text) {
  return normalize(text)
    .replace(/\bcaused\b/gi, 'may have contributed to')
    .replace(/\bmade you\b/gi, 'may have nudged you to')
    .replace(/\bthis is why you think that\b/gi, 'this is one possible related pattern')
    .replace(/\byou believe this because\b/gi, 'this may be related because')
    .replace(/\byour subconscious was influenced by\b/gi, 'this exposure may overlap with')
}

export function applyHallucinationFirewall(answerMeta, context = {}) {
  if (!answerMeta) return answerMeta
  const evidence = collectEvidenceTerms(context)
  const evidenceCount = evidence.ids.size || evidence.terms.size
  const answer = normalize(answerMeta.answer)
  const summary = normalize(answerMeta.summary || answerMeta.overview)
  const combined = `${answer}. ${summary}`
  const issues = []

  if (sensitiveMentalClaim(combined)) {
    issues.push('sensitive_claim_blocked')
  }
  if (causalOverclaim(combined)) {
    issues.push('causal_overclaim_softened')
  }
  if (sourceClaim(combined) && !evidenceCount) {
    issues.push('source_claim_without_evidence')
  }
  if (sourceClaim(combined) && evidenceCount && !hasEvidenceTerm(combined, evidence) && !hasUncertainty(combined)) {
    issues.push('named_source_not_in_evidence')
  }

  if (!issues.length) {
    return {
      ...answerMeta,
      hallucinationFirewall: {
        passed: true,
        issues: [],
      },
    }
  }

  if (issues.includes('sensitive_claim_blocked')) {
    return {
      ...answerMeta,
      answer: 'Memact found related activity, but will not make mental-state or diagnosis claims.',
      summary: 'The result can show evidence overlaps, not certainty about your mind.',
      hallucinationFirewall: {
        passed: false,
        issues,
      },
    }
  }

  if (issues.includes('source_claim_without_evidence')) {
    return {
      ...answerMeta,
      answer: 'No strong digital origin was found.',
      summary: 'Memact did not find enough evidence to name a source for this thought.',
      evidenceState: 'unknown_origin',
      hallucinationFirewall: {
        passed: false,
        issues,
      },
    }
  }

  return {
    ...answerMeta,
    answer: hasUncertainty(answer) ? softenOverclaim(answer) : `A possible related pattern is: ${softenOverclaim(answer)}`,
    summary: hasUncertainty(summary) ? softenOverclaim(summary) : `This appears related to retrieved evidence. ${softenOverclaim(summary)}`,
    hallucinationFirewall: {
      passed: false,
      issues,
    },
  }
}
