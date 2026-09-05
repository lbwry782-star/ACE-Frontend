/**
 * Paid quantity resolution — secure checkout is authoritative when security ON.
 */

import { isSecurityEnabled } from '../services/securityConfig.js'
import { readSecureCheckoutRecord } from './secureCheckout.js'
import { resolveBuilder1CheckoutAdCount } from './builder1Checkout.js'
import { resolveBuilder2CheckoutTargetVideoCount } from './builder2VideoCheckout.js'

/**
 * @param {object} [ctx]
 * @param {object} [storages]
 */
export function resolveBuilder1PaidAdCount(ctx = {}, storages = {}) {
  if (isSecurityEnabled()) {
    const sessionStorage = storages.sessionStorage ?? globalThis.sessionStorage
    const secure = readSecureCheckoutRecord(sessionStorage)
    if (!secure || secure.builder !== 'builder1') {
      return { adCount: null, checkoutId: null, source: 'secure-missing' }
    }
    return {
      adCount: secure.quantity,
      checkoutId: secure.checkoutId,
      source: 'secure-checkout',
      offerCode: secure.offerCode
    }
  }
  return resolveBuilder1CheckoutAdCount(ctx, storages)
}

/**
 * @param {object} [ctx]
 * @param {object} [storages]
 */
export function resolveBuilder2PaidTargetVideoCount(ctx = {}, storages = {}) {
  if (isSecurityEnabled()) {
    const sessionStorage = storages.sessionStorage ?? globalThis.sessionStorage
    const secure = readSecureCheckoutRecord(sessionStorage)
    if (!secure || secure.builder !== 'builder2') {
      return { targetVideoCount: null, checkoutId: null, source: 'secure-missing' }
    }
    return {
      targetVideoCount: secure.quantity,
      checkoutId: secure.checkoutId,
      source: 'secure-checkout',
      offerCode: secure.offerCode
    }
  }
  return resolveBuilder2CheckoutTargetVideoCount(ctx, storages)
}

/**
 * @param {object} [ctx]
 * @returns {number|null}
 */
export function resolveBuilder1InitialAdCountSecure(ctx = {}) {
  const resolved = resolveBuilder1PaidAdCount(ctx)
  if (resolved.adCount == null) return null
  return resolved.adCount
}
