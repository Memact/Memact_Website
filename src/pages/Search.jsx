import { useEffect, useMemo, useRef, useState } from 'react'
import MathRichText from '../components/MathRichText'
import SearchBar from '../components/SearchBar'
import { useSearch } from '../hooks/useSearch'
import { requestCloudFollowUpQuestions } from '../lib/cloudExplanation'
import { buildSurveyDeck, createSurveyPacket, saveSurveyPacket } from '../lib/surveyMode'

const INSTALL_PROMPT_DISMISSED_KEY = 'memact.install-prompt-dismissed'
const IMPORT_DECISION_KEY = 'memact.import-decision'
const INFO_AUTOSHOW_KEY = 'memact.info-autoshown'
const EXAMPLE_PLACEHOLDERS = [
  'e.g. I feel like I\'m behind everyone',
  'e.g. startups are better than jobs',
  'e.g. I need to prove myself',
]
const THOUGHT_PROMPTS = [
  'What have you been thinking?',
  'What has been on your mind?',
  'What idea keeps returning lately?',
  'What thought have you been circling around?',
  'What have you been quietly carrying?',
]

const INPUT_MODES = [
  { id: 'prompt', label: 'Prompt' },
  { id: 'survey', label: 'Survey' },
]

const CONTEXT_QUESTION_ROUNDS = [
  [
    {
      id: 'look',
      title: 'Where should Memact look first?',
      options: [
        { id: 'read-watch', label: 'What I read or watched' },
        { id: 'searches', label: 'What I searched' },
        { id: 'projects', label: 'What I worked on' },
      ],
    },
    {
      id: 'connection',
      title: 'What connection matters most?',
      options: [
        { id: 'started', label: 'Where it started' },
        { id: 'shaped', label: 'What shaped it' },
        { id: 'repeated', label: 'What keeps repeating' },
      ],
    },
    {
      id: 'answer',
      title: 'What would help right now?',
      options: [
        { id: 'plain', label: 'A plain answer' },
        { id: 'map', label: 'A thought map' },
        { id: 'angles', label: 'Different angles' },
      ],
    },
  ],
  [
    {
      id: 'moment',
      title: 'When does this thought show up?',
      options: [
        { id: 'before-action', label: 'Before taking action' },
        { id: 'after-reading', label: 'After consuming content' },
        { id: 'while-comparing', label: 'When comparing options' },
      ],
    },
    {
      id: 'pressure',
      title: 'What does it push you toward?',
      options: [
        { id: 'build', label: 'Build something' },
        { id: 'avoid', label: 'Avoid something' },
        { id: 'rethink', label: 'Rethink a choice' },
      ],
    },
    {
      id: 'angle',
      title: 'What should Memact check against?',
      options: [
        { id: 'agreement', label: 'Supporting signals' },
        { id: 'opposite', label: 'Opposite signals' },
        { id: 'change', label: 'Recent changes' },
      ],
    },
  ],
]
const MAX_CONTEXT_ROUNDS = CONTEXT_QUESTION_ROUNDS.length
const DEFAULT_CONTEXT_QUESTIONS = CONTEXT_QUESTION_ROUNDS[0]

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function openExternal(url) {
  if (!url || typeof window === 'undefined') return
  window.open(url, '_blank', 'noreferrer')
}

function domainFromResult(result) {
  if (result?.domain) return result.domain
  if (!result?.url) return 'evidence source'

  try {
    return new URL(result.url).hostname.replace(/^www\./, '')
  } catch {
    return 'evidence source'
  }
}

function compactText(value, maxLength = 190) {
  const text = normalize(value)
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 3).trim()}...`
}

function readStoredValue(key, fallback = '') {
  if (typeof window === 'undefined') return fallback
  try {
    return window.localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function writeStoredValue(key, value) {
  if (typeof window === 'undefined') return
  try {
    if (!value) {
      window.localStorage.removeItem(key)
      return
    }
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore storage failures.
  }
}

function buildStatus(extension, search, submittedQuery, voiceState) {
  if (voiceState === 'listening' || voiceState === 'processing') return 'Listening...'
  if (voiceState === 'done') return 'Done.'
  if (voiceState === 'unsupported') return 'Voice input unavailable.'
  if (extension?.bootstrap?.status === 'running') {
    const progress = Math.max(1, Number(extension?.bootstrap?.progress_percent || 0))
    return `Processing... ${progress}%`
  }
  if (search.loading) return 'Answering...'
  if (search.error) return search.error
  if (submittedQuery && search.results.length) {
    return `Answer backed by ${search.results.length} source${search.results.length === 1 ? '' : 's'}.`
  }
  if (submittedQuery) return 'Answer ready.'
  if (extension?.bootstrap?.status === 'complete' && Number(extension?.bootstrap?.imported_count || 0) > 0) {
    return `${extension.bootstrap.imported_count} early activity sources seeded.`
  }
  if (extension?.requiresBridge) return 'Connect Capture to form suggestions.'
  return 'Ready.'
}

function buildAnswerText(query, answerMeta, results) {
  const answer = normalize(answerMeta?.answer)
  const summary = normalize(answerMeta?.summary || answerMeta?.overview)

  if (summary) return summary
  if (answer) return answer

  if (!results.length) {
    return 'Memact can still answer, but links are optional here. Add more context if you want Memact to check your activity more tightly.'
  }

  const primary = results[0]
  const secondary = results[1]
  const primaryTitle = primary?.title || domainFromResult(primary)
  const secondaryTitle = secondary?.title || domainFromResult(secondary)

  if (secondary) {
    return `The strongest source candidate is ${primaryTitle} [1]. A related source also appears in ${secondaryTitle} [2].`
  }

  return `The strongest source candidate is ${primaryTitle} [1].`
}

function buildAnswerHeadline(query, answerMeta) {
  const answer = normalize(answerMeta?.answer)
  if (answer && answer.toLowerCase() !== normalize(query).toLowerCase()) {
    return answer
  }
  return 'Memact is checking what may have shaped this.'
}

function surveyAnswer(packet, key) {
  return packet?.answers?.[key] || {}
}

function surveyLabel(packet, key, fallback = '') {
  return normalize(surveyAnswer(packet, key).label || fallback)
}

function buildSurveyHeadline(packet) {
  const topic = surveyLabel(packet, 'topic', 'this thought')
  if (!topic) return 'Memact made a starting map.'
  return `Memact made a starting map for ${topic}.`
}

function buildSurveyCopy(packet, results) {
  const topic = surveyLabel(packet, 'topic', 'this area').toLowerCase()
  const intent = surveyLabel(packet, 'intent', 'what shaped it').toLowerCase()
  const evidence = surveyLabel(packet, 'evidence', 'the strongest clues').toLowerCase()

  if (results.length) {
    return `Memact is checking ${topic} through ${intent}. It found ${results.length} useful link${results.length === 1 ? '' : 's'} to start with, with ${evidence} as the first focus.`
  }

  return `Memact now knows to check ${topic} through ${intent}, with ${evidence} as the first focus. A direct link is optional here; more answers can make the map sharper.`
}

function buildSurveyMapItems(packet, results) {
  return [
    {
      label: 'Area',
      value: surveyLabel(packet, 'topic', 'Not selected'),
    },
    {
      label: 'Question',
      value: surveyLabel(packet, 'intent', 'What shaped it'),
    },
    {
      label: 'First check',
      value: surveyLabel(packet, 'evidence', 'Useful clues'),
    },
    {
      label: 'Links',
      value: results.length ? `${results.length} found` : 'Optional here',
    },
  ]
}

function needsMoreContext(answerMeta) {
  if (answerMeta?.needsMoreContext) return true
  const answer = normalize(answerMeta?.answer).toLowerCase()
  const summary = normalize(answerMeta?.summary).toLowerCase()
  return (
    answer.includes('needs a little more context') ||
    summary.includes('guided questions') ||
    summary.includes('more context')
  )
}

function buildContextQuery(seedQuery, questions, answers) {
  const choices = (questions || [])
    .map((question) => answers?.[question.id]?.label)
    .map(normalize)
    .filter(Boolean)

  if (!choices.length) return seedQuery
  return `${seedQuery}. Look especially at ${choices.join(', ')}.`
}

function contextQuestionsForRound(round = 0) {
  const index = Math.max(0, Math.min(CONTEXT_QUESTION_ROUNDS.length - 1, Number(round) || 0))
  return CONTEXT_QUESTION_ROUNDS[index]
}

function priorContextTitles(round = 0) {
  return CONTEXT_QUESTION_ROUNDS
    .slice(0, Math.max(0, Number(round) || 0))
    .flat()
    .map((question) => normalize(question.title).toLowerCase())
    .filter(Boolean)
}

function uniqueContextQuestions(questions = [], fallback = DEFAULT_CONTEXT_QUESTIONS, round = 0, extraBlocked = []) {
  const blocked = new Set([
    ...priorContextTitles(round),
    ...extraBlocked.map((title) => normalize(title).toLowerCase()).filter(Boolean),
  ])
  const seen = new Set()
  const output = []

  for (const question of questions) {
    const title = normalize(question?.title)
    const key = title.toLowerCase()
    if (!title || blocked.has(key) || seen.has(key)) continue

    const options = Array.isArray(question.options)
      ? question.options
          .map((option, index) => ({
            id: normalize(option?.id) || `option-${index + 1}`,
            label: normalize(option?.label || option),
          }))
          .filter((option) => option.label)
          .slice(0, 3)
      : []

    if (options.length < 2) continue
    seen.add(key)
    output.push({
      id: normalize(question.id) || `context-${output.length + 1}`,
      title,
      options,
    })
  }

  return output.length >= 2 ? output.slice(0, 3) : fallback
}

function buildActivitySuggestions(search) {
  return search.suggestions
}

function buildEmptySuggestionMessage(extension, importDecision) {
  if (extension?.bootstrap?.status === 'running') {
    return 'Memact is getting your first suggestions ready.'
  }

  if (extension?.requiresBridge) {
    return 'No suggestions formed yet. Connect Capture first.'
  }

  if (importDecision === 'denied') {
    return 'No suggestions formed yet. Memact is waiting for new activity.'
  }

  return 'No suggestions formed yet. Once there is enough evidence, they will appear here.'
}

function OnboardingModal({
  title,
  body,
  steps = [],
  progress = null,
  note = '',
  primaryAction = null,
  secondaryAction = null,
}) {
  return (
    <div className="memact-modal-backdrop" role="presentation">
      <section className="memact-modal" role="dialog" aria-modal="true" aria-label={title}>
        <p className="eyebrow">Memact setup</p>
        <h2 className="memact-modal__title">{title}</h2>
        <p className="memact-modal__body">{body}</p>

        {typeof progress === 'number' ? (
          <div className="memact-modal__progress">
            <div className="memact-modal__progress-bar">
              <span style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
            </div>
            <div className="memact-modal__progress-copy">
              <span>Processing...</span>
              <span>{Math.max(1, Math.min(100, Math.round(progress)))}%</span>
            </div>
            {note ? <p className="memact-modal__note">{note}</p> : null}
          </div>
        ) : null}

        {steps.length ? (
          <div className="memact-modal__steps">
            {steps.map((step, index) => (
              <p key={`${index + 1}-${step}`} className="memact-modal__step">
                <span>{index + 1}.</span>
                <span>{step}</span>
              </p>
            ))}
          </div>
        ) : null}

        <div className="memact-modal__actions">
          {primaryAction}
          {secondaryAction}
        </div>
      </section>
    </div>
  )
}

function BackIcon() {
  return (
    <svg className="control-icon control-icon--arrow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 12H6.5" />
      <path d="M11.5 7 6.5 12l5 5" />
    </svg>
  )
}

function ForwardIcon() {
  return (
    <svg className="control-icon control-icon--arrow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12h11.5" />
      <path d="m12.5 7 5 5-5 5" />
    </svg>
  )
}

function ReloadIcon() {
  return (
    <svg className="control-icon control-icon--reload" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 7.2A7.4 7.4 0 1 0 19.3 12" />
      <path d="M18.1 4.8v4.4h-4.4" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg className="control-icon control-icon--round" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.4" />
      <path d="M12 8.2V12l3 1.8" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg className="control-icon control-icon--round" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.4" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg className="control-icon control-icon--round" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 7.5h13" />
      <path d="M5.5 16.5h13" />
      <circle cx="9" cy="7.5" r="1.9" />
      <circle cx="15" cy="16.5" r="1.9" />
    </svg>
  )
}

function CollapseIcon({ expanded = true }) {
  return (
    <svg className="control-icon control-icon--arrow control-icon--collapse" viewBox="0 0 24 24" aria-hidden="true">
      {expanded ? (
        <path d="m7 14.5 5-5 5 5" />
      ) : (
        <path d="m7 9.5 5 5 5-5" />
      )}
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg className="control-icon control-icon--cross" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 7.5 16.5 16.5" />
      <path d="M16.5 7.5 7.5 16.5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="control-icon control-icon--trash" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8.1" y="3.2" width="7.8" height="2.4" rx="1.2" />
      <rect x="4.8" y="7.1" width="14.4" height="2.7" rx="1.35" />
      <path d="M6.9 12v5.1c0 1.9 1.35 3.2 3.25 3.2h3.7c1.9 0 3.25-1.3 3.25-3.2V12" />
      <rect x="9.4" y="12.5" width="2.1" height="5.3" rx="1.05" />
      <rect x="12.5" y="12.5" width="2.1" height="5.3" rx="1.05" />
    </svg>
  )
}

function SourceCard({ result, index }) {
  const domain = domainFromResult(result)
  const text = compactText(
    result?.structuredSummary ||
      result?.snippet ||
      result?.displayExcerpt ||
      result?.fullText,
    220
  )

  return (
    <article className="source-card">
      <div className="source-card__top">
        <span className="source-card__rank">[{index + 1}] {index === 0 ? 'Strong match' : 'Related source'}</span>
        {result?.url ? (
          <button type="button" onClick={() => openExternal(result.url)}>
            Open link
          </button>
        ) : null}
      </div>
      <h3>{result?.title || 'Evidence source'}</h3>
      <p className="source-card__domain">{domain}</p>
      {text ? (
        <div className="source-card__text">
          <MathRichText text={text} />
        </div>
      ) : null}
    </article>
  )
}

function ModeSwitch({ mode, onChange }) {
  return (
    <div className="mode-switch" role="tablist" aria-label="Input mode">
      {INPUT_MODES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={mode === item.id}
          className={mode === item.id ? 'is-active' : ''}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function SurveyPanel({
  deck,
  step,
  answers,
  disabled = false,
  onSelect,
  onBack,
  onNext,
  onSubmit,
}) {
  const questions = deck.questions || []
  const question = questions[step] || questions[0]
  const selected = question ? answers[question.id] : null
  const isLast = step >= questions.length - 1

  if (!question) {
    return null
  }

  return (
    <section className="survey-panel" aria-label="Survey mode">
      <div className="survey-panel__top">
        <span>{question.eyebrow}</span>
        {!deck.hasActivity ? <span>No activity yet</span> : null}
      </div>
      <h2>{question.title}</h2>
      <div className="survey-options">
        {question.options.map((option) => (
          <button
            key={`${question.id}-${option.id}`}
            type="button"
            className={selected?.id === option.id ? 'is-selected' : ''}
            disabled={disabled}
            onClick={() => onSelect(question.id, option)}
          >
            <span>{option.label}</span>
            {option.source ? <small>{option.source}</small> : null}
          </button>
        ))}
      </div>
      <div className="survey-actions">
        <button type="button" disabled={disabled || step === 0} onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          disabled={disabled || !selected}
          onClick={isLast ? onSubmit : onNext}
        >
          {isLast ? 'See connections' : 'Next'}
        </button>
      </div>
    </section>
  )
}

function ContextQuestionsPanel({
  title = 'Help Memact connect this better.',
  body = 'A few answers can guide Memact without pretending every thought needs a link.',
  questions = DEFAULT_CONTEXT_QUESTIONS,
  answers = {},
  disabled = false,
  compact = false,
  onSelect,
  onSubmit,
}) {
  const answeredCount = (questions || []).filter((question) => answers?.[question.id]).length
  const canSubmit = answeredCount >= Math.min(2, questions.length)

  return (
    <section className={`context-panel ${compact ? 'context-panel--compact' : ''}`} aria-label="More context">
      <div className="context-panel__intro">
        <p className="eyebrow">More context</p>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>

      <div className="context-question-list">
        {questions.map((question) => (
          <div className="context-question" key={question.id}>
            <h3>{question.title}</h3>
            <div className="context-options">
              {question.options.map((option) => (
                <button
                  key={`${question.id}-${option.id}`}
                  type="button"
                  className={answers?.[question.id]?.id === option.id ? 'is-selected' : ''}
                  disabled={disabled}
                  onClick={() => onSelect(question.id, option)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        className="context-submit"
        type="button"
        disabled={disabled || !canSubmit}
        onClick={onSubmit}
      >
        Continue
      </button>
    </section>
  )
}

export default function Search({ extension }) {
  const search = useSearch(extension, null)
  const [inputMode, setInputMode] = useState('prompt')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [lastSurveyPacket, setLastSurveyPacket] = useState(null)
  const [surveyStep, setSurveyStep] = useState(0)
  const [surveyAnswers, setSurveyAnswers] = useState({})
  const [contextSeedQuery, setContextSeedQuery] = useState('')
  const [contextAnswers, setContextAnswers] = useState({})
  const [contextQuestions, setContextQuestions] = useState(DEFAULT_CONTEXT_QUESTIONS)
  const [contextRound, setContextRound] = useState(0)
  const [contextAskedTitles, setContextAskedTitles] = useState([])
  const [navigation, setNavigation] = useState({ entries: [], index: -1 })
  const [historyOpen, setHistoryOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [voiceState, setVoiceState] = useState('idle')
  const [installPromptDismissed, setInstallPromptDismissed] = useState(false)
  const [importDecision, setImportDecision] = useState('')
  const [setupPromptRequested, setSetupPromptRequested] = useState(false)
  const [bootstrapRequested, setBootstrapRequested] = useState(false)
  const [clearImportBusy, setClearImportBusy] = useState(false)
  const [processingPaneCollapsed, setProcessingPaneCollapsed] = useState(false)
  const [thoughtPrompt] = useState(() => THOUGHT_PROMPTS[Math.floor(Math.random() * THOUGHT_PROMPTS.length)])
  const topActionsRef = useRef(null)
  const historyPopoverRef = useRef(null)
  const settingsPopoverRef = useRef(null)

  const surveyDeck = useMemo(
    () => buildSurveyDeck(extension?.knowledge || {}),
    [extension?.knowledge]
  )
  const suggestions = useMemo(() => buildActivitySuggestions(search), [search])
  const emptySuggestionMessage = buildEmptySuggestionMessage(extension, importDecision)
  const status = buildStatus(extension, search, submittedQuery, voiceState)
  const answerHeadline = buildAnswerHeadline(submittedQuery, search.answerMeta)
  const answerText = buildAnswerText(submittedQuery, search.answerMeta, search.results)
  const bootstrapState = extension?.bootstrap || {}
  const bootstrapStatus = normalize(bootstrapState.status || 'idle').toLowerCase()
  const isBootstrapRunning = bootstrapStatus === 'running'
  const isBootstrapError = bootstrapStatus === 'error'
  const isBootstrapComplete = bootstrapStatus === 'complete'
  const bootstrapProgress = Math.max(
    1,
    Math.min(100, Math.round(Number(bootstrapState.progress_percent || (isBootstrapError ? 100 : 1))))
  )
  const shouldKeepBootstrapPane = bootstrapRequested || isBootstrapRunning || isBootstrapError
  const isBackgroundProcessing = bootstrapRequested || isBootstrapRunning
  const shouldShowStatus = status !== 'Ready.'
  const shouldShowLoader =
    search.loading ||
    isBootstrapRunning ||
    voiceState === 'listening' ||
    voiceState === 'processing'
  const hasSubmitted = Boolean(submittedQuery)
  const canGoBack = navigation.index >= 0
  const canGoForward = navigation.index < navigation.entries.length - 1
  const shouldShowNavigation = hasSubmitted || canGoForward
  const historyItems = search.recentSearches.filter(Boolean).slice(0, 8)
  const captureEventCount = Number(search.stats?.eventCount || extension?.knowledge?.stats?.eventCount || 0)
  const hasBootstrapData =
    bootstrapState.status === 'complete' && Number(bootstrapState.imported_count || 0) > 0
  const captureInstalled = Boolean(extension?.bridgeDetected && !extension?.requiresBridge)
  const importRunning = bootstrapState.status === 'running' || bootstrapRequested
  const browserImportChecked = hasBootstrapData || importRunning
  const canAskMoreContext = contextRound < MAX_CONTEXT_ROUNDS
  const shouldAskForImport =
    extension?.bridgeDetected &&
    !extension?.requiresBridge &&
    !hasBootstrapData &&
    captureEventCount < 40 &&
    bootstrapState.status !== 'running' &&
    !importDecision
  const shouldShowInstallModal =
    extension?.requiresBridge &&
    setupPromptRequested &&
    !installPromptDismissed
  const shouldShowImportModal =
    !shouldShowInstallModal &&
    setupPromptRequested &&
    shouldAskForImport
  const shouldShowProcessingPane =
    !shouldShowInstallModal &&
    !shouldShowImportModal &&
    shouldKeepBootstrapPane

  const requestSetupPrompt = () => {
    setSetupPromptRequested(true)
  }

  const switchInputMode = (nextMode) => {
    if (nextMode === inputMode) return

    setInputMode(nextMode)
    setSubmittedQuery('')
    setLastSurveyPacket(null)
    setSurveyStep(0)
    setSurveyAnswers({})
    setContextSeedQuery('')
    setContextAnswers({})
    setContextQuestions(DEFAULT_CONTEXT_QUESTIONS)
    setContextRound(0)
    setContextAskedTitles([])
    setNavigation({ entries: [], index: -1 })
    setInfoOpen(false)
    setHistoryOpen(false)
    setSettingsOpen(false)
    search.setQuery('')
    search.clearResults()
  }

  const selectSurveyAnswer = (questionId, option) => {
    requestSetupPrompt()
    setSurveyAnswers((current) => ({
      ...current,
      [questionId]: option,
    }))
  }

  const selectContextAnswer = (questionId, option) => {
    requestSetupPrompt()
    setContextAnswers((current) => ({
      ...current,
      [questionId]: option,
    }))
  }

  const submitSurvey = async () => {
    const packet = createSurveyPacket(surveyAnswers, surveyDeck)
    setLastSurveyPacket(packet)
    saveSurveyPacket(packet)
    setContextSeedQuery('')
    setContextAnswers({})
    setContextRound(0)
    setContextAskedTitles([])
    await runQuery(packet.query, { mode: 'survey' })
  }

  const submitContextQuestions = async () => {
    const seedQuery = normalize(contextSeedQuery || submittedQuery || search.query)
    if (!seedQuery) return

    const nextQuery = buildContextQuery(seedQuery, contextQuestions, contextAnswers)
    const firstAnswer = Object.values(contextAnswers).find(Boolean)
    const packet = createSurveyPacket(
      {
        topic: { id: 'typed-thought', label: seedQuery, source: 'typed thought' },
        intent: { id: 'influence', label: 'What shaped it', relation: 'influenced_by' },
        evidence: {
          id: firstAnswer?.id || 'context',
          label: firstAnswer?.label || 'More context',
          relation: 'self_reported',
        },
      },
      surveyDeck,
      { query: nextQuery }
    )

    setLastSurveyPacket(packet)
    saveSurveyPacket(packet)
    setContextAskedTitles((current) => [
      ...current,
      ...contextQuestions.map((question) => normalize(question.title).toLowerCase()).filter(Boolean),
    ])
    setContextSeedQuery('')
    setContextAnswers({})
    setContextRound(Math.min(contextRound + 1, MAX_CONTEXT_ROUNDS))
    await runQuery(nextQuery, { mode: 'survey' })
  }

  const requestBootstrapImport = async () => {
    setSetupPromptRequested(true)
    setBootstrapRequested(true)
    setSettingsOpen(false)
    setHistoryOpen(false)
    setInfoOpen(false)
    setImportDecision('allowed')
    writeStoredValue(IMPORT_DECISION_KEY, 'allowed')

    try {
      const state = await extension?.startBootstrapImport?.({
        days: 21,
        limit: 320,
      })

      if (!state || normalize(state.status, 20).toLowerCase() === 'error') {
        setBootstrapRequested(false)
      }
    } catch {
      setBootstrapRequested(false)
    }
  }

  const clearBrowserImport = async () => {
    if (clearImportBusy || importRunning) return
    setClearImportBusy(true)
    try {
      const response = await extension?.clearBootstrapImport?.()
      if (response?.ok || response?.response?.ok) {
        setImportDecision('')
        setBootstrapRequested(false)
        writeStoredValue(IMPORT_DECISION_KEY, '')
        await extension?.refreshKnowledge?.()
      }
    } finally {
      setClearImportBusy(false)
    }
  }

  useEffect(() => {
    setInstallPromptDismissed(readStoredValue(INSTALL_PROMPT_DISMISSED_KEY) === '1')
    setImportDecision(readStoredValue(IMPORT_DECISION_KEY))
  }, [])

  useEffect(() => {
    if (extension?.bridgeDetected) {
      setInstallPromptDismissed(false)
      writeStoredValue(INSTALL_PROMPT_DISMISSED_KEY, '')
    }
  }, [extension?.bridgeDetected])

  useEffect(() => {
    if (hasBootstrapData || isBootstrapComplete) {
      setImportDecision('allowed')
      setBootstrapRequested(false)
      writeStoredValue(IMPORT_DECISION_KEY, 'allowed')
    }
  }, [hasBootstrapData, isBootstrapComplete])

  useEffect(() => {
    if (!bootstrapStatus || bootstrapStatus === 'running') {
      return
    }

    if (bootstrapStatus === 'complete' || bootstrapStatus === 'error') {
      setBootstrapRequested(false)
    }
  }, [bootstrapStatus])

  useEffect(() => {
    if (shouldKeepBootstrapPane) {
      setProcessingPaneCollapsed(false)
    }
  }, [shouldKeepBootstrapPane])

  useEffect(() => {
    const canAutoOpenInfo =
      extension?.bridgeDetected &&
      !extension?.requiresBridge &&
      bootstrapState.status !== 'running' &&
      !shouldShowInstallModal &&
      !shouldShowImportModal

    if (!canAutoOpenInfo) {
      return
    }

    if (readStoredValue(INFO_AUTOSHOW_KEY) === '1') {
      return
    }

    setInfoOpen(true)
    writeStoredValue(INFO_AUTOSHOW_KEY, '1')
  }, [
    bootstrapState.status,
    extension?.bridgeDetected,
    extension?.requiresBridge,
    shouldShowImportModal,
    shouldShowInstallModal,
  ])

  useEffect(() => {
    const query = normalize(contextSeedQuery)
    const fallbackQuestions = contextQuestionsForRound(contextRound)
    if (!query) {
      setContextQuestions(fallbackQuestions)
      return undefined
    }

    let cancelled = false
    setContextQuestions(fallbackQuestions)
    setContextAnswers({})

    requestCloudFollowUpQuestions({
      query,
      mode: 'survey',
      reason: 'weak_evidence',
      round: contextRound,
      avoidQuestions: [...priorContextTitles(contextRound), ...contextAskedTitles],
    }).then((questions) => {
      if (!cancelled && questions.length) {
        setContextQuestions(uniqueContextQuestions(questions, fallbackQuestions, contextRound, contextAskedTitles))
      }
    })

    return () => {
      cancelled = true
    }
  }, [contextAskedTitles, contextRound, contextSeedQuery])

  useEffect(() => {
    if (
      hasSubmitted &&
      lastSurveyPacket &&
      !search.loading &&
      !search.results.length &&
      submittedQuery &&
      !contextSeedQuery &&
      canAskMoreContext
    ) {
      setContextSeedQuery(submittedQuery)
    }
  }, [canAskMoreContext, contextSeedQuery, hasSubmitted, lastSurveyPacket, search.loading, search.results.length, submittedQuery])

  const runQuery = async (value = search.query, { record = true, mode = inputMode } = {}) => {
    const query = normalize(value)
    if (!query) return
    setInfoOpen(false)
    setHistoryOpen(false)
    search.setQuery(query)
    setSubmittedQuery(query)
    if (record) {
      setNavigation((current) => {
        const base =
          current.index >= 0
            ? current.entries.slice(0, current.index + 1)
            : []

        if (base[base.length - 1] === query) {
          return { entries: base, index: base.length - 1 }
        }

        const entries = [...base, query]
        return { entries, index: entries.length - 1 }
      })
    }
    const result = await search.runSearch(query)
    const resultItems = Array.isArray(result?.results) ? result.results : []
    const resultAnswer = result?.answerMeta || null

    if (mode === 'prompt' && !resultItems.length && needsMoreContext(resultAnswer)) {
      setInputMode('survey')
      setSubmittedQuery('')
      setLastSurveyPacket(null)
      setSurveyStep(0)
      setSurveyAnswers({})
      setContextRound(0)
      setContextAskedTitles([])
      setContextSeedQuery(query)
      setContextAnswers({})
      search.clearResults()
    }
  }

  const goBack = async () => {
    if (!canGoBack) {
      return
    }

    if (navigation.index === 0) {
      setSubmittedQuery('')
      setContextSeedQuery('')
      setContextAnswers({})
      setContextRound(0)
      setContextAskedTitles([])
      search.setQuery('')
      search.clearResults()
      setNavigation((current) => ({ ...current, index: -1 }))
      return
    }

    const nextIndex = navigation.index - 1
    const query = navigation.entries[nextIndex]
    if (!query) return
    setNavigation((current) => ({ ...current, index: nextIndex }))
    await runQuery(query, { record: false })
  }

  const goForward = async () => {
    if (!canGoForward) return
    const nextIndex = navigation.index + 1
    const query = navigation.entries[nextIndex]
    if (!query) return
    setNavigation((current) => ({ ...current, index: nextIndex }))
    await runQuery(query, { record: false })
  }

  const reloadCurrent = async () => {
    if (!submittedQuery) return
    await runQuery(submittedQuery, { record: false })
  }

  useEffect(() => {
    if ((!infoOpen && !historyOpen && !settingsOpen) || typeof window === 'undefined') {
      return undefined
    }

    const closePanels = () => {
      setInfoOpen(false)
      setHistoryOpen(false)
      setSettingsOpen(false)
    }
    const timer = infoOpen ? window.setTimeout(() => setInfoOpen(false), 30000) : null

    const handlePointerDown = (event) => {
      const target = event.target
      if (
        topActionsRef.current?.contains(target) ||
        historyPopoverRef.current?.contains(target) ||
        settingsPopoverRef.current?.contains(target)
      ) {
        return
      }
      closePanels()
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        closePanels()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      if (timer) window.clearTimeout(timer)
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [historyOpen, infoOpen, settingsOpen])

  return (
    <main className={`memact-page ${hasSubmitted ? 'has-results' : 'is-home'}`}>
      {shouldShowInstallModal ? (
        <OnboardingModal
          title="Install Capture first."
          body="Memact needs Capture to see your activity. Download the zip, unzip it, and load the folder in your browser."
          steps={[
            'Download the extension zip.',
            'Unzip it into a folder on your machine.',
            'Open chrome://extensions or edge://extensions.',
            'Turn on Developer Mode.',
            'Click Load unpacked and pick that folder.',
          ]}
          primaryAction={
            <a
              className="memact-modal__button memact-modal__button--primary"
              href="/memact-extension.zip"
              download="memact-extension.zip"
              onClick={() => {
                setInstallPromptDismissed(true)
                writeStoredValue(INSTALL_PROMPT_DISMISSED_KEY, '1')
              }}
            >
              Download extension zip
            </a>
          }
          secondaryAction={
            <button
              className="memact-modal__button"
              type="button"
              onClick={() => {
                setInstallPromptDismissed(true)
                writeStoredValue(INSTALL_PROMPT_DISMISSED_KEY, '1')
              }}
            >
              Continue without Capture
            </button>
          }
        />
      ) : null}

      {shouldShowImportModal ? (
        <OnboardingModal
          title="Import recent activity?"
          body="Memact can look at some recent activity on this device so it does not start empty. If you skip this, it will only use new activity from now on."
          steps={[
            'This stays on this device.',
            'Memact checks what to keep before it saves anything.',
            'If you skip this now, Memact will wait for new activity.',
          ]}
          primaryAction={
            <button
              className="memact-modal__button memact-modal__button--primary"
              type="button"
              onClick={() => {
                requestBootstrapImport()
              }}
            >
              Allow local import
            </button>
          }
          secondaryAction={
            <button
              className="memact-modal__button"
              type="button"
              onClick={() => {
                setImportDecision('denied')
                writeStoredValue(IMPORT_DECISION_KEY, 'denied')
              }}
            >
              Use future activity only
            </button>
          }
        />
      ) : null}

      {shouldShowNavigation ? (
        <nav className="result-controls" aria-label="Result navigation">
          <button
            className="nav-button nav-button--back"
            type="button"
            aria-label="Back"
            data-tooltip="Back"
            aria-disabled={!canGoBack}
            onClick={goBack}
          >
            <BackIcon />
          </button>
          <button
            className="nav-button nav-button--forward"
            type="button"
            aria-label="Forward"
            data-tooltip="Forward"
            aria-disabled={!canGoForward || search.loading}
            onClick={goForward}
          >
            <ForwardIcon />
          </button>
          <button
            className="nav-button nav-button--reload"
            type="button"
            aria-label="Reload"
            data-tooltip="Reload"
            aria-disabled={!hasSubmitted || search.loading}
            onClick={reloadCurrent}
          >
            <ReloadIcon />
          </button>
        </nav>
      ) : null}

      <div ref={topActionsRef} className="top-actions" aria-label="Memact actions">
        <button
          className="top-action-button top-action-button--history"
          type="button"
          aria-label="History"
          data-tooltip="History"
          aria-expanded={historyOpen}
          onClick={() => {
            setHistoryOpen((current) => !current)
            setInfoOpen(false)
            setSettingsOpen(false)
          }}
        >
          <HistoryIcon />
        </button>
        <button
          className="top-action-button top-action-button--settings"
          type="button"
          aria-label="Settings"
          data-tooltip="Settings"
          aria-expanded={settingsOpen}
          onClick={() => {
            setSettingsOpen((current) => !current)
            setHistoryOpen(false)
            setInfoOpen(false)
          }}
        >
          <SettingsIcon />
        </button>
        <button
          className="top-action-button top-action-button--info"
          type="button"
          aria-label="About Memact"
          data-tooltip="Info"
          aria-expanded={infoOpen}
          onClick={() => {
            setInfoOpen((current) => !current)
            setHistoryOpen(false)
            setSettingsOpen(false)
          }}
        >
          <InfoIcon />
        </button>
      </div>

      {infoOpen ? (
        <aside className="info-popover" role="dialog" aria-label="About Memact" onClick={() => setInfoOpen(false)}>
          <p>
            Memact helps you see where your thoughts may be coming from.
            It looks at what you read, watch, search, and revisit, then shows links that may have shaped a thought.
            {extension?.bootstrap?.imported_count
              ? ` It has already added ${extension.bootstrap.imported_count} early activity items from this device.`
              : ''}
          </p>
        </aside>
      ) : null}

      {settingsOpen ? (
        <aside ref={settingsPopoverRef} className="settings-popover" role="dialog" aria-label="Settings">
          <div className="settings-popover__section">
            <p className="settings-title">Settings</p>
            <p className="settings-copy">
              Keep Capture connected so Memact can use your activity here.
            </p>
            {captureInstalled ? (
              <div className="settings-status-pill" aria-label="Capture installed">
                <span className="settings-checkmark" aria-hidden="true" />
                <span>Capture installed</span>
              </div>
            ) : (
              <a
                className="settings-button"
                href="/memact-extension.zip"
                download="memact-extension.zip"
                onClick={() => setSettingsOpen(false)}
              >
                Install local extension
              </a>
            )}
          </div>

          <div className="settings-popover__section">
            <p className="settings-label">Browser activity import</p>
            <label className={`settings-checkbox-row ${browserImportChecked ? 'is-checked' : ''}`}>
              <input
                className="settings-checkbox-input"
                type="checkbox"
                checked={browserImportChecked}
                disabled={!captureInstalled || browserImportChecked || importRunning}
                onChange={() => {
                  if (!browserImportChecked) {
                    requestBootstrapImport()
                  }
                }}
              />
              <span
                className={`settings-checkmark ${browserImportChecked ? '' : 'is-empty'}`}
                aria-hidden="true"
              />
              <span>
                {hasBootstrapData
                  ? `Imported ${Number(bootstrapState.imported_count || 0)} items`
                  : importRunning
                    ? 'Importing recent activity'
                    : 'Import recent browser activity'}
              </span>
            </label>
            <p className="settings-helper">
              {captureInstalled
                ? 'This helps Memact form first suggestions without waiting for new activity.'
                : 'Install Capture first, then this can be turned on.'}
            </p>
            {hasBootstrapData ? (
              <button
                className="settings-button settings-button--ghost"
                type="button"
                disabled={clearImportBusy}
                onClick={clearBrowserImport}
              >
                {clearImportBusy ? 'Clearing import...' : 'Clear browser imported memories'}
              </button>
            ) : null}
          </div>
        </aside>
      ) : null}

      {historyOpen ? (
        <aside ref={historyPopoverRef} className="history-popover" role="dialog" aria-label="History">
          <div className="history-popover__top">
            <p className="history-title">History</p>
            {historyItems.length ? (
              <button
                className="history-clear-button"
                type="button"
                aria-label="Clear all history"
                data-tooltip="Clear all"
                onClick={() => search.clearHistory()}
              >
                <TrashIcon />
              </button>
            ) : null}
          </div>
          {historyItems.length ? (
            <div className="history-list">
              {historyItems.map((item) => (
                <div className="history-row" key={item}>
                  <button
                    className="history-query-button"
                    type="button"
                    onClick={() => runQuery(item)}
                  >
                    {item}
                  </button>
                  <button
                    className="history-delete-button"
                    type="button"
                    aria-label={`Delete ${item}`}
                    data-tooltip="Delete"
                    onClick={() => search.removeHistoryQuery(item)}
                  >
                    <DeleteIcon />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="history-empty">No history yet.</p>
          )}
        </aside>
      ) : null}

      <section className="search-home" aria-label="Memact input">
        <h1 className="memact-logo" aria-label="memact">
          <span aria-hidden="true" className="memact-wordmark">
            <span>m</span>
            <span>e</span>
            <span>m</span>
            <span>a</span>
            <span>c</span>
            <span>t</span>
          </span>
        </h1>
        <div className="brand-divider" aria-hidden="true" />
        <ModeSwitch
          mode={inputMode}
          onChange={switchInputMode}
        />
        {!hasSubmitted && inputMode === 'prompt' ? (
          <p className="thought-prompt">{thoughtPrompt}</p>
        ) : null}
        {inputMode === 'survey' ? (
          !hasSubmitted ? (
            contextSeedQuery ? (
              <ContextQuestionsPanel
                title={contextRound > 0 ? 'Go one level deeper.' : 'Help Memact connect this better.'}
                body={`"${contextSeedQuery}" needs a little more context before Memact checks your activity.`}
                questions={contextQuestions}
                answers={contextAnswers}
                disabled={isBackgroundProcessing || search.loading}
                onSelect={selectContextAnswer}
                onSubmit={submitContextQuestions}
              />
            ) : (
              <SurveyPanel
                deck={surveyDeck}
                step={surveyStep}
                answers={surveyAnswers}
                disabled={isBackgroundProcessing || search.loading}
                onSelect={selectSurveyAnswer}
                onBack={() => setSurveyStep((current) => Math.max(0, current - 1))}
                onNext={() => setSurveyStep((current) => Math.min(surveyDeck.questions.length - 1, current + 1))}
                onSubmit={submitSurvey}
              />
            )
          ) : null
        ) : (
          <SearchBar
            value={search.query}
            onChange={search.setQuery}
            onSubmit={(value) => {
              setLastSurveyPacket(null)
              runQuery(value)
            }}
            onSuggestionClick={(value) => {
              setLastSurveyPacket(null)
              runQuery(value)
            }}
            onInteraction={requestSetupPrompt}
            onVoiceStateChange={setVoiceState}
            placeholder={EXAMPLE_PLACEHOLDERS}
            loading={search.loading}
            disabled={isBackgroundProcessing}
            suggestions={suggestions}
            emptySuggestionMessage={emptySuggestionMessage}
          />
        )}
        {shouldShowStatus ? (
          <div className={`search-status-wrap ${shouldShowLoader ? 'is-loading' : ''}`}>
            {shouldShowLoader ? (
              <span className="memact-inline-loader" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            ) : null}
            <p className="search-status">{status}</p>
          </div>
        ) : null}
      </section>

      {hasSubmitted ? (
        lastSurveyPacket ? (
          <section className="answer-layout answer-layout--survey" aria-live="polite">
            <article className="answer-card answer-card--survey">
              <p className="eyebrow">Thought map</p>
              <blockquote>{buildSurveyHeadline(lastSurveyPacket)}</blockquote>
              <div className="answer-copy">
                <MathRichText text={buildSurveyCopy(lastSurveyPacket, search.results)} />
              </div>
              <div className="survey-map-grid" aria-label="Survey result map">
                {buildSurveyMapItems(lastSurveyPacket, search.results).map((item) => (
                  <p className="survey-map-item" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </p>
                ))}
              </div>
            </article>

            <section className="source-panel source-panel--survey" aria-label={search.results.length ? 'What Memact found' : 'More context'}>
              {search.results.length ? (
                <>
                  <p className="eyebrow">What Memact found</p>
                <div className="source-list">
                  {search.results.slice(0, 4).map((result, index) => (
                    <SourceCard key={result.id} result={result} index={index} />
                  ))}
                </div>
                </>
              ) : canAskMoreContext ? (
                <ContextQuestionsPanel
                  compact
                  title={contextRound > 0 ? 'One sharper check.' : 'Answer a bit more.'}
                  body="Memact can sharpen this map with a different set of choices."
                  questions={contextQuestions}
                  answers={contextAnswers}
                  disabled={search.loading}
                  onSelect={selectContextAnswer}
                  onSubmit={submitContextQuestions}
                />
              ) : (
                <div className="survey-answer-state">
                  <h3>Memact has enough context for now.</h3>
                  <p>
                    This answer is based on your choices and current memory. It can update later as Capture adds more activity.
                  </p>
                </div>
              )}
            </section>
          </section>
        ) : (
          <section className={`answer-layout ${search.results.length ? '' : 'answer-layout--answer-only'}`} aria-live="polite">
            <article className="answer-card">
              <p className="eyebrow">Answer</p>
              <blockquote>{answerHeadline}</blockquote>
              <div className="answer-copy">
                <MathRichText text={answerText} />
              </div>
              {!search.results.length ? (
                <button
                  className="answer-context-button"
                  type="button"
                  onClick={() => {
                    setInputMode('survey')
                    setSubmittedQuery('')
                    setContextRound(0)
                    setContextAskedTitles([])
                    setContextSeedQuery(submittedQuery)
                    setContextAnswers({})
                    search.clearResults()
                  }}
                >
                  Add more context
                </button>
              ) : null}
            </article>

            {search.results.length ? (
              <section className="source-panel" aria-label="Sources">
                <p className="eyebrow">Sources</p>
                <div className="source-list">
                  {search.results.slice(0, 4).map((result, index) => (
                    <SourceCard key={result.id} result={result} index={index} />
                  ))}
                </div>
              </section>
            ) : null}
          </section>
        )
      ) : null}

      {shouldShowProcessingPane ? (
        <aside
          className={`processing-pane ${processingPaneCollapsed ? 'is-collapsed' : 'is-expanded'} ${isBootstrapError ? 'is-error' : ''}`}
          role="status"
          aria-live="polite"
          aria-label="Memact setup progress"
        >
          {!processingPaneCollapsed ? (
            <div className="processing-pane__copy">
              <p className="processing-pane__eyebrow">Memact setup</p>
              <p className="processing-pane__title">
                {isBootstrapError ? 'Import needs attention.' : 'Working in the background.'}
              </p>
              <p className="processing-pane__text">
                {isBootstrapError
                  ? normalize(bootstrapState.error || 'Memact could not finish the local import.')
                  : 'Memact is going through recent activity and getting your first suggestions ready. Search will open when this finishes.'}
              </p>
              {!isBootstrapError ? (
                <div className="processing-pane__detail-grid">
                  <p className="processing-pane__detail">
                    <span>Stage</span>
                    <strong>{normalize(bootstrapState.stage || (bootstrapRequested ? 'starting' : 'processing'))}</strong>
                  </p>
                  <p className="processing-pane__detail">
                    <span>Imported</span>
                    <strong>{Number(bootstrapState.imported_count || 0)}</strong>
                  </p>
                  <p className="processing-pane__detail">
                    <span>Checked</span>
                    <strong>{Number(bootstrapState.scanned_count || bootstrapState.processed_count || 0)}</strong>
                  </p>
                  <p className="processing-pane__detail">
                    <span>Window</span>
                    <strong>{Number(bootstrapState.history_days || 0)} days</strong>
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="processing-pane__meta">
            <div className="processing-pane__progress">
              <div className="processing-pane__progress-bar">
                <span style={{ width: `${Math.max(4, bootstrapProgress)}%` }} />
              </div>
              {!processingPaneCollapsed ? (
                <p className="processing-pane__note">
                  {bootstrapState.note ||
                    (isBootstrapError
                      ? 'You can try local import again from Settings.'
                      : 'Checking what to keep.')}
                </p>
              ) : null}
            </div>
            <p className="processing-pane__percent">
              {bootstrapProgress}%
            </p>
            <button
              className="processing-pane__toggle"
              type="button"
              aria-label={processingPaneCollapsed ? 'Expand processing pane' : 'Shrink processing pane'}
              onClick={() => setProcessingPaneCollapsed((current) => !current)}
            >
              <CollapseIcon expanded={!processingPaneCollapsed} />
            </button>
          </div>
        </aside>
      ) : null}

    </main>
  )
}
