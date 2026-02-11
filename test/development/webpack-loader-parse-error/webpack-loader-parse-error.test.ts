import { nextTestSetup } from 'e2e-utils'
import { retry } from 'next-test-utils'

describe('webpack-loader-parse-error', () => {
  const { next, isTurbopack } = nextTestSetup({
    files: __dirname,
  })

  it('should show error when JS loader returns unparseable code', async () => {
    const browser = await next.browser('/')

    await retry(async () => {
      const errorText = await browser.elementByCss('body').text()
      // The error overlay or page should show a parse error
      expect(errorText).toMatch(/Parsing|parse|SyntaxError|error/i)
    })

    // Check that the CLI output contains the error with source information
    await retry(async () => {
      expect(next.cliOutput).toMatch(
        /Parsing ecmascript source code failed|SyntaxError/
      )
    })

    if (isTurbopack) {
      // In turbopack, we should see the additional source (generated code context)
      // The error should mention the loader transform in the additional context
      await retry(async () => {
        expect(next.cliOutput).toMatch(
          /Caused by|webpack loaders.*broken-js-loader/
        )
      })
    }
  })

  it('should show error when CSS loader returns unparseable code', async () => {
    const browser = await next.browser('/css-page')

    await retry(async () => {
      const text = await browser.elementByCss('body').text()
      // CSS parse errors should show up
      expect(text).toMatch(/error|Error/i)
    })

    await retry(async () => {
      expect(next.cliOutput).toMatch(
        /Parsing CSS|CSS.*failed|SyntaxError|css.*error/i
      )
    })

    if (isTurbopack) {
      await retry(async () => {
        expect(next.cliOutput).toMatch(
          /Caused by|webpack loaders.*broken-css-loader/
        )
      })
    }
  })
})
