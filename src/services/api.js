import { getBuilder2OwnerBatchStateHeader } from '../utils/builder2OwnerContext.js'
import { isValidBuilder2RequestId } from '../utils/builder2RequestId.js'
import {
  isBuilder2IdempotencyConflict,
  isBuilder2IdempotencyInProgress,
  getBuilder2OwnershipErrorCode
} from '../utils/builder2Status.js'
import {
  isBuilder2OfflinePlaceholderModeActive,
  isBuilder2OfflinePlaceholderTransportActive,
  isBuilder2OfflineTestArmedWhileOnline,
  BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE,
  offlineGenerateVideo,
  offlineGenerateVideoNext,
  offlineFetchVideoStatus,
  offlineDownloadBuilder2Zip
} from '../utils/builder2OfflinePlaceholders.js'
import {
  isPreview2Builder2OfflineTestArmedWhileOnline,
  PREVIEW2_BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE
} from '../utils/preview2Builder2OfflineTest.js'
import { requireSecureCheckoutAuthHeaders } from './secureRequest.js'
import { isSecurityEnabled, loadSecurityConfig } from './securityConfig.js'

function builder2OfflineTestArmedOnlineResponse() {
  return {
    ok: false,
    error: 'offline_test_armed_online',
    message: BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE
  }
}

function builder2Preview2TestArmedOnlineResponse() {
  return {
    ok: false,
    error: 'preview2_test_armed_online',
    message: PREVIEW2_BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE
  }
}

// Get backend URL from environment variables
// Support both Vite (import.meta.env) and CRA (process.env)
const getBackendUrl = () => {
  // Vite
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) {
    const u = import.meta.env.VITE_BACKEND_URL
    if (u && String(u).trim()) return String(u).trim()
  }
  // CRA / Node.js
  if (typeof process !== 'undefined' && process.env?.REACT_APP_BACKEND_URL) {
    const u = process.env.REACT_APP_BACKEND_URL
    if (u && String(u).trim()) return String(u).trim()
  }
  // Fallback
  return 'https://ace-backend-k1p6.onrender.com'
}

// Normalize so `${API_BASE_URL}/api/...` never doubles slashes or uses relative base
const normalizeBaseUrl = (base) => {
  if (!base || typeof base !== 'string') return base
  let t = base.trim()
  // Remove trailing slash(es) only — do not strip path segments
  while (t.endsWith('/')) t = t.slice(0, -1)
  return t
}

const API_BASE_URL = normalizeBaseUrl(getBackendUrl())

/**
 * Builder2 requests share a stable X-ACE-Batch-State owner context.
 * @param {Record<string, string>} [extra]
 */
function buildBuilder2RequestHeaders(extra = {}) {
  const secureHeaders = isSecurityEnabled()
    ? requireSecureCheckoutAuthHeaders({ expectedBuilder: 'builder2' })
    : {}
  return {
    Accept: 'application/json',
    'X-ACE-Batch-State': getBuilder2OwnerBatchStateHeader(),
    ...secureHeaders,
    ...extra
  }
}

export const BUILDER2_MUTATION_RETRY_MAX_ATTEMPTS = 5
export const BUILDER2_MUTATION_RETRY_BASE_MS = 400

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Headers for paid Builder2 initial generate (ownership + request idempotency).
 * @param {string} requestId
 * @param {Record<string, string>} [extra]
 */
export function buildBuilder2MutationHeaders(requestId, extra = {}) {
  const trimmed = String(requestId ?? '').trim()
  if (!isValidBuilder2RequestId(trimmed)) {
    throw new Error('Builder2 mutation requires valid X-ACE-Request-Id')
  }
  return buildBuilder2RequestHeaders({
    'X-ACE-Request-Id': trimmed,
    ...extra
  })
}

function throwBuilder2IdempotencyConflict(payload, response) {
  const err = new Error('Builder2 idempotency conflict')
  err.code = 'builder2_idempotency_conflict'
  err.isIdempotencyConflict = true
  err.body = payload
  err.status = response?.status ?? 409
  throw err
}

/**
 * @param {object} body
 * @param {string} requestId
 * @param {RequestInit} [init]
 */
async function builder2GenerateVideoMutationFetch(body, requestId, init = {}) {
  const headers = buildBuilder2MutationHeaders(requestId, init.headers ?? {})
  let response
  try {
    response = await fetch(`${API_BASE_URL}/api/generate-video`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      ...init,
      headers,
      body: JSON.stringify(body)
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new NetworkError('Network error: Unable to connect to server')
  }
  const data = await response.json().catch(() => null)
  const payload =
    data && typeof data === 'object'
      ? { ...data, httpStatus: response.status }
      : { ok: false, httpStatus: response.status, error: 'Invalid response' }

  if (isBuilder2IdempotencyConflict(payload, response.status)) {
    throwBuilder2IdempotencyConflict(payload, response)
  }

  const ownership = getBuilder2OwnershipErrorCode(payload)
  if (ownership) {
    const err = new Error('Ownership verification failed')
    err.code = ownership
    err.isOwnershipError = true
    err.body = payload
    err.status = response.status
    throw err
  }

  if (!response.ok && !isBuilder2IdempotencyInProgress(payload, response.status)) {
    return { response, payload: { ok: false, ...payload } }
  }

  return { response, payload }
}

/**
 * Bounded retry for uncertain transport outcomes and idempotency-in-progress — same requestId each attempt.
 * @param {() => Promise<{ response: Response, payload: object }>} mutationFn
 * @param {{ maxAttempts?: number, baseDelayMs?: number }} [options]
 */
export async function callBuilder2MutationWithRetry(
  mutationFn,
  {
    maxAttempts = BUILDER2_MUTATION_RETRY_MAX_ATTEMPTS,
    baseDelayMs = BUILDER2_MUTATION_RETRY_BASE_MS
  } = {}
) {
  let lastInProgressPayload
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const { response, payload } = await mutationFn()
      if (isBuilder2IdempotencyInProgress(payload, response.status)) {
        lastInProgressPayload = payload
        if (attempt < maxAttempts - 1) {
          await sleep(baseDelayMs * (attempt + 1))
          continue
        }
        const err = new Error('Builder2 request still in progress')
        err.code = 'builder2_idempotency_in_progress'
        err.isIdempotencyInProgress = true
        err.body = payload
        err.status = response.status
        throw err
      }
      return { response, payload }
    } catch (error) {
      if (error?.isOwnershipError || error?.isIdempotencyConflict) throw error
      if (error?.name === 'AbortError') throw error
      if (error?.isIdempotencyInProgress) throw error
      if (!(error instanceof NetworkError)) throw error
      if (attempt < maxAttempts - 1) {
        await sleep(baseDelayMs * (attempt + 1))
        continue
      }
      throw error
    }
  }
  if (lastInProgressPayload) {
    const err = new Error('Builder2 request still in progress')
    err.code = 'builder2_idempotency_in_progress'
    err.isIdempotencyInProgress = true
    err.body = lastInProgressPayload
    throw err
  }
  throw new NetworkError('Network error: Unable to connect to server')
}

/**
 * Build canonical initial-generate POST body.
 * @param {{ productName?: string, productDescription?: string, targetVideoCount?: number }} input
 */
export function buildBuilder2InitialGeneratePayload(input = {}) {
  const body = {
    productName: input.productName ?? '',
    productDescription: input.productDescription ?? ''
  }
  const targetVideoCount = Number(input.targetVideoCount)
  if (targetVideoCount === 1 || targetVideoCount === 2) {
    body.targetVideoCount = targetVideoCount
  }
  return body
}

/**
 * Replay a persisted pending initial mutation with the SAME requestId and payload.
 * @param {import('../utils/builder2PendingMutation.js').parseBuilder2PendingMutationRecord extends (...args: any) => infer R ? R : never} pending
 */
export async function replayBuilder2PendingMutation(pending, { signal } = {}) {
  if (!pending?.requestId || !pending?.requestPayload) {
    throw new Error('Missing pending mutation for replay')
  }
  if (pending.operation !== 'initial_generate') {
    throw new Error('Unsupported Builder2 pending mutation operation')
  }
  return generateVideo({
    ...pending.requestPayload,
    requestId: pending.requestId,
    signal
  })
}

/**
 * @deprecated Prefer loadSecurityConfig() from securityConfig.js — fail-closed on errors.
 */
async function fetchSecurityConfig() {
  const snapshot = await loadSecurityConfig()
  return {
    securityEnabled: snapshot.securityEnabled === true,
    status: snapshot.status,
    error: snapshot.error ?? null
  }
}

/**
 * POST under-construction gate password. Backend-only check; no client-side comparison.
 * Returns { ok: true } only when backend JSON includes ok: true.
 */
async function checkUnderConstructionPassword(password) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/check-under-construction-password`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: password ?? '' })
    })
    if (!response.ok) return { ok: false }
    const data = await response.json().catch(() => null)
    if (!data || typeof data.ok !== 'boolean') return { ok: false }
    return { ok: data.ok }
  } catch (_) {
    return { ok: false }
  }
}

// GET latest-paid entitlement — path must match backend (deployed backend 404s on /api/entitlement/latest-paid if route differs)
const getLatestPaidPath = () => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_LATEST_PAID_PATH) {
    const p = String(import.meta.env.VITE_LATEST_PAID_PATH).trim()
    if (p) return p.startsWith('/') ? p : '/' + p
  }
  // Backend may expose under a different path — set VITE_LATEST_PAID_PATH if this 404s
  return '/api/entitlement/latest-paid'
}

/**
 * GET latest paid session for Builder guard (same origin as api/preview).
 * Uses API_BASE_URL + getLatestPaidPath() so requests always hit the backend, not the frontend origin.
 */
async function fetchLatestPaid() {
  const path = getLatestPaidPath()
  const url = `${API_BASE_URL}${path}`
  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    redirect: 'manual',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `latest-paid ${response.status}`)
  }
  return response.json()
}

// Custom error class for network errors
class NetworkError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NetworkError'
    this.isNetworkError = true
  }
}

// API error with code for backend busy (409) and rate_limited
class ApiError extends Error {
  constructor(message, { code, status } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

const TIMEOUT_MESSAGE = 'The preview request took too long. Please try again.'

// Start preview job: POST /api/preview -> { jobId }
async function startPreview(payload) {
  try {
    const requestBody = {
      productName: payload.productName,
      productDescription: payload.productDescription,
      imageSize: payload.imageSize,
      adIndex: payload.adIndex,
      batchState: payload.batchState,
      language: "en"
    }

    if (payload.sessionSeed) {
      requestBody.sessionSeed = payload.sessionSeed
    }
    if (payload.sid) {
      requestBody.sid = payload.sid
    }

    const response = await fetch(`${API_BASE_URL}/api/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(async () => {
        const errorText = await response.text().catch(() => '')
        return { message: errorText || `Server error: ${response.status}` }
      })
      const msg = errorData.message || errorData.error || `Server error: ${response.status}`
      const errStr = typeof msg === 'string' ? msg : (msg.message || '')
      const errLower = errStr.toLowerCase()

      if (response.status === 409 && errLower.includes('busy')) {
        throw new ApiError(errStr || 'Generation in progress', { code: 'BUSY', status: 409 })
      }
      if (response.status === 429 || errLower.includes('rate_limited') || errLower.includes('rate limited')) {
        throw new ApiError(errStr || 'Too many requests', { code: 'RATE_LIMITED', status: response.status })
      }
      throw new Error(errStr)
    }

    const data = await response.json()

    // Backend timeout / busy / rate_limited in 200 body
    if (data && data.error) {
      const errStr = typeof data.error === 'string' ? data.error : (data.error.message || '')
      const errLower = errStr.toLowerCase()
      if (errLower.includes('timeout')) {
        throw new Error(TIMEOUT_MESSAGE)
      }
      if (errLower.includes('busy')) {
        throw new ApiError(errStr || 'Generation in progress', { code: 'BUSY', status: 409 })
      }
      if (errLower.includes('rate_limited') || errLower.includes('rate limited')) {
        throw new ApiError(errStr || 'Too many requests', { code: 'RATE_LIMITED' })
      }
      throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Server error')
    }

    return data
  } catch (error) {
    if (
      error instanceof TypeError ||
      error.message.includes('fetch') ||
      error.message.includes('Network') ||
      error.message.includes('Failed to fetch') ||
      error.name === 'NetworkError'
    ) {
      throw new NetworkError('Network error: Unable to connect to server')
    }
    throw error
  }
}

// Poll job status: GET /api/job-status?jobId=...
async function getJobStatus(jobId) {
  if (!jobId) {
    throw new Error('Missing jobId')
  }

  const params = new URLSearchParams({ jobId: String(jobId) })
  const url = `${API_BASE_URL}/api/job-status?${params.toString()}`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      const errorData = await response.json().catch(async () => {
        const errorText = await response.text().catch(() => '')
        return { message: errorText || `Server error: ${response.status}` }
      })
      const msg = errorData.message || errorData.error || `Server error: ${response.status}`
      const errStr = typeof msg === 'string' ? msg : (msg.message || '')
      const errLower = errStr.toLowerCase()

      if (response.status === 409 && errLower.includes('busy')) {
        throw new ApiError(errStr || 'Generation in progress', { code: 'BUSY', status: 409 })
      }
      if (response.status === 429 || errLower.includes('rate_limited') || errLower.includes('rate limited')) {
        throw new ApiError(errStr || 'Too many requests', { code: 'RATE_LIMITED', status: response.status })
      }
      throw new Error(errStr)
    }

    const data = await response.json()

    // Backend timeout / busy / rate_limited / error in 200 body
    if (data && data.error) {
      const errStr = typeof data.error === 'string' ? data.error : (data.error.message || '')
      const errLower = errStr.toLowerCase()
      if (errLower.includes('timeout')) {
        throw new Error(TIMEOUT_MESSAGE)
      }
      if (errLower.includes('busy')) {
        throw new ApiError(errStr || 'Generation in progress', { code: 'BUSY', status: 409 })
      }
      if (errLower.includes('rate_limited') || errLower.includes('rate limited')) {
        throw new ApiError(errStr || 'Too many requests', { code: 'RATE_LIMITED' })
      }
      throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Server error')
    }

    return data
  } catch (error) {
    if (
      error instanceof TypeError ||
      error.message.includes('fetch') ||
      error.message.includes('Network') ||
      error.message.includes('Failed to fetch') ||
      error.name === 'NetworkError'
    ) {
      throw new NetworkError('Network error: Unable to connect to server')
    }
    throw error
  }
}

async function generate(payload) {
  try {
    const requestBody = {
      previewId: payload.previewId,
      adIndex: payload.adIndex,
      batchState: payload.batchState,
      language: "en"
    }
    
    // Include sessionSeed if provided (prevents repetition between sessions)
    if (payload.sessionSeed) {
      requestBody.sessionSeed = payload.sessionSeed
    }
    
    // Include sid if provided (required for session validation)
    if (payload.sid) {
      requestBody.sid = payload.sid
    }

    const response = await fetch(`${API_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      // Try to read error as JSON, fallback to text
      const errorData = await response.json().catch(async () => {
        const errorText = await response.text().catch(() => '')
        return { message: errorText || `Server error: ${response.status}` }
      })
      throw new Error(errorData.message || `Server error: ${response.status}`)
    }

    // Generate returns ZIP file (binary blob, not JSON)
    // Use response.blob() to read the ZIP file
    const zipBlob = await response.blob()
    const batchState = response.headers.get('x-ace-batch-state')
    return { zipBlob, batchState }
  } catch (error) {
    // Check for network/fetch errors
    if (
      error instanceof TypeError ||
      error.message.includes('fetch') ||
      error.message.includes('Network') ||
      error.message.includes('Failed to fetch') ||
      error.name === 'NetworkError'
    ) {
      throw new NetworkError('Network error: Unable to connect to server')
    }
    throw error
  }
}

/**
 * POST /api/generate-video — starts async video job; returns immediately with jobId (Builder2).
 */
async function generateVideo({
  productName,
  productDescription,
  targetVideoCount,
  signal,
  requestId
} = {}) {
  if (isPreview2Builder2OfflineTestArmedWhileOnline()) {
    return builder2Preview2TestArmedOnlineResponse()
  }
  if (isBuilder2OfflineTestArmedWhileOnline()) {
    return builder2OfflineTestArmedOnlineResponse()
  }
  if (isBuilder2OfflinePlaceholderTransportActive()) {
    return offlineGenerateVideo({ productName, productDescription, targetVideoCount })
  }

  if (!isValidBuilder2RequestId(requestId)) {
    throw new Error('generateVideo requires valid requestId for production')
  }

  try {
    const body = buildBuilder2InitialGeneratePayload({
      productName,
      productDescription,
      targetVideoCount
    })
    const { payload } = await callBuilder2MutationWithRetry(() =>
      builder2GenerateVideoMutationFetch(body, requestId, {
        signal,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    if (payload?.ok === false) {
      return payload
    }
    return payload
  } catch (error) {
    if (error?.isOwnershipError) {
      return {
        ok: false,
        error: error.code,
        isOwnershipError: true,
        ...error.body
      }
    }
    if (error?.isIdempotencyConflict) {
      return {
        ok: false,
        error: error.code,
        isIdempotencyConflict: true,
        ...error.body
      }
    }
    if (error?.isIdempotencyInProgress) {
      return {
        ok: false,
        error: error.code,
        isIdempotencyInProgress: true,
        ...error.body
      }
    }
    if (error?.name === 'AbortError') {
      return { ok: false, aborted: true }
    }
    return { ok: false, error: 'Network error' }
  }
}

/**
 * POST /api/generate-video-next — starts Video #2 from existing allowance (Builder2).
 */
async function generateVideoNext({ videoAllowanceId, signal } = {}) {
  if (isPreview2Builder2OfflineTestArmedWhileOnline()) {
    return builder2Preview2TestArmedOnlineResponse()
  }
  if (isBuilder2OfflineTestArmedWhileOnline()) {
    return builder2OfflineTestArmedOnlineResponse()
  }
  if (isBuilder2OfflinePlaceholderTransportActive()) {
    return offlineGenerateVideoNext({ videoAllowanceId })
  }

  const allowanceId = String(videoAllowanceId ?? '').trim()
  if (!allowanceId) {
    return { ok: false, error: 'Missing videoAllowanceId' }
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/generate-video-next`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      signal,
      headers: buildBuilder2RequestHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({ videoAllowanceId: allowanceId })
    })
    const data = await response.json().catch(() => null)
    if (!data || typeof data !== 'object') {
      return { ok: false }
    }
    if (!response.ok) {
      return { ok: false, ...data }
    }
    return data
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, aborted: true }
    }
    return { ok: false }
  }
}

/**
 * GET /api/video-status?jobId=... — poll async Builder2 video job (owner context required).
 */
async function fetchVideoStatus(jobId, { signal } = {}) {
  if (isBuilder2OfflinePlaceholderTransportActive()) {
    return offlineFetchVideoStatus(jobId)
  }

  try {
    const params = new URLSearchParams({ jobId: String(jobId) })
    const response = await fetch(`${API_BASE_URL}/api/video-status?${params}`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      signal,
      headers: buildBuilder2RequestHeaders()
    })
    const data = await response.json().catch(() => null)
    if (!data || typeof data !== 'object') {
      return { status: 'error', httpStatus: response.status, error: 'Invalid response' }
    }
    if (!response.ok) {
      return {
        status: 'error',
        httpStatus: response.status,
        error: data.error || data.message || `Server error: ${response.status}`,
        ...data
      }
    }
    return { ...data, httpStatus: response.status }
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { status: 'error', error: 'aborted', aborted: true }
    }
    return { status: 'error', error: 'Network error' }
  }
}

/**
 * POST /api/builder2/jobs/<jobId>/cancel — cancel active Builder2 job (idempotent).
 */
function buildBuilder2JobCancelUrl(jobId) {
  const id = encodeURIComponent(String(jobId ?? '').trim())
  return `${API_BASE_URL}/api/builder2/jobs/${id}/cancel`
}

async function cancelBuilder2Job(jobId, { signal, reason = 'frontend_refresh' } = {}) {
  const trimmed = String(jobId ?? '').trim()
  if (!trimmed) {
    return { ok: false, status: 'error', error: 'Missing jobId' }
  }
  try {
    const response = await fetch(buildBuilder2JobCancelUrl(trimmed), {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      signal,
      headers: buildBuilder2RequestHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({ reason })
    })
    const data = await response.json().catch(() => null)
    if (!data || typeof data !== 'object') {
      return { ok: false, status: 'error', error: 'Invalid response' }
    }
    if (!response.ok) {
      return {
        ok: false,
        status: 'error',
        error: data.error || data.message || `Server error: ${response.status}`,
        ...data
      }
    }
    return { ok: true, ...data }
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, aborted: true }
    }
    return { ok: false, status: 'error', error: 'Network error' }
  }
}

/**
 * Best-effort cancel during page unload (keepalive — browser may complete after navigation).
 */
function cancelBuilder2JobKeepalive(jobId, { reason = 'frontend_refresh' } = {}) {
  const trimmed = String(jobId ?? '').trim()
  if (!trimmed) return false
  try {
    void fetch(buildBuilder2JobCancelUrl(trimmed), {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      keepalive: true,
      headers: buildBuilder2RequestHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({ reason })
    })
    return true
  } catch (_) {
    return false
  }
}

/**
 * Parse filename from Content-Disposition header when present.
 * @param {string|null|undefined} header
 */
function parseContentDispositionFilename(header) {
  if (!header || typeof header !== 'string') return null
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim())
    } catch (_) {
      /* ignore */
    }
  }
  const quoted = header.match(/filename="([^"]+)"/i)
  if (quoted?.[1]) return quoted[1].trim()
  const plain = header.match(/filename=([^;\s]+)/i)
  if (plain?.[1]) return plain[1].trim().replace(/^["']|["']$/g, '')
  return null
}

const BUILDER2_ZIP_DEFAULT_FILENAME = 'ace-builder2-video.zip'

/**
 * POST /api/builder2-download-zip — download Builder2 result ZIP by exact jobId (binary blob).
 */
async function downloadBuilder2Zip({ jobId, signal } = {}) {
  const trimmedJobId = String(jobId ?? '').trim()
  if (!trimmedJobId) {
    throw new Error('Missing jobId')
  }

  if (isBuilder2OfflinePlaceholderTransportActive()) {
    return offlineDownloadBuilder2Zip({ jobId: trimmedJobId })
  }

  const response = await fetch(`${API_BASE_URL}/api/builder2-download-zip`, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    signal,
    headers: buildBuilder2RequestHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/zip, application/octet-stream, */*'
    }),
    body: JSON.stringify({ jobId: trimmedJobId })
  })

  if (!response.ok) {
    const errorData = await response.json().catch(async () => {
      const errorText = await response.text().catch(() => '')
      return { message: errorText || `Server error: ${response.status}` }
    })
    const msg = errorData?.message || errorData?.error || `Server error: ${response.status}`
    throw new Error(typeof msg === 'string' ? msg : 'Download failed')
  }

  const blob = await response.blob()
  const filename =
    parseContentDispositionFilename(response.headers.get('Content-Disposition')) ||
    BUILDER2_ZIP_DEFAULT_FILENAME
  return { blob, filename }
}

/**
 * POST /api/builder2-resume — resume durable Builder2 job from first incomplete stage.
 */
async function resumeBuilder2Job(jobId, { signal } = {}) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/builder2-resume`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      signal,
      headers: buildBuilder2RequestHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({ jobId: String(jobId) })
    })
    const data = await response.json().catch(() => null)
    if (!data || typeof data !== 'object') {
      return { ok: false, status: 'error', error: 'Invalid response' }
    }
    if (!response.ok) {
      return {
        ok: false,
        status: 'error',
        error: data.error || data.message || `Server error: ${response.status}`,
        ...data
      }
    }
    return { ok: true, ...data }
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, aborted: true }
    }
    return { ok: false, status: 'error', error: 'Network error' }
  }
}

/**
 * Download ZIP for a specific ad by session and index.
 * GET /api/download-zip?sessionId=...&adIndex=...
 */
async function downloadZip(sessionId, adIndex) {
  if (!sessionId || adIndex == null) {
    throw new Error('Missing sessionId or adIndex')
  }
  const params = new URLSearchParams({ sessionId: String(sessionId), adIndex: String(adIndex) })
  const url = `${API_BASE_URL}/api/download-zip?${params.toString()}`
  console.log('ZIP_URL_BUILT', { sessionIdUsed: sessionId, adIndex })
  const response = await fetch(url, { method: 'GET' })

  if (!response.ok) {
    const errorData = await response.json().catch(async () => {
      const errorText = await response.text().catch(() => '')
      return { message: errorText || `Server error: ${response.status}` }
    })
    throw new Error(errorData.message || errorData.error || `Server error: ${response.status}`)
  }

  const zipBlob = await response.blob()
  return { zipBlob }
}

export {
  startPreview,
  getJobStatus,
  generate,
  generateVideo,
  generateVideoNext,
  fetchVideoStatus,
  cancelBuilder2Job,
  cancelBuilder2JobKeepalive,
  buildBuilder2JobCancelUrl,
  downloadBuilder2Zip,
  parseContentDispositionFilename,
  BUILDER2_ZIP_DEFAULT_FILENAME,
  resumeBuilder2Job,
  buildBuilder2RequestHeaders,
  downloadZip,
  fetchLatestPaid,
  fetchSecurityConfig,
  checkUnderConstructionPassword,
  API_BASE_URL,
  getLatestPaidPath,
  NetworkError,
  ApiError
}

