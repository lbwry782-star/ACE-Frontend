/**
 * Centralized checkout auth headers when security mode is ON.
 * Protected Builder requests fail closed — zero network call without valid checkout.
 */

import { isSecurityEnabled } from './securityConfig.js'
import { readSecureCheckoutRecord } from '../utils/secureCheckout.js'

export class SecureCheckoutRequiredError extends Error {
  /**
   * @param {'secure_checkout_missing'|'secure_checkout_wrong_builder'|'secure_checkout_builder_required'} code
   */
  constructor(code = 'secure_checkout_missing') {
    super('Secure checkout context required')
    this.name = 'SecureCheckoutRequiredError'
    this.code = code
    this.isSecureCheckoutRequired = true
  }
}

/**
 * Fail-closed checkout headers for protected Builder1/Builder2 API calls.
 * @param {{ expectedBuilder: 'builder1'|'builder2' }} options
 * @returns {{ Authorization: string, 'X-ACE-Checkout-Id': string }}
 */
export function requireSecureCheckoutAuthHeaders(options) {
  if (!isSecurityEnabled()) {
    return {}
  }
  const expectedBuilder = options?.expectedBuilder ?? null
  if (expectedBuilder !== 'builder1' && expectedBuilder !== 'builder2') {
    throw new SecureCheckoutRequiredError('secure_checkout_builder_required')
  }
  const record = readSecureCheckoutRecord()
  if (!record) {
    throw new SecureCheckoutRequiredError('secure_checkout_missing')
  }
  if (record.builder !== expectedBuilder) {
    throw new SecureCheckoutRequiredError('secure_checkout_wrong_builder')
  }
  return {
    Authorization: `Bearer ${record.browserToken}`,
    'X-ACE-Checkout-Id': record.checkoutId
  }
}

/**
 * @deprecated Prefer requireSecureCheckoutAuthHeaders for protected routes.
 * @param {{ expectedBuilder?: 'builder1'|'builder2'|null }} [options]
 */
export function getSecureCheckoutAuthHeaders(options = {}) {
  const expectedBuilder = options.expectedBuilder ?? null
  if (!isSecurityEnabled()) {
    return {}
  }
  if (!expectedBuilder) {
    return {}
  }
  return requireSecureCheckoutAuthHeaders({ expectedBuilder })
}

/**
 * @param {'builder1'|'builder2'} builder
 * @returns {boolean}
 */
export function hasValidSecureCheckoutForBuilder(builder) {
  if (!isSecurityEnabled()) return true
  const record = readSecureCheckoutRecord()
  return Boolean(record && record.builder === builder)
}

/**
 * @returns {import('../utils/secureCheckout.js').SecureCheckoutRecord|null}
 */
export function getActiveSecureCheckout() {
  if (!isSecurityEnabled()) return null
  return readSecureCheckoutRecord()
}
