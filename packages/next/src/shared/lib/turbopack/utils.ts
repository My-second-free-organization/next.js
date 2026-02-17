import type {
  Issue,
  PlainTraceItem,
  StyledString,
  TurbopackResult,
} from '../../../build/swc/types'

import { bold, green, magenta, red } from '../../../lib/picocolors'
import stripAnsi from 'next/dist/compiled/strip-ansi'
import isInternal from '../is-internal'
import { deobfuscateText } from '../magic-identifier'
import type { EntryKey } from './entry-key'
import * as Log from '../../../build/output/log'
import type { NextConfigComplete } from '../../../server/config-shared'
import { codeFrameColumns } from '../errors/code-frame'

type IssueKey = `${Issue['severity']}-${Issue['filePath']}-${string}-${string}`
export type IssuesMap = Map<IssueKey, Issue>
export type EntryIssuesMap = Map<EntryKey, IssuesMap>
export type TopLevelIssuesMap = IssuesMap

const VERBOSE_ISSUES = !!process.env.NEXT_TURBOPACK_VERBOSE_ISSUES

/**
 * An error generated from emitted Turbopack issues. This can include build
 * errors caused by issues with user code.
 */
export class ModuleBuildError extends Error {
  name = 'ModuleBuildError'
}

/**
 * Thin stopgap workaround layer to mimic existing wellknown-errors-plugin in webpack's build
 * to emit certain type of errors into cli.
 */
export function isWellKnownError(issue: Issue): boolean {
  const { title } = issue
  const formattedTitle = renderStyledStringToErrorAnsi(title)
  // TODO: add more well known errors
  if (
    formattedTitle.includes('Module not found') ||
    formattedTitle.includes('Unknown module type')
  ) {
    return true
  }

  return false
}

export function getIssueKey(issue: Issue): IssueKey {
  return `${issue.severity}-${issue.filePath}-${JSON.stringify(
    issue.title
  )}-${JSON.stringify(issue.description)}`
}

export function processIssues(
  currentEntryIssues: EntryIssuesMap,
  key: EntryKey,
  result: TurbopackResult,
  throwIssue: boolean,
  logErrors: boolean
) {
  const newIssues = new Map<IssueKey, Issue>()
  currentEntryIssues.set(key, newIssues)

  const relevantIssues = new Set()

  for (const issue of result.issues) {
    if (
      issue.severity !== 'error' &&
      issue.severity !== 'fatal' &&
      issue.severity !== 'warning'
    )
      continue

    const issueKey = getIssueKey(issue)
    newIssues.set(issueKey, issue)

    if (issue.severity !== 'warning') {
      if (throwIssue) {
        const formatted = formatIssue(issue)
        relevantIssues.add(formatted)
      }
      // if we throw the issue it will most likely get handed and logged elsewhere
      else if (logErrors && isWellKnownError(issue)) {
        const formatted = formatIssue(issue)
        Log.error(formatted)
      }
    }
  }

  if (relevantIssues.size && throwIssue) {
    throw new ModuleBuildError([...relevantIssues].join('\n\n'))
  }
}

function formatFilePath(filePath: string): string {
  return filePath
    .replace('[project]/', './')
    .replaceAll('/./', '/')
    .replace('\\\\?\\', '')
}

// ANSI escape sequence regex (matches all ANSI control sequences)
const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?[\u0007])|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g

/**
 * Slices an ANSI-colored string by visible character positions.
 * ANSI escape codes have zero visible width and are preserved in the output.
 */
export function sliceByVisiblePos(
  str: string,
  visibleStart: number,
  visibleEnd: number
): string {
  const result: string[] = []
  let visibleIndex = 0
  let inRange = false
  let pos = 0

  while (pos < str.length && visibleIndex < visibleEnd) {
    ANSI_REGEX.lastIndex = pos
    const match = ANSI_REGEX.exec(str)

    if (match && match.index === pos) {
      // ANSI escape sequence at current position — always include if we're
      // in range or haven't started yet (so colors carry forward)
      if (inRange || visibleIndex >= visibleStart) {
        result.push(match[0])
        inRange = true
      }
      pos += match[0].length
    } else {
      // Visible character(s) up to the next ANSI code or end of string
      const nextAnsi = match ? match.index : str.length
      while (pos < nextAnsi && visibleIndex < visibleEnd) {
        if (visibleIndex >= visibleStart) {
          if (!inRange) {
            inRange = true
          }
          result.push(str[pos])
        }
        visibleIndex++
        pos++
      }
    }
  }

  // Include any trailing ANSI codes right after our range (e.g. resets)
  if (inRange) {
    ANSI_REGEX.lastIndex = pos
    let trailingMatch
    while (
      (trailingMatch = ANSI_REGEX.exec(str)) &&
      trailingMatch.index === pos
    ) {
      result.push(trailingMatch[0])
      pos += trailingMatch[0].length
      ANSI_REGEX.lastIndex = pos
    }
  }

  return result.join('')
}

// Left ellipsis: no leading space (gutter already ends with a space)
const LEFT_ELLIPSIS = '... '
const LEFT_ELLIPSIS_LEN = LEFT_ELLIPSIS.length
// Right ellipsis: no trailing space
const RIGHT_ELLIPSIS = ' ...'
const RIGHT_ELLIPSIS_LEN = RIGHT_ELLIPSIS.length
// Middle ellipsis: spaces on both sides for readability (e.g. in ^^^...^^^)
const MIDDLE_ELLIPSIS = ' ... '
const MIDDLE_ELLIPSIS_LEN = MIDDLE_ELLIPSIS.length

/**
 * Post-processes a codeFrameColumns output to truncate long lines.
 * Keeps the area around the error marker (^) visible and uses ellipsis
 * to indicate truncated content on either side.
 */
export function truncateCodeFrame(
  codeFrame: string,
  maxWidth: number = 200
): string {
  const lines = codeFrame.split('\n')

  // Check if any line needs truncation
  const needsTruncation = lines.some(
    (line) => stripAnsi(line).length > maxWidth
  )
  if (!needsTruncation) return codeFrame

  // Find gutter width and marker position from the code frame lines
  let gutterWidth = 0
  let markerContentCol = -1

  for (const line of lines) {
    const stripped = stripAnsi(line)
    const pipeIndex = stripped.indexOf('|')
    if (pipeIndex === -1) continue

    if (gutterWidth === 0) {
      // gutter includes "| " (pipe + space)
      gutterWidth = pipeIndex + 2
    }

    // Check if this is the marker line (has ^ after the pipe with only spaces before it)
    const afterPipe = stripped.slice(pipeIndex + 1)
    const caretMatch = /^( *)(\^+)/.exec(afterPipe)
    if (caretMatch && markerContentCol === -1) {
      // +1 for the space after pipe
      const markerStart = caretMatch[1].length
      const markerEnd = markerStart + caretMatch[2].length
      // Center on the midpoint of the marker span
      markerContentCol = Math.floor((markerStart + markerEnd) / 2)
    }
  }

  if (gutterWidth === 0) return codeFrame

  // Calculate the content window centered on the error marker
  const contentBudget = maxWidth - gutterWidth

  let contentStart: number
  let contentEnd: number

  if (markerContentCol === -1) {
    // No marker found — show from the start
    contentStart = 0
    contentEnd = contentBudget - RIGHT_ELLIPSIS_LEN
  } else {
    // Center window on the error marker
    const availableForContent =
      contentBudget - LEFT_ELLIPSIS_LEN - RIGHT_ELLIPSIS_LEN
    const halfWindow = Math.floor(availableForContent / 2)
    contentStart = Math.max(0, markerContentCol - halfWindow)

    if (contentStart === 0) {
      // No left ellipsis needed — more room on the right
      contentEnd = contentBudget - RIGHT_ELLIPSIS_LEN
    } else {
      contentEnd = contentStart + availableForContent
    }
  }

  return lines
    .map((line) => {
      const stripped = stripAnsi(line)
      const pipeIndex = stripped.indexOf('|')

      // Non-code-frame lines: skip if short, hard truncate if long
      if (pipeIndex === -1) {
        if (stripped.length <= maxWidth) return line
        return (
          sliceByVisiblePos(line, 0, maxWidth - RIGHT_ELLIPSIS_LEN) +
          RIGHT_ELLIPSIS
        )
      }

      // Code frame lines must always go through window-based truncation when
      // the window is shifted (contentStart > 0), even if the line itself is
      // short (e.g. a marker line like "    |      ^^^^^").
      if (stripped.length <= maxWidth && contentStart === 0) return line

      const contentLen = stripped.length - gutterWidth

      const actualStart = Math.min(contentStart, contentLen)
      const actualEnd = Math.min(contentEnd, contentLen)
      const needsLeftEllipsis = actualStart > 0
      const needsRightEllipsis = actualEnd < contentLen

      const gutter = sliceByVisiblePos(line, 0, gutterWidth)
      const content = sliceByVisiblePos(
        line,
        gutterWidth + actualStart,
        gutterWidth + actualEnd
      )

      // When a marker line (all ^) overflows both sides, the visible portion
      // is just a meaningless wall of identical carets. Collapse the middle
      // with ' ... ' to indicate the span continues.
      const strippedContent = stripAnsi(content)
      if (
        needsLeftEllipsis &&
        needsRightEllipsis &&
        /^\^+$/.test(strippedContent) &&
        strippedContent.length > MIDDLE_ELLIPSIS_LEN * 3
      ) {
        const halfCarets = Math.floor(
          (strippedContent.length - MIDDLE_ELLIPSIS_LEN) / 2
        )
        return (
          gutter +
          LEFT_ELLIPSIS +
          '^'.repeat(halfCarets) +
          MIDDLE_ELLIPSIS +
          '^'.repeat(
            strippedContent.length - halfCarets - MIDDLE_ELLIPSIS_LEN
          ) +
          RIGHT_ELLIPSIS
        )
      }

      return (
        gutter +
        (needsLeftEllipsis ? LEFT_ELLIPSIS : '') +
        content +
        (needsRightEllipsis ? RIGHT_ELLIPSIS : '')
      )
    })
    .join('\n')
}

export function formatIssue(issue: Issue) {
  const { filePath, title, description, detail, source, importTraces } = issue
  let { documentationLink } = issue
  const formattedTitle = renderStyledStringToErrorAnsi(title).replace(
    /\n/g,
    '\n    '
  )

  // TODO: Use error codes to identify these
  // TODO: Generalize adapting Turbopack errors to Next.js errors
  if (formattedTitle.includes('Module not found')) {
    // For compatiblity with webpack
    // TODO: include columns in webpack errors.
    documentationLink = 'https://nextjs.org/docs/messages/module-not-found'
  }

  const formattedFilePath = formatFilePath(filePath)

  let message = ''

  if (source?.range) {
    const { start } = source.range
    message = `${formattedFilePath}:${start.line + 1}:${
      start.column + 1
    }\n${formattedTitle}`
  } else if (formattedFilePath) {
    message = `${formattedFilePath}\n${formattedTitle}`
  } else {
    message = formattedTitle
  }
  message += '\n'

  if (
    source?.range &&
    source.source.content &&
    // ignore Next.js/React internals, as these can often be huge bundled files.
    !isInternal(filePath)
  ) {
    const { start, end } = source.range

    // TODO(lukesandberg): move codeFrame formatting into turbopack, it would be more efficient than passing the source back and forth
    const frame = codeFrameColumns(
      source.source.content,
      {
        start: {
          line: start.line + 1,
          column: start.column + 1,
        },
        end: {
          line: end.line + 1,
          column: end.column + 1,
        },
      },
      { color: true }
    )
    if (frame) {
      message += truncateCodeFrame(frame).trimEnd() + '\n\n'
    }
  }

  if (description) {
    if (
      description.type === 'text' &&
      description.value.includes(`Cannot find module 'sass'`)
    ) {
      message +=
        "To use Next.js' built-in Sass support, you first need to install `sass`.\n"
      message += 'Run `npm i sass` or `yarn add sass` inside your workspace.\n'
      message += '\nLearn more: https://nextjs.org/docs/messages/install-sass\n'
    } else {
      message += renderStyledStringToErrorAnsi(description) + '\n\n'
    }
  }

  // TODO: make it easier to enable this for debugging
  if (VERBOSE_ISSUES && detail) {
    message += renderStyledStringToErrorAnsi(detail) + '\n\n'
  }

  // Render additional sources (e.g., generated code from a loader)
  if (issue.additionalSources?.length) {
    for (const additional of issue.additionalSources) {
      const { description: desc, source: additionalSource } = additional
      if (
        additionalSource.range &&
        additionalSource.source.content &&
        // ignore Next.js/React internals, as these can often be huge bundled files.
        !isInternal(additionalSource.source.filePath)
      ) {
        message += `${desc}:\n`
        const { start, end } = additionalSource.range
        message += `${formatFilePath(additionalSource.source.filePath)}:${start.line + 1}:${start.column + 1}\n`
        const additionalFrame = codeFrameColumns(
          additionalSource.source.content,
          {
            start: {
              line: start.line + 1,
              column: start.column + 1,
            },
            end: {
              line: end.line + 1,
              column: end.column + 1,
            },
          },
          { color: true }
        )
        if (additionalFrame) {
          message += truncateCodeFrame(additionalFrame).trimEnd() + '\n\n'
        }
      }
    }
  }

  if (importTraces?.length) {
    // This is the same logic as in turbopack/crates/turbopack-cli-utils/src/issue.rs
    // We end up with multiple traces when the file with the error is reachable from multiple
    // different entry points (e.g. ssr, client)
    message += `Import trace${importTraces.length > 1 ? 's' : ''}:\n`
    const everyTraceHasADistinctRootLayer =
      new Set(importTraces.map(leafLayerName).filter((l) => l != null)).size ===
      importTraces.length
    for (let i = 0; i < importTraces.length; i++) {
      const trace = importTraces[i]
      const layer = leafLayerName(trace)
      let traceIndent = '    '
      // If this is true, layer must be present
      if (everyTraceHasADistinctRootLayer) {
        message += `  ${layer}:\n`
      } else {
        if (importTraces.length > 1) {
          // Otherwise use simple 1 based indices to disambiguate
          message += `  #${i + 1}`
          if (layer) {
            message += ` [${layer}]`
          }
          message += ':\n'
        } else if (layer) {
          message += ` [${layer}]:\n`
        } else {
          // If there is a single trace and no layer name just don't indent it.
          traceIndent = '  '
        }
      }
      message += formatIssueTrace(trace, traceIndent, !identicalLayers(trace))
    }
  }
  if (documentationLink) {
    message += documentationLink + '\n\n'
  }
  return message
}

/** Returns the first present layer name in the trace */
function leafLayerName(items: PlainTraceItem[]): string | undefined {
  for (const item of items) {
    const layer = item.layer
    if (layer != null) return layer
  }
  return undefined
}

/**
 * Returns whether or not all items share the same layer.
 * If a layer is absent we ignore it in this analysis
 */
function identicalLayers(items: PlainTraceItem[]): boolean {
  const firstPresentLayer = items.findIndex((t) => t.layer != null)
  if (firstPresentLayer === -1) return true // all layers are absent
  const layer = items[firstPresentLayer].layer
  for (let i = firstPresentLayer + 1; i < items.length; i++) {
    const itemLayer = items[i].layer
    if (itemLayer == null || itemLayer !== layer) {
      return false
    }
  }
  return true
}

function formatIssueTrace(
  items: PlainTraceItem[],
  indent: string,
  printLayers: boolean
): string {
  return `${items
    .map((item) => {
      let r = indent
      if (item.fsName !== 'project') {
        r += `[${item.fsName}]/`
      } else {
        // This is consistent with webpack's output
        r += './'
      }
      r += item.path
      if (printLayers && item.layer) {
        r += ` [${item.layer}]`
      }
      return r
    })
    .join('\n')}\n\n`
}

export function isRelevantWarning(issue: Issue): boolean {
  return issue.severity === 'warning' && !isNodeModulesIssue(issue)
}

function isNodeModulesIssue(issue: Issue): boolean {
  if (issue.severity === 'warning' && issue.stage === 'config') {
    // Override for the externalize issue
    // `Package foo (serverExternalPackages or default list) can't be external`
    if (
      renderStyledStringToErrorAnsi(issue.title).includes("can't be external")
    ) {
      return false
    }
  }

  return (
    issue.severity === 'warning' &&
    (issue.filePath.match(/^(?:.*[\\/])?node_modules(?:[\\/].*)?$/) !== null ||
      // Ignore Next.js itself when running next directly in the monorepo where it is not inside
      // node_modules anyway.
      // TODO(mischnic) prevent matches when this is published to npm
      issue.filePath.startsWith('[project]/packages/next/'))
  )
}

export function renderStyledStringToErrorAnsi(string: StyledString): string {
  function applyDeobfuscation(str: string): string {
    // Use shared deobfuscate function and apply magenta color to identifiers
    const deobfuscated = deobfuscateText(str)
    // Color any {...} wrapped identifiers with magenta
    return deobfuscated.replace(/\{([^}]+)\}/g, (match) => magenta(match))
  }

  switch (string.type) {
    case 'text':
      return applyDeobfuscation(string.value)
    case 'strong':
      return bold(red(applyDeobfuscation(string.value)))
    case 'code':
      return green(applyDeobfuscation(string.value))
    case 'line':
      return string.value.map(renderStyledStringToErrorAnsi).join('')
    case 'stack':
      return string.value.map(renderStyledStringToErrorAnsi).join('\n')
    default:
      throw new Error('Unknown StyledString type', string)
  }
}

export function isFileSystemCacheEnabledForDev(
  config: NextConfigComplete
): boolean {
  return config.experimental?.turbopackFileSystemCacheForDev || false
}
