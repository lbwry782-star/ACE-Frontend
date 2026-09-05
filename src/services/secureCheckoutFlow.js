/**
 * Secure Preview checkout initiation — POST /api/payments/checkout then sessionStorage.
 */

import {
  isSecurityConfigError,
  isSecurityConfigLoading,
  isSecurityEnabled
} from '../services/securityConfig.js'
import { createPaymentCheckout } from '../services/paymentsApi.js'
import {
  buildSecureCheckoutRecordFromResponse,
  writeSecureCheckoutRecord
} from '../utils/secureCheckout.js'
import { normalizeSecureOfferCode } from '../utils/secureCheckoutOffers.js'

/**
 * @param {string} offerCode
 * @returns {Promise<{ ok: true } | { ok: false, error: string, message?: string }>}
 */
export async function startSecurePreviewCheckout(offerCode) {
  const code = normalizeSecureOfferCode(offerCode)
  if (!code) {
    return { ok: false, error: 'invalid_offer_code', message: 'קוד הצעה לא תקין.' }
  }
  if (isSecurityConfigLoading()) {
    return { ok: false, error: 'security_loading', message: 'טוען הגדרות אבטחה…' }
  }
  if (isSecurityConfigError() || !isSecurityEnabled()) {
    return {
      ok: false,
      error: 'security_unavailable',
      message: 'שירות התשלום אינו זמין כרגע. נסו שוב בעוד רגע.'
    }
  }

  const checkoutResult = await createPaymentCheckout(code)
  if (!checkoutResult.ok) {
    return {
      ok: false,
      error: checkoutResult.error,
      message: 'לא ניתן להתחיל תשלום. נסו שוב בעוד רגע.'
    }
  }

  const built = buildSecureCheckoutRecordFromResponse(checkoutResult.data)
  if (!built.ok) {
    return { ok: false, error: built.error, message: 'תשובת שרת לא תקינה.' }
  }

  const stored = writeSecureCheckoutRecord(built.record)
  if (!stored) {
    return { ok: false, error: 'session_storage_failed', message: 'לא ניתן לשמור את פרטי התשלום.' }
  }

  window.location.assign(built.paymentUrl)
  return { ok: true }
}
