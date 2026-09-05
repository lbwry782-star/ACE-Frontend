/**
 * Secure payment checkout API — no iCount calls from frontend.
 */

import { API_BASE_URL } from './api.js'
import { normalizeSecureOfferCode } from '../utils/secureCheckoutOffers.js'

/**
 * @param {string} offerCode
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: string, httpStatus?: number }>}
 */
export async function createPaymentCheckout(offerCode) {
  const code = normalizeSecureOfferCode(offerCode)
  if (!code) {
    return { ok: false, error: 'invalid_offer_code' }
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/payments/checkout`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ offerCode: code })
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data || typeof data !== 'object') {
      return {
        ok: false,
        error: 'checkout_create_failed',
        httpStatus: response.status
      }
    }
    return { ok: true, data }
  } catch (_) {
    return { ok: false, error: 'checkout_create_network' }
  }
}

/**
 * @param {{ checkoutId: string, browserToken: string }} ctx
 */
export async function fetchPaymentCheckoutStatus({ checkoutId, browserToken }) {
  const id = String(checkoutId ?? '').trim()
  const token = String(browserToken ?? '').trim()
  if (!id || !token) {
    return { ok: false, error: 'missing_checkout_context' }
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/payments/checkout/status`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ checkoutId: id })
    })
    const data = await response.json().catch(() => null)
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'checkout_status_invalid', httpStatus: response.status }
    }
    return { ok: true, data, httpStatus: response.status }
  } catch (_) {
    return { ok: false, error: 'checkout_status_network' }
  }
}
