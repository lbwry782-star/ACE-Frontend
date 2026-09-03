import { getBuilder2OwnerBatchStateHeader } from '../utils/builder2OwnerContext.js'
import {
  isBuilder2OfflinePlaceholderModeActive,
  isBuilder2OfflineTestArmedWhileOnline,
  BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE,
  offlineGenerateVideo,
  offlineGenerateVideoNext,
  offlineFetchVideoStatus,
  offlineDownloadBuilder2Zip
} from '../utils/builder2OfflinePlaceholders.js'

function builder2OfflineTestArmedOnlineResponse() {
  return {
    ok: false,
    error: 'offline_test_armed_online',
    message: BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE
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
  return {
    Accept: 'application/json',
    'X-ACE-Batch-State': getBuilder2OwnerBatchStateHeader(),
    ...extra
  }
}

/**
 * GET backend security config. Used once at app startup.
 * On any failure (network, non-ok, parse error), returns { securityEnabled: true } (secure default).
 */
async function fetchSecurityConfig() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/security/config`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) return { securityEnabled: true }
    const data = await response.json()
    const enabled = data && typeof data.securityEnabled === 'boolean' ? data.securityEnabled : true
    return { securityEnabled: enabled }
  } catch (_) {
    return { securityEnabled: true }
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
async function generateVideo({ productName, productDescription, targetVideoCount, signal } = {}) {
  if (isBuilder2OfflineTestArmedWhileOnline()) {
    return builder2OfflineTestArmedOnlineResponse()
  }
  if (isBuilder2OfflinePlaceholderModeActive()) {
    return offlineGenerateVideo({ productName, productDescription, targetVideoCount })
  }

  try {
    const body = {
      productName: productName ?? '',
      productDescription: productDescription ?? ''
    }
    if (targetVideoCount === 1 || targetVideoCount === 2) {
      body.targetVideoCount = targetVideoCount
    }

    const response = await fetch(`${API_BASE_URL}/api/generate-video`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      signal,
      headers: buildBuilder2RequestHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(body)
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
 * POST /api/generate-video-next — starts Video #2 from existing allowance (Builder2).
 */
async function generateVideoNext({ videoAllowanceId, signal } = {}) {
  if (isBuilder2OfflineTestArmedWhileOnline()) {
    return builder2OfflineTestArmedOnlineResponse()
  }
  if (isBuilder2OfflinePlaceholderModeActive()) {
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
  if (isBuilder2OfflinePlaceholderModeActive()) {
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

  if (isBuilder2OfflinePlaceholderModeActive()) {
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

