import type {
  Issue,
  PlainTraceItem,
  StyledString,
} from '../../../build/swc/types'
import { codeFrameColumns } from 'next/dist/compiled/babel/code-frame'
import stripAnsi from 'next/dist/compiled/strip-ansi'
import { formatIssue, sliceByVisiblePos, truncateCodeFrame } from './utils'

function styledText(value: string): StyledString {
  return { type: 'text', value }
}

function traceItem(path: string, layer?: string): PlainTraceItem {
  return {
    fsName: 'project',
    path,
    layer,
    rootPath: '',
  }
}
describe('formatIssue', () => {
  const baseIssue: Omit<Issue, 'importTraces'> = {
    severity: 'error',
    filePath: '[project]/src/app/page.ts',
    title: styledText('Module not found'),
    source: undefined,
    documentationLink: 'https://nextjs.org/docs',
    stage: 'resolve',
  }

  it('formats a single import trace', () => {
    const trace: PlainTraceItem[] = [
      traceItem('src/app/page.ts', 'client'),
      traceItem('src/lib/foo.ts', 'client'),
    ]
    const issue: Issue = {
      ...baseIssue,
      importTraces: [trace],
    }
    const output = formatIssue(issue)
    expect(output).toBe(`\
./src/app/page.ts
Module not found
Import trace:
  client:
    ./src/app/page.ts
    ./src/lib/foo.ts

https://nextjs.org/docs/messages/module-not-found

`)
  })

  it('formats multiple import traces with distinct layers', () => {
    const trace1: PlainTraceItem[] = [
      traceItem('src/app/page.ts', 'client'),
      traceItem('src/lib/foo.ts', 'client'),
    ]
    const trace2: PlainTraceItem[] = [
      traceItem('src/app/page.ts', 'server'),
      traceItem('src/lib/foo.ts', 'server'),
    ]
    const issue: Issue = {
      ...baseIssue,
      importTraces: [trace1, trace2],
    }
    const output = formatIssue(issue)
    expect(output).toBe(`\
./src/app/page.ts
Module not found
Import traces:
  client:
    ./src/app/page.ts
    ./src/lib/foo.ts

  server:
    ./src/app/page.ts
    ./src/lib/foo.ts

https://nextjs.org/docs/messages/module-not-found

`)
  })

  it('formats multiple import traces with identical layers', () => {
    const trace1: PlainTraceItem[] = [
      traceItem('src/app/page.ts', 'client'),
      traceItem('src/lib/foo.ts', 'client'),
    ]
    const trace2: PlainTraceItem[] = [
      traceItem('src/app/other.ts', 'client'),
      traceItem('src/lib/bar.ts', 'client'),
    ]
    const issue: Issue = {
      ...baseIssue,
      importTraces: [trace1, trace2],
    }
    const output = formatIssue(issue)
    expect(output).toBe(`\
./src/app/page.ts
Module not found
Import traces:
  #1 [client]:
    ./src/app/page.ts
    ./src/lib/foo.ts

  #2 [client]:
    ./src/app/other.ts
    ./src/lib/bar.ts

https://nextjs.org/docs/messages/module-not-found

`)
  })

  it('handles missing layers in traces', () => {
    const trace: PlainTraceItem[] = [
      traceItem('src/app/page.ts'),
      traceItem('src/lib/foo.ts'),
    ]
    const issue: Issue = {
      ...baseIssue,
      importTraces: [trace],
    }
    const output = formatIssue(issue)
    expect(output).toBe(`\
./src/app/page.ts
Module not found
Import trace:
  ./src/app/page.ts
  ./src/lib/foo.ts

https://nextjs.org/docs/messages/module-not-found

`)
  })
})

describe('sliceByVisiblePos', () => {
  it('slices plain text like substring', () => {
    expect(sliceByVisiblePos('hello world', 0, 5)).toBe('hello')
    expect(sliceByVisiblePos('hello world', 6, 11)).toBe('world')
    expect(sliceByVisiblePos('hello world', 3, 8)).toBe('lo wo')
  })

  it('handles ANSI codes with zero width', () => {
    // bold "hello" = \x1b[1mhello\x1b[22m
    const bold = '\x1b[1mhello\x1b[22m world'
    // Slicing visible [0,5) should get "hello" with its ANSI codes
    const result = sliceByVisiblePos(bold, 0, 5)
    expect(result).toBe('\x1b[1mhello\x1b[22m')
  })

  it('preserves ANSI codes within the range', () => {
    // "aa\x1b[31mbb\x1b[0mcc" — "aa" then red "bb" then reset "cc"
    const str = 'aa\x1b[31mbb\x1b[0mcc'
    // Slicing [1,5) = "a" + red "bb" + reset "c"
    const result = sliceByVisiblePos(str, 1, 5)
    expect(result).toBe('a\x1b[31mbb\x1b[0mc')
  })

  it('returns empty string for empty range', () => {
    expect(sliceByVisiblePos('hello', 3, 3)).toBe('')
  })
})

describe('truncateCodeFrame', () => {
  it('returns unchanged output when lines are short', () => {
    const frame = [
      '  1 | short line',
      '> 2 | error here',
      '    |       ^',
      '  3 | another line',
    ].join('\n')

    expect(truncateCodeFrame(frame, 200)).toBe(frame)
  })

  it('truncates long lines with error in the middle', () => {
    // Build a long line with error marker at column 50 (after gutter)
    const content = 'a'.repeat(40) + 'ERROR' + 'b'.repeat(200)
    const frame = [
      `  1 | ${'x'.repeat(245)}`,
      `> 2 | ${content}`,
      `    | ${' '.repeat(40)}^^^^^`,
      `  3 | ${'y'.repeat(245)}`,
    ].join('\n')

    const result = truncateCodeFrame(frame, 80)
    const lines = result.split('\n')

    // All lines should be <= 80 visible chars
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(80)
    }

    // The error marker line should contain ^
    const markerLine = lines.find((l) => l.includes('^'))
    expect(markerLine).toBeDefined()

    // The highlighted line should contain ERROR
    const errorLine = lines.find((l) => l.includes('ERROR'))
    expect(errorLine).toBeDefined()

    // Should have ellipsis indicators
    expect(result).toContain('...')

    expect(result.split('\n')).toMatchInlineSnapshot(`
     [
       "  1 | ... xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ...",
       "> 2 | ... aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaERRORbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ...",
       "    | ...                               ^^^^^",
       "  3 | ... yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy ...",
     ]
    `)
  })

  it('truncates a wide error marker spanning many columns', () => {
    // The error marker covers a very long stretch (e.g. an entire expression)
    const prefix = 'a'.repeat(50)
    const error = 'SOME_LONG_EXPRESSION(arg1, arg2, arg3, arg4, arg5, arg6)'
    const suffix = 'b'.repeat(200)
    const content = prefix + error + suffix
    const frame = [
      `  1 | ${'x'.repeat(content.length)}`,
      `> 2 | ${content}`,
      `    | ${' '.repeat(50)}${'^'.repeat(error.length)}`,
      `  3 | ${'y'.repeat(content.length)}`,
    ].join('\n')

    const result = truncateCodeFrame(frame, 80)
    const lines = result.split('\n')

    // All lines should be <= 80 visible chars
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(80)
    }

    // The error content should be visible
    expect(lines[1]).toContain('SOME_LONG_EXPRESSION')

    // The marker line should contain carets
    const markerLine = lines[2]
    expect(markerLine).toContain('^')

    // First ^ should align with start of error in the content line
    const errorPos = lines[1].indexOf('SOME_LONG_EXPRESSION')
    const caretPos = markerLine.indexOf('^')
    expect(errorPos).toBe(caretPos)

    expect(result.split('\n')).toMatchInlineSnapshot(`
     [
       "  1 | ... xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ...",
       "> 2 | ... aaaaSOME_LONG_EXPRESSION(arg1, arg2, arg3, arg4, arg5, arg6)bbbbbb ...",
       "    | ...     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
       "  3 | ... yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy ...",
     ]
    `)
  })

  it('truncates an error marker wider than the visible window', () => {
    // The error marker is so wide it exceeds the entire content budget
    const prefix = 'a'.repeat(50)
    const error = 'SOME_VERY_LONG_EXPRESSION(' + 'param, '.repeat(25) + 'end)'
    const suffix = 'b'.repeat(200)
    const content = prefix + error + suffix
    const frame = [
      `  1 | ${'x'.repeat(content.length)}`,
      `> 2 | ${content}`,
      `    | ${' '.repeat(50)}${'^'.repeat(error.length)}`,
      `  3 | ${'y'.repeat(content.length)}`,
    ].join('\n')

    const result = truncateCodeFrame(frame, 80)
    const lines = result.split('\n')

    // All lines should be <= 80 visible chars
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(80)
    }

    // The marker is wider than the window, so the window centers on its midpoint.
    // The start of the expression may scroll out of view — that's expected.
    const markerLine = lines[2]
    expect(markerLine).toContain('^')

    // The visible portion should be all carets (the middle of the marker span)
    expect(result.split('\n')).toMatchInlineSnapshot(`
     [
       "  1 | ... xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ...",
       "> 2 | ... ram, param, param, param, param, param, param, param, param, param ...",
       "    | ... ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ... ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ...",
       "  3 | ... yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy ...",
     ]
    `)
  })

  it('does not add left ellipsis when error is near the start', () => {
    const content = 'ERROR' + 'b'.repeat(300)
    const frame = [`> 1 | ${content}`, `    | ^^^^^`].join('\n')

    const result = truncateCodeFrame(frame, 80)
    const lines = result.split('\n')

    // Highlighted line should start with gutter then content (no left ellipsis)
    expect(lines[0]).toMatch(/^> 1 \| ERROR/)
    // Should have right ellipsis (no trailing space)
    expect(lines[0]).toMatch(/ \.\.\.$/)

    expect(result.split('\n')).toMatchInlineSnapshot(`
     [
       "> 1 | ERRORbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ...",
       "    | ^^^^^",
     ]
    `)
  })

  it('adds left ellipsis when error is far from the start', () => {
    const content = 'a'.repeat(200) + 'ERROR' + 'b'.repeat(200)
    const frame = [`> 1 | ${content}`, `    | ${' '.repeat(200)}^^^^^`].join(
      '\n'
    )

    const result = truncateCodeFrame(frame, 80)
    const lines = result.split('\n')

    // Should have left ellipsis (ELLIPSIS is ' ... ' with surrounding spaces)
    expect(lines[0]).toMatch(/^> 1 \| +\.\.\./)
    expect(lines[0]).not.toMatch(/^> 1 \| [a-z]/)
    // Should contain ERROR
    expect(lines[0]).toContain('ERROR')

    expect(result.split('\n')).toMatchInlineSnapshot(`
     [
       "> 1 | ... aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaERRORbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ...",
       "    | ...                               ^^^^^",
     ]
    `)
  })

  it('keeps marker aligned with content after truncation', () => {
    // Place a marker at a known position
    const content = 'a'.repeat(100) + 'X' + 'b'.repeat(100)
    const spaces = ' '.repeat(100)
    const frame = [`> 1 | ${content}`, `    | ${spaces}^`].join('\n')

    const result = truncateCodeFrame(frame, 80)
    const lines = result.split('\n')
    const contentLine = lines[0]
    const markerLine = lines[1]

    // Find position of 'X' in the content line
    const xPos = contentLine.indexOf('X')
    // Find position of '^' in the marker line
    const caretPos = markerLine.indexOf('^')

    // They should be aligned (same column)
    expect(xPos).toBe(caretPos)

    expect(result.split('\n')).toMatchInlineSnapshot(`
     [
       "> 1 | ... aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaXbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ...",
       "    | ...                                 ^",
     ]
    `)
  })

  it('handles code frame with ANSI color codes', () => {
    // Simulate a colored code frame line
    const gutter = '\x1b[0m\x1b[31m\x1b[1m>\x1b[22m\x1b[39m\x1b[90m 1 |\x1b[39m'
    const content = 'a'.repeat(300)
    const frame = [
      `${gutter} ${content}\x1b[0m`,
      `\x1b[0m \x1b[90m   |\x1b[39m ^`,
    ].join('\n')

    const result = truncateCodeFrame(frame, 80)
    const lines = result.split('\n')

    // Visible length of each line should be <= 80
    for (const line of lines) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(80)
    }

    // Verify visible content of the truncated frame
    expect(stripAnsi(result).split('\n')).toMatchInlineSnapshot(`
     [
       "> 1 | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ...",
       "    | ^",
     ]
    `)
  })

  it('truncates context lines with the same window as the error line', () => {
    const longContent = 'x'.repeat(300)
    const errorContent = 'a'.repeat(100) + 'ERROR' + 'b'.repeat(195)
    const frame = [
      `  1 | ${longContent}`,
      `> 2 | ${errorContent}`,
      `    | ${' '.repeat(100)}^^^^^`,
      `  3 | ${longContent}`,
    ].join('\n')

    const result = truncateCodeFrame(frame, 80)
    const lines = result.split('\n')

    // Context lines (1, 3) and the error line (2) should have the same length
    // since they all use the same truncation window and all have content > windowEnd
    expect(lines[0].length).toBe(lines[1].length)
    expect(lines[0].length).toBe(lines[3].length)

    // All lines should be truncated
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(80)
    }

    expect(result.split('\n')).toMatchInlineSnapshot(`
     [
       "  1 | ... xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ...",
       "> 2 | ... aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaERRORbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ...",
       "    | ...                               ^^^^^",
       "  3 | ... xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ...",
     ]
    `)
  })

  describe('multi-line selection', () => {
    it('leaves short multi-line selection unchanged', () => {
      const frame = [
        '  1 | function foo() {',
        '> 2 |   const x = getSomething(',
        '    |             ^^^^^^^^^^^^^',
        '> 3 |     longArgument1,',
        '    | ^^^^^^^^^^^^^^^^^^',
        '> 4 |     longArgument2',
        '    | ^^^^^^^^^^^^^^^^^^',
        '> 5 |   );',
        '    | ^^^^',
        '  6 |   return x;',
        '  7 | }',
      ].join('\n')

      expect(truncateCodeFrame(frame, 200)).toBe(frame)
    })

    it('truncates long lines in a multi-line selection', () => {
      const longLine = 'a'.repeat(200)
      const frame = [
        '> 1 | short line',
        '    |      ^^^^^',
        `> 2 | ${longLine}`,
        `    | ${'^'.repeat(200)}`,
        '> 3 | another short line',
        '    | ^^^^^^^^',
        '  4 | final line',
      ].join('\n')

      const result = truncateCodeFrame(frame, 80)
      const lines = result.split('\n')

      // All lines should be <= 80 visible chars
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(80)
      }

      // Short lines should be unchanged
      expect(lines[0]).toBe('> 1 | short line')
      expect(lines[1]).toBe('    |      ^^^^^')

      expect(result.split('\n')).toMatchInlineSnapshot(`
       [
         "> 1 | short line",
         "    |      ^^^^^",
         "> 2 | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ...",
         "    | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ...",
         "> 3 | another short line",
         "    | ^^^^^^^^",
         "  4 | final line",
       ]
      `)
    })

    it('truncates all-long lines in a multi-line selection', () => {
      const frame = [
        `> 1 | ${'x'.repeat(200)}`,
        `    | ${' '.repeat(99)}${'^'.repeat(101)}`,
        `> 2 | ${'y'.repeat(200)}`,
        `    | ${'^'.repeat(200)}`,
        `> 3 | ${'z'.repeat(200)}`,
        `    | ${'^'.repeat(50)}`,
      ].join('\n')

      const result = truncateCodeFrame(frame, 80)
      const lines = result.split('\n')

      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(80)
      }

      expect(result.split('\n')).toMatchInlineSnapshot(`
       [
         "> 1 | ... xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ...",
         "    | ... ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ... ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ...",
         "> 2 | ... yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy ...",
         "    | ... ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ... ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ...",
         "> 3 | ... zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz ...",
         "    | ... ",
       ]
      `)
    })

    it('truncates multi-line selection with real codeFrameColumns', () => {
      const longLine =
        'import{a}from"mod1";import{b}from"mod2";' + 'c'.repeat(200)
      const source = [
        'const short = true;',
        longLine,
        'export default function Page() { return null; }',
      ].join('\n')

      const frame = codeFrameColumns(
        source,
        {
          start: { line: 1, column: 7 },
          end: { line: 3, column: 16 },
        },
        { forceColor: true }
      )
      const result = truncateCodeFrame(frame, 80)

      for (const line of stripAnsi(result).split('\n')) {
        expect(line.length).toBeLessThanOrEqual(80)
      }

      expect(stripAnsi(result).split('\n')).toMatchInlineSnapshot(`
       [
         "> 1 | const short = true;",
         "    |       ^^^^^^^^^^^^^",
         "> 2 | import{a}from"mod1";import{b}from"mod2";cccccccccccccccccccccccccccccc ...",
         "    | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ...",
         "> 3 | export default function Page() { return null; }",
         "    | ^^^^^^^^^^^^^^^^",
       ]
      `)
    })
  })

  describe('with real codeFrameColumns', () => {
    it('truncates minified CSS with error in the middle', () => {
      // Simulate minified CSS similar to compiled SCSS output
      const css =
        '.header{display:flex;align-items:center;justify-content:space-between;padding:0 16px}' +
        '.nav{display:flex;gap:8px}.nav a{color:#333;text-decoration:none}' +
        '.sidebar{width:250px;position:fixed;top:0;left:0;height:100vh;background:#f5f5f5}' +
        'input.defaultCheckbox::before path{fill:currentColor}' +
        'input:checked.defaultCheckbox::before{opacity:1}' +
        '.slide{animation:slide-in 0.3s ease-out;transform:translateX(0)}' +
        '.footer{padding:24px;text-align:center;border-top:1px solid #eee;margin-top:auto}'

      // Error at the invalid "::before path" selector
      const errorCol = css.indexOf('::before path') + 1

      const frame = codeFrameColumns(
        css,
        { start: { line: 1, column: errorCol } },
        { forceColor: true }
      )
      const result = truncateCodeFrame(frame, 80)

      // All visible lines should be <= 80 chars
      for (const line of stripAnsi(result).split('\n')) {
        expect(line.length).toBeLessThanOrEqual(80)
      }

      // The error area should still be visible
      expect(stripAnsi(result)).toContain('::before path')

      expect(stripAnsi(result).split('\n')).toMatchInlineSnapshot(`
       [
         "> 1 | ... nd:#f5f5f5}input.defaultCheckbox::before path{fill:currentColor}in ...",
         "    | ...                                 ^",
       ]
      `)
    })

    it('truncates minified JS with error near the start', () => {
      const js =
        'const x=;var y=function(){return{a:1,b:2,c:3}};' +
        'export default function Page(){return React.createElement("div",null,' +
        '"Hello World",React.createElement("p",null,"This is a test page"))}' +
        'function helper(a,b,c){return a+b+c}' +
        'const config={theme:{colors:{primary:"#0070f3",secondary:"#ff0080"}}}'

      // Error at the syntax error (=;)
      const frame = codeFrameColumns(
        js,
        { start: { line: 1, column: 9 } },
        { forceColor: true }
      )
      const result = truncateCodeFrame(frame, 80)

      for (const line of stripAnsi(result).split('\n')) {
        expect(line.length).toBeLessThanOrEqual(80)
      }

      // Error is near the start, so no left ellipsis needed
      expect(stripAnsi(result)).toContain('const x=;')

      expect(stripAnsi(result).split('\n')).toMatchInlineSnapshot(`
       [
         "> 1 | const x=;var y=function(){return{a:1,b:2,c:3}};export default function ...",
         "    |         ^",
       ]
      `)
    })

    it('leaves short multi-line code unchanged', () => {
      const source = [
        'function add(a, b) {',
        '  return a + b',
        '}',
        '',
        'add(1, "two")',
      ].join('\n')

      const frame = codeFrameColumns(
        source,
        { start: { line: 5, column: 8 } },
        { forceColor: true }
      )
      const result = truncateCodeFrame(frame, 200)

      // No truncation needed — output should be identical
      expect(result).toBe(frame)
    })

    it('truncates real codeFrameColumns output with ANSI and preserves alignment', () => {
      // Long single-line bundle
      const code =
        'import{jsx as _jsx}from"react/jsx-runtime";' +
        'import{useState}from"react";' +
        'function Counter(){const[count,setCount]=useState(0);' +
        'return _jsx("div",{children:[' +
        '_jsx("p",{children:"Count: " + count}),' +
        '_jsx("button",{onClick:()=>setCount(count+1),children:"Increment"}),' +
        'undefinedVariable.property,' +
        '_jsx("span",{children:"footer"})' +
        ']})}'

      const errorCol = code.indexOf('undefinedVariable') + 1

      const frame = codeFrameColumns(
        code,
        { start: { line: 1, column: errorCol } },
        { forceColor: true }
      )
      const result = truncateCodeFrame(frame, 80)

      // Visible widths should be within budget
      for (const line of stripAnsi(result).split('\n')) {
        expect(line.length).toBeLessThanOrEqual(80)
      }

      // The error target should be visible
      expect(stripAnsi(result)).toContain('undefinedVariable')

      // Marker should be aligned with the error
      const strippedLines = stripAnsi(result).split('\n')
      const contentLine = strippedLines[0]
      const markerLine = strippedLines[1]
      const errorPos = contentLine.indexOf('undefinedVariable')
      const caretPos = markerLine.indexOf('^')
      expect(errorPos).toBe(caretPos)

      expect(strippedLines).toMatchInlineSnapshot(`
       [
         "> 1 | ... count+1),children:"Increment"}),undefinedVariable.property,_jsx("s ...",
         "    | ...                                 ^",
       ]
      `)
    })
  })
})
