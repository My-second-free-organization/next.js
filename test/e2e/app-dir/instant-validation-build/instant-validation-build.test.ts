import { nextTestSetup } from 'e2e-utils'

describe('instant-validation-build', () => {
  const { next, skipped, isNextStart } = nextTestSetup({
    files: __dirname,
    skipStart: true,
    skipDeployment: true,
  })

  if (skipped) {
    return
  }

  if (!isNextStart) {
    it.skip('Build-time only test', () => {})
    return
  }

  const prerender = async (pathname: string) => {
    const args = [
      '--experimental-build-mode',
      'generate',
      '--debug-build-paths',
      `app${pathname}/page.tsx`,
    ]
    return await next.build({
      args,
      env: {
        NEXT_TEST_LOG_VALIDATION: '1',
      },
    })
  }

  beforeAll(async () => {
    await next.build({ args: ['--experimental-build-mode', 'compile'] })
  })

  function expectNoValidationErrors(
    result: Awaited<ReturnType<typeof prerender>>
  ) {
    // Check the logs before checking the error code.
    // If it fails, the logs are more likely to show a useful reason than an error code.
    expect(result.cliOutput).not.toContain(
      'Build-time instant validation failed'
    )
    expect(result.exitCode).toBe(0)
  }

  describe('valid - suspense around runtime', () => {
    it('should succeed build when cookies are inside Suspense', async () => {
      const result = await prerender('/valid-suspense-around-runtime')
      expectNoValidationErrors(result)
    })
  })

  describe('invalid - missing suspense around runtime', () => {
    it('should fail build when cookies are outside Suspense', async () => {
      const result = await prerender('/invalid-missing-suspense-around-runtime')
      expect(result.exitCode).toBe(1)
      expect(result.cliOutput).toContain(
        'Build-time instant validation failed for route "/invalid-missing-suspense-around-runtime"'
      )
    })
  })

  describe('searchParams', () => {
    it('search params are correctly read from samples', async () => {
      const result = await prerender(
        '/search-params/valid-search-params-in-samples'
      )
      expectNoValidationErrors(result)
      // The page asserts on the values
      expect(result.cliOutput).not.toContain('AssertionError')
    })

    it('error - accessing search param not present in samples', async () => {
      const result = await prerender(
        '/search-params/invalid-undeclared-search-param'
      )
      expect(result.exitCode).toBe(1)
      expect(result.cliOutput).toContain(
        'accessed searchParam "undeclared" which is not defined'
      )
    })

    it('useSearchParams() receives search params from samples', async () => {
      const result = await prerender('/search-params/valid-use-search-params')
      expectNoValidationErrors(result)
      expect(result.cliOutput).not.toContain('ClientAssertionError')
    })

    it('error - accessing undeclared search param via useSearchParams()', async () => {
      const result = await prerender(
        '/search-params/invalid-undeclared-use-search-params'
      )
      expect(result.exitCode).toBe(1)
      expect(result.cliOutput).toContain(
        'accessed searchParam "undeclared" which is not defined'
      )
    })
  })

  describe('cookies', () => {
    it('cookies are correctly read from samples', async () => {
      const result = await prerender('/cookies/valid-cookies-in-samples')
      expectNoValidationErrors(result)
      // The page asserts on the values
      expect(result.cliOutput).not.toContain('AssertionError')
    })

    it('error - .get() of cookie not present in samples', async () => {
      const result = await prerender('/cookies/invalid-undeclared-cookie-get')
      expect(result.exitCode).toBe(1)
      expect(result.cliOutput).toContain(
        'accessed cookie "undeclaredCookie" which is not defined'
      )
      // The page asserts on the values
      expect(result.cliOutput).not.toContain('AssertionError')
    })

    it('error - .has() of cookie not present in samples', async () => {
      const result = await prerender('/cookies/invalid-undeclared-cookie-has')
      expect(result.exitCode).toBe(1)
      expect(result.cliOutput).toContain(
        'accessed cookie "undeclaredCookie" which is not defined'
      )
      // The page asserts on the values
      expect(result.cliOutput).not.toContain('AssertionError')
    })
  })

  describe('params', () => {
    it('valid - params are correctly read from samples', async () => {
      const result = await prerender(
        '/params/valid-params-in-samples/[one]/[two]'
      )
      expectNoValidationErrors(result)
      // The page asserts on the values
      expect(result.cliOutput).not.toContain('AssertionError')
    })

    it('error - reading a param not present in samples', async () => {
      const result = await prerender(
        '/params/invalid-param-not-provided/[one]/[two]'
      )
      expect(result.exitCode).toBe(1)
      expect(result.cliOutput).toContain(
        'accessed param "two" which is not defined'
      )
      // The page asserts on the values
      expect(result.cliOutput).not.toContain('AssertionError')
    })
  })

  describe('caches', () => {
    it('valid - static prefetch - awaiting a cache in the static stage does not require a suspense boundary', async () => {
      const result = await prerender(
        '/valid-await-cache-without-suspense/static'
      )
      expectNoValidationErrors(result)
    })

    it('valid - runtime prefetch - awaiting a cache in the runtime stage does not require a suspense boundary', async () => {
      const result = await prerender(
        '/valid-await-cache-without-suspense/runtime'
      )
      expectNoValidationErrors(result)
    })

    it('valid - runtime prefetch - awaiting a mix of caches in the static and runtime stages does not require a suspense boundary', async () => {
      const result = await prerender(
        '/valid-await-cache-without-suspense/mixed'
      )
      expectNoValidationErrors(result)
    })

    it('valid - runtime prefetch - awaiting a private cache in the runtime stage does not require a suspense boundary', async () => {
      const result = await prerender(
        '/valid-await-cache-without-suspense/private'
      )
      expectNoValidationErrors(result)
    })
  })
})
