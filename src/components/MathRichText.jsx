import { useMemo } from 'react'
import katex from 'katex'
import 'katex/contrib/mhchem/mhchem.js'
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'

const MATH_TOKEN_PATTERN =
  /(\\begin\{([a-zA-Z*]+)\}[\s\S]*?\\end\{\2\}|\\(?:ce|pu)\{[^{}]+\}|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(?<!\\)\$[^$\n]+?(?<!\\)\$)/g

const IMPLICIT_MATH_PATTERN =
  /(?:=|\\[a-zA-Z]+|[\u0370-\u03ff\u2200-\u22ff\u27c0-\u27ef\u2980-\u29ff\u2a00-\u2aff]|(?:sin|cos|tan|cot|sec|cosec|log|ln|exp|lim|det|min|max)\b|(?:->|<-|=>|<=)|\b[a-zA-Z]\s*(?:\^|_|\/|\*|\+|-)\s*[a-zA-Z0-9(])/i

const mathAdaptor = liteAdaptor()
RegisterHTMLHandler(mathAdaptor)

const mathJaxDocument = mathjax.document('', {
  InputJax: new TeX({
    packages: AllPackages,
    digits: /^(?:[0-9]+(?:\{,\}[0-9]{3})*(?:\.[0-9]*)?|\.[0-9]+)/,
  }),
  OutputJax: new SVG({
    fontCache: 'none',
  }),
})

function normalizeText(value) {
  return String(value || '')
}

function looksLikeImplicitMath(line) {
  const text = normalizeText(line).trim()
  if (!text || text.length > 160) {
    return false
  }

  if (!IMPLICIT_MATH_PATTERN.test(text)) {
    return false
  }

  const alphaChars = (text.match(/[A-Za-z]/g) || []).length
  const symbolChars = (text.match(/[=+\-/*^_()[\]{}<>≤≥≈≠→←↔∑∫√α-ωΑ-Ω]/g) || []).length
  return symbolChars >= 1 && (alphaChars <= 32 || symbolChars >= 2)
}

function parseImplicitMathSegments(value) {
  const lines = normalizeText(value).split('\n')
  if (lines.length <= 1) {
    return null
  }

  const segments = []
  for (const line of lines) {
    if (!line) {
      segments.push({ type: 'text', value: '\n' })
      continue
    }

    if (looksLikeImplicitMath(line)) {
      segments.push({
        type: 'math',
        value: line.trim(),
        displayMode: line.trim().length > 26,
        raw: line.trim(),
      })
      continue
    }

    segments.push({ type: 'text', value: `${line}\n` })
  }

  return segments
}

function parseSegments(text) {
  const value = normalizeText(text)
  const segments = []
  let lastIndex = 0

  value.replace(MATH_TOKEN_PATTERN, (match, _full, _env, offset) => {
    if (offset > lastIndex) {
      segments.push({
        type: 'text',
        value: value.slice(lastIndex, offset),
      })
    }

    let math = match
    let displayMode = false

    if (match.startsWith('$$') && match.endsWith('$$')) {
      math = match.slice(2, -2)
      displayMode = true
    } else if (match.startsWith('\\[') && match.endsWith('\\]')) {
      math = match.slice(2, -2)
      displayMode = true
    } else if (match.startsWith('\\(') && match.endsWith('\\)')) {
      math = match.slice(2, -2)
    } else if (match.startsWith('$') && match.endsWith('$')) {
      math = match.slice(1, -1)
    } else if (match.startsWith('\\begin{')) {
      displayMode = true
    } else if (match.startsWith('\\ce{') || match.startsWith('\\pu{')) {
      displayMode = false
    }

    segments.push({
      type: 'math',
      value: math.trim(),
      displayMode,
      raw: match,
    })

    lastIndex = offset + match.length
    return match
  })

  if (lastIndex < value.length) {
    segments.push({
      type: 'text',
      value: value.slice(lastIndex),
    })
  }

  if (segments.length) {
    return segments
  }

  return (
    parseImplicitMathSegments(value) || [
      {
        type: 'text',
        value,
      },
    ]
  )
}

function renderKatexSegment(value, displayMode) {
  try {
    return katex.renderToString(value, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'html',
      trust: false,
    })
  } catch {
    return ''
  }
}

function renderMathJaxSegment(value, displayMode) {
  try {
    const node = mathJaxDocument.convert(value, {
      display: displayMode,
      em: 16,
      ex: 8,
      containerWidth: 1280,
    })
    return mathAdaptor.outerHTML(node)
  } catch {
    return ''
  }
}

function renderMathSegment(value, displayMode) {
  return renderKatexSegment(value, displayMode) || renderMathJaxSegment(value, displayMode)
}

export default function MathRichText({ text, className = '', inline = false }) {
  const value = normalizeText(text)
  const segments = useMemo(() => parseSegments(value), [value])
  const Tag = inline ? 'span' : 'div'
  const classes = [
    'math-rich-text',
    inline ? 'math-rich-text--inline' : 'math-rich-text--block',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Tag className={classes}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return (
            <span key={`text-${index}`} className="math-rich-text__text">
              {segment.value}
            </span>
          )
        }

        const rendered = renderMathSegment(segment.value, segment.displayMode)
        if (!rendered) {
          return (
            <span key={`raw-${index}`} className="math-rich-text__text">
              {segment.raw}
            </span>
          )
        }

        return (
          <span
            key={`math-${index}`}
            className={`math-rich-text__math ${
              segment.displayMode ? 'math-rich-text__math--block' : 'math-rich-text__math--inline'
            }`}
            dangerouslySetInnerHTML={{ __html: rendered }}
          />
        )
      })}
    </Tag>
  )
}
