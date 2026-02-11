import { nextTestSetup } from 'e2e-utils'
import { retry } from 'next-test-utils'
import stripAnsi from 'strip-ansi'

describe('webpack-loader-parse-error', () => {
  const { next, isTurbopack } = nextTestSetup({
    files: __dirname,
  })

  it('should show parse error for JS loader that returns broken code', async () => {
    // Fetch the page to trigger the error
    await next.fetch('/')

    // Check that the CLI output contains the parse error
    // Turbopack: "Parsing ecmascript source code failed"
    // Webpack: "Syntax Error"
    await retry(async () => {
      expect(next.cliOutput).toMatch(
        /Parsing ecmascript source code failed|Syntax Error/
      )
    })

    if (isTurbopack) {
      const output = stripAnsi(next.cliOutput)
      // Turbopack should show the generated code source context with the loader path
      expect(output).toMatch(/Caused by loaders.*broken-js-loader\.js/)
      // The invalid generated code should be shown in the error output
      expect(output).toContain('invalid jsx')
    }
  })

  it('should show parse error for CSS loader that returns broken code', async () => {
    // Fetch the page to trigger the CSS error
    await next.fetch('/css-page')

    // Check that the CLI output contains the CSS parse error
    // Turbopack: "Parsing CSS source code failed"
    // Webpack: "Unknown word"
    await retry(async () => {
      expect(next.cliOutput).toMatch(
        /Parsing CSS source code failed|Unknown word/
      )
    })

    if (isTurbopack) {
      const output = stripAnsi(next.cliOutput)
      // Turbopack should show the generated code source context with the loader path
      expect(output).toMatch(/Caused by.*loaders.*broken-css-loader\.js/)
      // The invalid generated CSS should be shown in the error output
      expect(output).toContain('THIS IS NOT VALID CSS')
    }
  })
})
