import type { RuntimeSample } from '../../../build/segment-config/app/app-segment-config'
import type { ReadonlyRequestCookies } from '../../web/spec-extension/adapters/request-cookies'
import type { ReadonlyHeaders } from '../../web/spec-extension/adapters/headers'
import type { DraftModeProvider } from '../../async-storage/draft-mode-provider'
import type { Params } from '../../request/params'

import { RequestCookies } from '../../web/spec-extension/cookies'
import { RequestCookiesAdapter } from '../../web/spec-extension/adapters/request-cookies'
import { HeadersAdapter } from '../../web/spec-extension/adapters/headers'
import type { SearchParams } from '../../request/search-params'

const EXHAUSTIVE_SAMPLES_ERROR_DIGEST =
  'INSTANT_VALIDATION_EXHAUSTIVE_SAMPLES_ERROR'

/** Check if an error is an exhaustive samples validation error (by digest). */
export function isExhaustiveSamplesError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as any).digest === EXHAUSTIVE_SAMPLES_ERROR_DIGEST
  )
}

// TODO(instant-validation-build): maybe inline this, or rename
function createExhaustiveError(
  route: string,
  apiName: string,
  accessedName: string,
  sampleArrayName: string,
  nullExample: string
): Error {
  const error = new Error(
    `Route "${route}" accessed ${apiName} "${accessedName}" which is not defined in the \`samples\` ` +
      `of \`unstable_instant\`. Add it to the sample's \`${sampleArrayName}\` array` +
      (nullExample ? `, or ${nullExample} if it should be absent.` : '.')
  )
  ;(error as any).digest = EXHAUSTIVE_SAMPLES_ERROR_DIGEST
  return error
}

/**
 * Creates ReadonlyRequestCookies from sample cookie data.
 * Accessing a cookie not declared in the sample will throw an error.
 * Cookies with `value: null` are declared (allowed to access) but return no value.
 */
export function createCookiesFromSample(
  sampleCookies: NonNullable<RuntimeSample['cookies']>,
  route: string
): ReadonlyRequestCookies {
  // Build a Cookie header string from non-null sample cookies
  const cookieHeaderParts: string[] = []
  const declaredNames = new Set<string>()

  // TODO(instant-validation-build): this is weird. we should just use cookies.set(), which would also avoid escaping issues (the user sets what they expect to see).
  // we should also backfill a `cookie` header in `headers()`.
  for (const cookie of sampleCookies) {
    declaredNames.add(cookie.name)
    if (cookie.value !== null) {
      cookieHeaderParts.push(`${cookie.name}=${cookie.value}`)
    }
  }

  const cookieHeader = cookieHeaderParts.join('; ')
  const headers = new Headers()
  if (cookieHeader) {
    headers.set('cookie', cookieHeader)
  }
  const requestCookies = new RequestCookies(headers)
  const sealed = RequestCookiesAdapter.seal(requestCookies)

  // Wrap with exhaustive proxy
  return new Proxy(sealed, {
    get(target, prop, receiver) {
      if (prop === 'get' || prop === 'has') {
        const originalMethod = Reflect.get(target, prop, receiver) as Function
        return function (name: string) {
          if (!declaredNames.has(name)) {
            throw createExhaustiveError(
              route,
              'cookie',
              name,
              'cookies',
              `\`{ name: "${name}", value: null }\``
            )
          }
          return originalMethod.call(target, name)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

/**
 * Creates ReadonlyHeaders from sample header data.
 * Accessing a header not declared in the sample will throw an error.
 * Headers with `value: null` are declared (allowed to access) but return null.
 */
export function createHeadersFromSample(
  sampleHeaders: NonNullable<RuntimeSample['headers']>,
  route: string
): ReadonlyHeaders {
  const declaredNames = new Set<string>()
  const headersInit: Record<string, string> = {}

  for (const [name, value] of sampleHeaders) {
    declaredNames.add(name.toLowerCase())
    if (value !== null) {
      headersInit[name.toLowerCase()] = value
    }
  }

  const headers = HeadersAdapter.from(headersInit as any)
  const sealed = HeadersAdapter.seal(headers)

  // Wrap with exhaustive proxy
  return new Proxy(sealed, {
    get(target, prop, receiver) {
      if (prop === 'get' || prop === 'has') {
        const originalMethod = Reflect.get(target, prop, receiver) as Function
        return function (name: string) {
          if (!declaredNames.has(name.toLowerCase())) {
            throw createExhaustiveError(
              route,
              'header',
              name,
              'headers',
              `\`["${name}", null]\``
            )
          }
          return originalMethod.call(target, name)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

/**
 * Creates a DraftModeProvider that always returns isEnabled: false.
 */
export function createDraftModeForValidation(): DraftModeProvider {
  // Create a minimal DraftModeProvider-compatible object
  // that always reports draft mode as disabled.
  //
  // private properties that can't be set from outside the class.
  return {
    get isEnabled() {
      return false
    },
    enable() {
      throw new Error(
        'Draft mode cannot be enabled during build-time instant validation.'
      )
    },
    disable() {
      throw new Error(
        'Draft mode cannot be disabled during build-time instant validation.'
      )
    },
  } as Partial<DraftModeProvider> as DraftModeProvider
}

/**
 * Creates params wrapped with an exhaustive proxy.
 * Accessing a param not declared in the sample will throw an error.
 */
export function createExhaustiveParamsProxy(
  underlyingParams: Params,
  declaredParamNames: Set<string>,
  route: string
): Params {
  return new Proxy(underlyingParams, {
    get(target, prop, receiver) {
      if (isUserParamAccess(prop)) {
        if (!declaredParamNames.has(prop)) {
          throw new Error(
            `Route "${route}" accessed param "${prop}" which is not defined in the \`samples\` ` +
              `of \`unstable_instant\`. Add it to the sample's \`params\` object.`
          )
        }
      }
      return Reflect.get(target, prop, receiver)
    },
    has(target, prop) {
      if (isUserParamAccess(prop)) {
        if (!declaredParamNames.has(prop)) {
          throw new Error(
            `Route "${route}" accessed param "${prop}" which is not defined in the \`samples\` ` +
              `of \`unstable_instant\`. Add it to the sample's \`params\` object.`
          )
        }
      }
      return Reflect.has(target, prop)
    },
  })
}

// Properties accessed by the framework internals (e.g. RSC serialization)
// that should not trigger the exhaustive check.
const INTERNAL_OBJECT_PROPS = new Set(['then', 'toJSON', 'valueOf', 'toString'])

// TODO(instant-validation-build): we have other code like this, we should try to keep it in sync
function isUserParamAccess(prop: string | symbol): prop is string {
  if (typeof prop !== 'string') return false
  if (INTERNAL_OBJECT_PROPS.has(prop)) return false
  return true
}

/**
 * Creates searchParams wrapped with an exhaustive proxy.
 * Accessing a searchParam not declared in the sample will throw an error.
 * A searchParam with `value: undefined` means "declared but absent" (allowed to access, returns undefined).
 */
export function createExhaustiveSearchParamsProxy(
  searchParams: SearchParams,
  declaredSearchParamNames: Set<string>,
  route: string
): SearchParams {
  return new Proxy(searchParams, {
    get(target, prop, receiver) {
      if (isUserParamAccess(prop)) {
        if (!declaredSearchParamNames.has(prop)) {
          throw new Error(
            `Route "${route}" accessed searchParam "${prop}" which is not defined in the \`samples\` ` +
              `of \`unstable_instant\`. Add it to the sample's \`searchParams\` object, ` +
              `or \`{ "${prop}": null }\` if it should be absent.`
          )
        }
      }
      return Reflect.get(target, prop, receiver)
    },
    has(target, prop) {
      if (isUserParamAccess(prop)) {
        if (!declaredSearchParamNames.has(prop)) {
          throw new Error(
            `Route "${route}" accessed searchParam "${prop}" which is not defined in the \`samples\` ` +
              `of \`unstable_instant\`. Add it to the sample's \`searchParams\` object, ` +
              `or \`{ "${prop}": null }\` if it should be absent.`
          )
        }
      }
      return Reflect.has(target, prop)
    },
  })
}

export function createSearchParamsFromSample(
  sampleSearchParams: RuntimeSample['searchParams']
): SearchParams {
  if (!sampleSearchParams) return {}
  const searchParams: SearchParams = {}
  for (const [key, val] of Object.entries(sampleSearchParams)) {
    if (val !== null) {
      searchParams[key] = val
    }
  }
  return searchParams
}

/**
 * Wraps a URLSearchParams (or subclass like ReadonlyURLSearchParams) with an
 * exhaustive proxy. Accessing a search param not declared in the sample via
 * get/getAll/has will throw an error.
 */
export function createExhaustiveURLSearchParams<T extends URLSearchParams>(
  searchParams: T,
  declaredSearchParamNames: Set<string>,
  route: string
): T {
  return new Proxy(searchParams, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      // Intercept method calls that access specific param names
      if (prop === 'get' || prop === 'getAll' || prop === 'has') {
        return (name: string) => {
          if (typeof name === 'string' && !declaredSearchParamNames.has(name)) {
            throw createExhaustiveError(
              route,
              'searchParam',
              name,
              'searchParams',
              `\`{ "${name}": null }\` if it should be absent`
            )
          }
          return (value as Function).call(target, name)
        }
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function createURLSearchParamsFromSample(
  sampleSearchParams: NonNullable<RuntimeSample['searchParams']>
) {
  const result = new URLSearchParams()
  for (const [key, value] of Object.entries(sampleSearchParams)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) {
        result.append(key, v)
      }
    } else {
      result.set(key, value)
    }
  }
  return result
}
