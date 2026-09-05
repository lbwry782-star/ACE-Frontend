/**
 * Same-tab secure checkout session (sessionStorage only).
 * browserToken never leaves sessionStorage.
 */

import {
  expectedQuantityFromOfferCode,
  normalizeSecureOfferCode,
  offerCodeToBuilder
} from './secureCheckoutOffers.js'

export const SECURE_CHECKOUT_SESSION_KEY = 'ace.security.checkout.v1'
export const SECURE_CHECKOUT_VERSION = 1

const CHECKOUT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * @typedef {object} SecureCheckoutRecord
 * @property {number} version
 * @property {string} checkoutId
 * @property {string} browserToken
 * @property {string} offerCode
 * @property {'builder1'|'builder2'} builder
 * @property {number} quantity
 * @property {number} paymentStartedAt
 */

/** @param {unknown} checkoutId */
export function isValidSecureCheckoutId(checkoutId) {
  return CHECKOUT_ID_RE.test(String(checkoutId ?? '').trim())
}

/**
 * @param {object} checkoutResponse — POST /api/payments/checkout body
 * @returns {{ ok: true, record: SecureCheckoutRecord, paymentUrl: string } | { ok: false, error: string }}
 */
export function buildSecureCheckoutRecordFromResponse(checkoutResponse) {
  const checkoutId = String(checkoutResponse?.checkoutId ?? '').trim()
  const browserToken = String(checkoutResponse?.browserToken ?? '').trim()
  const paymentUrl = String(checkoutResponse?.paymentUrl ?? '').trim()
  const offer = checkoutResponse?.offer ?? {}
  const offerCode = normalizeSecureOfferCode(offer.offerCode ?? checkoutResponse?.offerCode)
  const builder = offerCodeToBuilder(offerCode)
  const quantity = Number(offer.quantity ?? expectedQuantityFromOfferCode(offerCode))

  if (!isValidSecureCheckoutId(checkoutId)) {
    return { ok: false, error: 'invalid_checkout_id' }
  }
  if (!browserToken || browserToken.length < 16) {
    return { ok: false, error: 'invalid_browser_token' }
  }
  if (!paymentUrl.startsWith('https://')) {
    return { ok: false, error: 'invalid_payment_url' }
  }
  if (!offerCode || !builder) {
    return { ok: false, error: 'invalid_offer_code' }
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, error: 'invalid_quantity' }
  }

  /** @type {SecureCheckoutRecord} */
  const record = {
    version: SECURE_CHECKOUT_VERSION,
    checkoutId,
    browserToken,
    offerCode,
    builder,
    quantity,
    paymentStartedAt: Date.now()
  }
  return { ok: true, record, paymentUrl }
}

/**
 * @param {SecureCheckoutRecord} record
 * @param {Storage} [sessionStorage]
 */
export function writeSecureCheckoutRecord(record, sessionStorage = globalThis.sessionStorage) {
  if (!sessionStorage) return false
  try {
    sessionStorage.setItem(SECURE_CHECKOUT_SESSION_KEY, JSON.stringify(record))
    const readBack = readSecureCheckoutRecord(sessionStorage)
    return (
      readBack?.checkoutId === record.checkoutId &&
      readBack?.browserToken === record.browserToken
    )
  } catch (_) {
    return false
  }
}

/** @param {Storage} [sessionStorage] @returns {SecureCheckoutRecord|null} */
export function readSecureCheckoutRecord(sessionStorage = globalThis.sessionStorage) {
  if (!sessionStorage) return null
  try {
    const raw = sessionStorage.getItem(SECURE_CHECKOUT_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const checkoutId = String(parsed.checkoutId ?? '').trim()
    const browserToken = String(parsed.browserToken ?? '').trim()
    const offerCode = normalizeSecureOfferCode(parsed.offerCode)
    const builder = offerCodeToBuilder(offerCode)
    const quantity = Number(parsed.quantity)
    if (
      parsed.version !== SECURE_CHECKOUT_VERSION ||
      !isValidSecureCheckoutId(checkoutId) ||
      !browserToken ||
      !offerCode ||
      !builder ||
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      return null
    }
    return {
      version: SECURE_CHECKOUT_VERSION,
      checkoutId,
      browserToken,
      offerCode,
      builder,
      quantity,
      paymentStartedAt: Number(parsed.paymentStartedAt) || Date.now()
    }
  } catch (_) {
    return null
  }
}

/** @param {Storage} [sessionStorage] */
export function clearSecureCheckoutRecord(sessionStorage = globalThis.sessionStorage) {
  if (!sessionStorage) return
  try {
    sessionStorage.removeItem(SECURE_CHECKOUT_SESSION_KEY)
  } catch (_) {
    /* ignore */
  }
}

/**
 * Verify stored checkout matches backend status payload (fail closed on mismatch).
 * @param {SecureCheckoutRecord} stored
 * @param {object} statusPayload
 */
export function secureCheckoutMatchesStatus(stored, statusPayload) {
  if (!stored || !statusPayload || typeof statusPayload !== 'object') return false
  const statusCheckoutId = String(statusPayload.checkoutId ?? '').trim()
  if (statusCheckoutId && statusCheckoutId !== stored.checkoutId) return false
  const offer = statusPayload.offer ?? {}
  const statusOfferCode = normalizeSecureOfferCode(offer.offerCode ?? statusPayload.offerCode)
  if (statusOfferCode && statusOfferCode !== stored.offerCode) return false
  const statusBuilder = String(offer.builder ?? statusPayload.builder ?? '')
    .trim()
    .toLowerCase()
  if (statusBuilder && statusBuilder !== stored.builder) return false
  const statusQty = Number(offer.quantity ?? statusPayload.quantity)
  if (Number.isInteger(statusQty) && statusQty > 0 && statusQty !== stored.quantity) {
    return false
  }
  return true
}

/** Safe log fields — never includes browserToken. */
export function secureCheckoutPublicSummary(record) {
  if (!record) return null
  return {
    checkoutId: record.checkoutId,
    offerCode: record.offerCode,
    builder: record.builder,
    quantity: record.quantity
  }
}
