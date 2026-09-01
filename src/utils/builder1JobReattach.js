/**
 * Read-only Builder1 job reattachment — GET status only, no paid mutations.
 */

import { builder1FetchStatus, pollBuilder1Job } from '../services/builder1Api.js'
import {
  validateInitialCampaignResponse,
  createCampaignSessionFromInitial
} from './builder1Campaign.js'
import { resolveBuilder1InitialAdCount } from './builder1CampaignCount.js'

export const BUILDER1_RECOVER_JOB_QUERY_PARAM = 'builder1RecoverJobId'

const JOB_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * @param {unknown} jobId
 */
export function isPlausibleBuilder1JobId(jobId) {
  return JOB_ID_RE.test(String(jobId ?? '').trim())
}

/**
 * Route query from HashRouter location.search or hash fragment (never document search).
 * @param {string|null|undefined} routeSearch
 * @param {string|null|undefined} hash
 */
export function readBuilder1HashRouteQuery(routeSearch, hash) {
  const rawSearch = String(routeSearch ?? '').trim()
  if (rawSearch) {
    return rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch
  }
  const h = String(hash ?? '').trim()
  const qIndex = h.indexOf('?')
  if (qIndex < 0) return ''
  return h.slice(qIndex + 1)
}

/**
 * @param {string|null|undefined} query
 */
function readBuilder1RecoverJobIdFromQueryString(query) {
  const q = String(query ?? '').trim()
  if (!q) return null
  const id = new URLSearchParams(q).get(BUILDER1_RECOVER_JOB_QUERY_PARAM)
  if (!isPlausibleBuilder1JobId(id)) return null
  return String(id).trim()
}

/**
 * Canonical HashRouter recovery param reader — prefers route location.search.
 * @param {string|null|undefined} routeSearch
 * @param {string|null|undefined} [hash]
 */
export function readBuilder1RecoverJobIdFromRoute(routeSearch, hash) {
  const fromRoute = readBuilder1RecoverJobIdFromQueryString(
    readBuilder1HashRouteQuery(routeSearch, null)
  )
  if (fromRoute) return fromRoute
  return readBuilder1RecoverJobIdFromQueryString(readBuilder1HashRouteQuery(null, hash))
}

/**
 * @param {string} [hash]
 */
export function readBuilder1RecoverJobIdFromHash(hash) {
  return readBuilder1RecoverJobIdFromRoute(null, hash)
}

/**
 * Strip recovery param from route search; returns next search or '' when removed, null if absent.
 * @param {string|null|undefined} routeSearch
 */
export function stripBuilder1RecoverJobSearch(routeSearch) {
  const query = readBuilder1HashRouteQuery(routeSearch, null)
  if (!query) return null
  const params = new URLSearchParams(query)
  if (!params.has(BUILDER1_RECOVER_JOB_QUERY_PARAM)) return null
  params.delete(BUILDER1_RECOVER_JOB_QUERY_PARAM)
  const next = params.toString()
  return next ? `?${next}` : ''
}

/**
 * Remove builder1RecoverJobId from hash query without navigation.
 * @param {string} [hash]
 * @returns {string|null} new hash or null if unchanged
 */
export function stripBuilder1RecoverJobIdFromHash(hash) {
  const h = String(hash ?? (typeof window !== 'undefined' ? window.location.hash : '') ?? '')
  const qIndex = h.indexOf('?')
  if (qIndex < 0) return null
  const path = h.slice(0, qIndex)
  const params = new URLSearchParams(h.slice(qIndex + 1))
  if (!params.has(BUILDER1_RECOVER_JOB_QUERY_PARAM)) return null
  params.delete(BUILDER1_RECOVER_JOB_QUERY_PARAM)
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

/**
 * @param {string|null|undefined} routeSearch
 * @param {string|null|undefined} hash
 */
export function stripBuilder1RecoverJobFromRoute(routeSearch, hash) {
  const nextSearch = stripBuilder1RecoverJobSearch(routeSearch)
  if (nextSearch !== null) {
    return { kind: 'search', value: nextSearch }
  }
  const nextHash = stripBuilder1RecoverJobIdFromHash(hash)
  if (nextHash !== null) {
    return { kind: 'hash', value: nextHash }
  }
  return null
}

/**
 * @param {unknown} result
 * @param {number|null|undefined} targetAdCount
 */
export function hydrateBuilder1SessionFromStatusResult(result, targetAdCount) {
  const adCount = resolveBuilder1InitialAdCount({ targetAdCount })
  const validated = validateInitialCampaignResponse(result, adCount)
  if (!validated.ok) {
    return {
      ok: false,
      error: validated.error,
      message: validated.message ?? validated.error
    }
  }
  const sessionResult = createCampaignSessionFromInitial(validated, adCount)
  if (!sessionResult.ok) {
    return {
      ok: false,
      error: sessionResult.error,
      message: sessionResult.message ?? sessionResult.error
    }
  }
  return { ok: true, session: sessionResult.session }
}

/**
 * Read-only reattach: GET status (and optional read-only poll while running).
 * @param {string} jobId
 * @param {object} [options]
 */
export async function reattachBuilder1Job(jobId, options = {}) {
  const trimmed = String(jobId ?? '').trim()
  if (!isPlausibleBuilder1JobId(trimmed)) {
    return { ok: false, kind: 'invalid', message: 'Invalid job ID' }
  }

  const {
    targetAdCount,
    isStale = () => false,
    onStage,
    onTransientError,
    pollIfRunning = true
  } = options

  let statusResponse
  let statusPayload
  try {
    ;({ response: statusResponse, payload: statusPayload } = await builder1FetchStatus(trimmed))
  } catch (err) {
    if (err?.isOwnershipError) {
      return { ok: false, kind: 'ownership', error: err }
    }
    return { ok: false, kind: 'network', error: err, message: err?.message }
  }

  const pollStatus = String(statusPayload?.status ?? '').trim().toLowerCase()

  if (pollStatus === 'error') {
    const errorCode = statusPayload?.error ?? statusPayload?.code
    const message =
      statusPayload?.message ??
      (typeof errorCode === 'string' ? errorCode : 'Campaign generation failed')
    return {
      ok: false,
      kind: 'error',
      statusPayload,
      errorCode,
      message: typeof message === 'string' ? message : 'Campaign generation failed'
    }
  }

  if (pollStatus === 'done') {
    const result = statusPayload?.result ?? null
    const hydrated = hydrateBuilder1SessionFromStatusResult(result, targetAdCount)
    if (!hydrated.ok) {
      return { ok: false, kind: 'hydration', ...hydrated, statusPayload }
    }
    return { ok: true, kind: 'done', session: hydrated.session, statusPayload }
  }

  if (pollStatus === 'running') {
    if (!pollIfRunning) {
      return { ok: false, kind: 'running', statusPayload }
    }
    try {
      const result = await pollBuilder1Job({
        jobId: trimmed,
        isStale,
        onStage,
        onTransientError
      })
      const hydrated = hydrateBuilder1SessionFromStatusResult(result, targetAdCount)
      if (!hydrated.ok) {
        return { ok: false, kind: 'hydration', ...hydrated, statusPayload: { status: 'done', result } }
      }
      return {
        ok: true,
        kind: 'done',
        session: hydrated.session,
        statusPayload: { status: 'done', result }
      }
    } catch (err) {
      if (err?.isOwnershipError) {
        return { ok: false, kind: 'ownership', error: err }
      }
      if (err?.body) {
        return {
          ok: false,
          kind: 'error',
          statusPayload: err.body,
          errorCode: err.code ?? err.body?.error,
          message: err.message ?? err.body?.error
        }
      }
      return { ok: false, kind: 'poll', error: err, message: err?.message }
    }
  }

  return { ok: false, kind: 'unknown', statusPayload, message: 'Unexpected job status' }
}
