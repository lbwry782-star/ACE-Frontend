/**
 * Authenticated fetch for backend-gated media URLs when security is ON.
 */

import { API_BASE_URL } from '../services/api.js'
import { isSecurityEnabled } from '../services/securityConfig.js'
import { requireSecureCheckoutAuthHeaders } from '../services/secureRequest.js'

/**
 * @param {unknown} url
 */
export function isBackendProtectedMediaUrl(url) {
  const raw = String(url ?? '').trim()
  if (!raw) return false
  if (raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('offline-')) {
    return false
  }
  try {
    const parsed = new URL(raw, API_BASE_URL)
    const base = new URL(API_BASE_URL)
    return parsed.origin === base.origin && parsed.pathname.startsWith('/api/')
  } catch (_) {
    return raw.startsWith('/api/')
  }
}

/**
 * @param {string} url
 * @param {{ expectedBuilder?: 'builder1'|'builder2'|null, signal?: AbortSignal }} [options]
 */
export async function fetchAuthenticatedMediaBlob(url, options = {}) {
  const raw = String(url ?? '').trim()
  if (!raw) throw new Error('Missing media URL')

  const headers = { Accept: '*/*' }
  if (isSecurityEnabled()) {
    const expectedBuilder = options.expectedBuilder ?? null
    if (expectedBuilder !== 'builder1' && expectedBuilder !== 'builder2') {
      throw new Error('Protected media fetch requires expectedBuilder')
    }
    Object.assign(headers, requireSecureCheckoutAuthHeaders({ expectedBuilder }))
  }

  const response = await fetch(raw, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    headers,
    signal: options.signal
  })

  if (!response.ok) {
    throw new Error(`Media fetch failed (${response.status})`)
  }
  return response.blob()
}

/**
 * Resolve display URL — blob for protected backend routes when security ON.
 * @param {string|null|undefined} url
 * @param {{ expectedBuilder?: 'builder1'|'builder2'|null, signal?: AbortSignal }} [options]
 */
export async function resolveAuthenticatedMediaDisplayUrl(url, options = {}) {
  const raw = String(url ?? '').trim()
  if (!raw) return null
  if (!isSecurityEnabled() || !isBackendProtectedMediaUrl(raw)) {
    return raw
  }
  const blob = await fetchAuthenticatedMediaBlob(raw, options)
  return URL.createObjectURL(blob)
}

/**
 * @param {string|null|undefined} objectUrl
 */
export function revokeAuthenticatedMediaObjectUrl(objectUrl) {
  const raw = String(objectUrl ?? '').trim()
  if (raw.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(raw)
    } catch (_) {
      /* ignore */
    }
  }
}
