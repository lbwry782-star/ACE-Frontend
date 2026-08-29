/**
 * Builder1 API client — ownership headers on all protected routes.
 */

import { API_BASE_URL, NetworkError } from './api.js'
import { getBuilder1OwnerBatchStateHeader, ensureBuilder1OwnerContext } from '../utils/builder1OwnerContext.js'
import {
  getBuilder1OwnershipErrorCode,
  isTransientBuilder1PollFailure,
  isBuilder1IdempotencyConflict
} from '../utils/builder1Status.js'
import { isValidBuilder1RequestId } from '../utils/builder1RequestId.js'

export const BUILDER1_POLL_INTERVAL_MS = 2000
export const BUILDER1_POLL_TIMEOUT_MS = 15 * 60 * 1000
export const BUILDER1_MUTATION_RETRY_MAX_ATTEMPTS = 4
export const BUILDER1_MUTATION_RETRY_BASE_MS = 1500

/**
 * Optional Authorization from existing app session (sid) — no new auth system.
 */
export function getBuilder1AuthorizationHeader() {
  if (typeof window === 'undefined') return null
  try {
    const sid =
      window.localStorage?.getItem('sid') ??
      window.sessionStorage?.getItem('sid') ??
      window.localStorage?.getItem('entitlementSid') ??
      window.sessionStorage?.getItem('entitlementSid')
    const trimmed = String(sid ?? '').trim()
    return trimmed ? `Bearer ${trimmed}` : null
  } catch (_) {
    return null
  }
}

/**
 * @param {Record<string, string>} [extra]
 */
export function buildBuilder1RequestHeaders(extra = {}) {
  ensureBuilder1OwnerContext()
  const headers = {
    Accept: 'application/json',
    'X-ACE-Batch-State': getBuilder1OwnerBatchStateHeader(),
    ...extra
  }
  const auth = getBuilder1AuthorizationHeader()
  if (auth) {
    headers.Authorization = auth
  }
  return headers
}

/**
 * Headers for paid Builder1 mutations (ownership + request idempotency).
 * @param {string} requestId
 * @param {Record<string, string>} [extra]
 */
export function buildBuilder1MutationHeaders(requestId, extra = {}) {
  const trimmed = String(requestId ?? '').trim()
  if (!isValidBuilder1RequestId(trimmed)) {
    throw new Error('Builder1 mutation requires valid X-ACE-Request-Id')
  }
  return buildBuilder1RequestHeaders({
    'X-ACE-Request-Id': trimmed,
    ...extra
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Bounded retry for uncertain transport outcomes — same requestId each attempt.
 * @param {() => Promise<{ response: Response, payload: object }>} mutationFn
 * @param {{ maxAttempts?: number, baseDelayMs?: number }} [options]
 */
export async function callBuilder1MutationWithRetry(
  mutationFn,
  { maxAttempts = BUILDER1_MUTATION_RETRY_MAX_ATTEMPTS, baseDelayMs = BUILDER1_MUTATION_RETRY_BASE_MS } = {}
) {
  let lastError
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await mutationFn()
    } catch (error) {
      if (error?.isOwnershipError || error?.isIdempotencyConflict) throw error
      if (error?.name === 'AbortError') throw error
      if (!(error instanceof NetworkError)) throw error
      lastError = error
      if (attempt < maxAttempts - 1) {
        await sleep(baseDelayMs * (attempt + 1))
      }
    }
  }
  throw lastError ?? new NetworkError('Network error: Unable to connect to server')
}

function throwBuilder1IdempotencyConflict(payload, response) {
  const err = new Error('Builder1 idempotency conflict')
  err.code = 'builder1_idempotency_conflict'
  err.isIdempotencyConflict = true
  err.body = payload
  err.status = response?.status ?? 409
  throw err
}

/**
 * @param {string} url
 * @param {object} body
 * @param {string} requestId
 * @param {RequestInit} [init]
 */
async function builder1MutationJsonFetch(url, body, requestId, init = {}) {
  const headers = buildBuilder1MutationHeaders(requestId, init.headers ?? {})
  const response = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    method: 'POST',
    ...init,
    headers,
    body: JSON.stringify(body)
  })
  const data = await response.json().catch(() => null)
  const payload =
    data && typeof data === 'object'
      ? { ...data, httpStatus: response.status }
      : { status: 'error', httpStatus: response.status, error: 'Invalid response' }

  if (isBuilder1IdempotencyConflict(payload, response.status)) {
    throwBuilder1IdempotencyConflict(payload, response)
  }

  if (getBuilder1OwnershipErrorCode(payload)) {
    const err = new Error(BUILDER1_OWNERSHIP_MESSAGE(payload))
    err.code = getBuilder1OwnershipErrorCode(payload)
    err.body = payload
    err.status = response.status
    err.isOwnershipError = true
    throw err
  }

  return { response, payload }
}

function buildBuilder1JobCancelUrl(jobId) {
  const id = encodeURIComponent(String(jobId ?? '').trim())
  return `${API_BASE_URL}/api/builder1/jobs/${id}/cancel`
}

/**
 * @param {object} body
 * @param {RequestInit} [init]
 */
async function builder1JsonFetch(url, init = {}) {
  const headers = buildBuilder1RequestHeaders(init.headers ?? {})
  const response = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    ...init,
    headers
  })
  const data = await response.json().catch(() => null)
  const payload =
    data && typeof data === 'object'
      ? { ...data, httpStatus: response.status }
      : { status: 'error', httpStatus: response.status, error: 'Invalid response' }

  if (getBuilder1OwnershipErrorCode(payload)) {
    const err = new Error(BUILDER1_OWNERSHIP_MESSAGE(payload))
    err.code = getBuilder1OwnershipErrorCode(payload)
    err.body = payload
    err.status = response.status
    err.isOwnershipError = true
    throw err
  }

  return { response, payload }
}

function BUILDER1_OWNERSHIP_MESSAGE(payload) {
  return 'Ownership verification failed for this Builder1 session.'
}

export async function builder1Generate(body, { signal, requestId } = {}) {
  if (!isValidBuilder1RequestId(requestId)) {
    throw new Error('builder1Generate requires valid requestId')
  }
  try {
    const { response, payload } = await builder1MutationJsonFetch(
      `${API_BASE_URL}/api/builder1-generate`,
      body,
      requestId,
      { signal, headers: { 'Content-Type': 'application/json' } }
    )
    return { response, payload }
  } catch (error) {
    if (error?.isOwnershipError || error?.isIdempotencyConflict) throw error
    if (error?.name === 'AbortError') throw error
    throw new NetworkError('Network error: Unable to connect to server')
  }
}

export async function builder1GenerateNext(body, { signal, requestId } = {}) {
  if (!isValidBuilder1RequestId(requestId)) {
    throw new Error('builder1GenerateNext requires valid requestId')
  }
  try {
    const { response, payload } = await builder1MutationJsonFetch(
      `${API_BASE_URL}/api/builder1-generate-next`,
      body,
      requestId,
      { signal, headers: { 'Content-Type': 'application/json' } }
    )
    return { response, payload }
  } catch (error) {
    if (error?.isOwnershipError || error?.isIdempotencyConflict) throw error
    if (error?.name === 'AbortError') throw error
    throw new NetworkError('Network error: Unable to connect to server')
  }
}

export async function builder1RetryImage(body, { signal, requestId } = {}) {
  if (!isValidBuilder1RequestId(requestId)) {
    throw new Error('builder1RetryImage requires valid requestId')
  }
  try {
    const { response, payload } = await builder1MutationJsonFetch(
      `${API_BASE_URL}/api/builder1-retry-image`,
      body,
      requestId,
      { signal, headers: { 'Content-Type': 'application/json' } }
    )
    return { response, payload }
  } catch (error) {
    if (error?.isOwnershipError || error?.isIdempotencyConflict) throw error
    if (error?.name === 'AbortError') throw error
    throw new NetworkError('Network error: Unable to connect to server')
  }
}

export async function builder1RepairPhysical(body, { signal, requestId } = {}) {
  if (!isValidBuilder1RequestId(requestId)) {
    throw new Error('builder1RepairPhysical requires valid requestId')
  }
  try {
    const { response, payload } = await builder1MutationJsonFetch(
      `${API_BASE_URL}/api/builder1-repair-physical`,
      body,
      requestId,
      { signal, headers: { 'Content-Type': 'application/json' } }
    )
    return { response, payload }
  } catch (error) {
    if (error?.isOwnershipError || error?.isIdempotencyConflict) throw error
    if (error?.name === 'AbortError') throw error
    throw new NetworkError('Network error: Unable to connect to server')
  }
}

/**
 * Replay a persisted pending mutation with the SAME requestId and payload.
 * @param {import('../utils/builder1PendingMutation.js').parseBuilder1PendingMutationRecord extends (...args: any) => infer R ? R : never} pending
 */
export async function replayBuilder1PendingMutation(pending, { signal } = {}) {
  if (!pending?.requestId || !pending?.requestPayload) {
    throw new Error('Missing pending mutation for replay')
  }
  const requestId = pending.requestId
  const body = pending.requestPayload
  switch (pending.operation) {
    case 'initial':
      return builder1Generate(body, { signal, requestId })
    case 'next':
    case 'retry':
    case 'repair':
      return builder1GenerateNext(body, { signal, requestId })
    default:
      return builder1GenerateNext(body, { signal, requestId })
  }
}

export async function builder1FetchStatus(jobId, { signal } = {}) {
  const params = new URLSearchParams({ jobId: String(jobId) })
  try {
    const { response, payload } = await builder1JsonFetch(
      `${API_BASE_URL}/api/builder1-status?${params}`,
      { method: 'GET', signal }
    )
    return { response, payload }
  } catch (error) {
    if (error?.isOwnershipError) throw error
    if (error?.name === 'AbortError') throw error
    throw new NetworkError('Network error: Unable to connect to server')
  }
}

export async function cancelBuilder1Job(jobId, { signal, reason = 'frontend_refresh' } = {}) {
  const trimmed = String(jobId ?? '').trim()
  if (!trimmed) {
    return { ok: false, status: 'error', error: 'Missing jobId' }
  }
  try {
    const { response, payload } = await builder1JsonFetch(buildBuilder1JobCancelUrl(trimmed), {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    })
    if (!response.ok) {
      return {
        ok: false,
        status: 'error',
        error: payload.error || payload.message || `Server error: ${response.status}`,
        ...payload
      }
    }
    return { ok: true, ...payload }
  } catch (error) {
    if (error?.isOwnershipError) {
      return {
        ok: false,
        status: 'error',
        error: error.code,
        httpStatus: error.status,
        isOwnershipError: true
      }
    }
    if (error?.name === 'AbortError') {
      return { ok: false, aborted: true }
    }
    return { ok: false, status: 'error', error: 'Network error' }
  }
}

export function cancelBuilder1JobKeepalive(jobId, { reason = 'frontend_refresh' } = {}) {
  const trimmed = String(jobId ?? '').trim()
  if (!trimmed) return false
  try {
    void fetch(buildBuilder1JobCancelUrl(trimmed), {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      keepalive: true,
      headers: buildBuilder1RequestHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({ reason })
    })
    return true
  } catch (_) {
    return false
  }
}

export async function builder1DownloadZip(body, { signal, acceptZip = true } = {}) {
  try {
    const headers = buildBuilder1RequestHeaders({
      'Content-Type': 'application/json',
      Accept: acceptZip
        ? 'application/zip, application/octet-stream, */*'
        : 'application/json'
    })
    const response = await fetch(`${API_BASE_URL}/api/builder1-zip`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      signal,
      headers,
      body: JSON.stringify(body)
    })

    if (response.status === 403) {
      const errBody = await response.json().catch(() => ({}))
      const merged = { ...errBody, httpStatus: 403 }
      if (getBuilder1OwnershipErrorCode(merged)) {
        const err = new Error('Ownership verification failed')
        err.code = getBuilder1OwnershipErrorCode(merged)
        err.isOwnershipError = true
        err.body = merged
        throw err
      }
    }

    return response
  } catch (error) {
    if (error?.isOwnershipError) throw error
    if (error?.name === 'AbortError') throw error
    throw new NetworkError('Network error: Unable to connect to server')
  }
}

/**
 * Resilient Builder1 job polling with transient network retry.
 */
export async function pollBuilder1Job({
  jobId,
  isStale,
  onStage,
  onTransientError,
  pollIntervalMs = BUILDER1_POLL_INTERVAL_MS,
  pollTimeoutMs = BUILDER1_POLL_TIMEOUT_MS
}) {
  const deadline = Date.now() + pollTimeoutMs
  let consecutiveTransientErrors = 0

  while (Date.now() < deadline) {
    if (isStale()) {
      throw new Error('Stale poll cancelled')
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    if (isStale()) {
      throw new Error('Stale poll cancelled')
    }

    let statusResponse
    let statusPayload
    try {
      ;({ response: statusResponse, payload: statusPayload } = await builder1FetchStatus(jobId))
    } catch (fetchErr) {
      if (fetchErr?.isOwnershipError) throw fetchErr
      if (
        fetchErr instanceof NetworkError ||
        fetchErr instanceof TypeError ||
        String(fetchErr?.message ?? '').includes('fetch') ||
        String(fetchErr?.message ?? '').includes('Network')
      ) {
        consecutiveTransientErrors += 1
        if (onTransientError) {
          onTransientError(consecutiveTransientErrors)
        }
        const backoffMs = Math.min(
          12000,
          pollIntervalMs + consecutiveTransientErrors * 1500
        )
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
        continue
      }
      throw fetchErr
    }

    if (isTransientBuilder1PollFailure(statusPayload) && !statusResponse.ok) {
      consecutiveTransientErrors += 1
      if (onTransientError) {
        onTransientError(consecutiveTransientErrors)
      }
      const backoffMs = Math.min(12000, pollIntervalMs + consecutiveTransientErrors * 1500)
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
      continue
    }

    consecutiveTransientErrors = 0

    const pollStatus = statusPayload?.status

    if (!statusResponse.ok) {
      if (statusResponse.status === 404) {
        throw new Error('job_not_found')
      }
      const msg = statusPayload?.message ?? statusPayload?.error
      throw new Error(typeof msg === 'string' ? msg : `Server error: ${statusResponse.status}`)
    }

    if (pollStatus === 'running') {
      if (onStage) {
        onStage(statusPayload?.stage, statusPayload)
      }
      continue
    }

    if (pollStatus === 'error') {
      const failCode = statusPayload?.error ?? statusPayload?.code
      const failMsg = statusPayload?.message ?? failCode
      const err = new Error(typeof failMsg === 'string' ? failMsg : 'Campaign generation failed')
      if (failCode) err.code = String(failCode)
      err.body = statusPayload
      err.status = statusResponse.status
      throw err
    }

    if (pollStatus === 'done') {
      return statusPayload?.result ?? null
    }
  }

  const timeoutErr = new Error('Generation timed out. Please try again.')
  timeoutErr.code = 'generation_timeout'
  throw timeoutErr
}
