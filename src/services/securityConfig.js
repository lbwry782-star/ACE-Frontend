/**
 * Master frontend security config — sole authority is GET /api/security/config.
 * No VITE_ or localStorage toggle. Fail closed on network/5xx/malformed.
 */

import { API_BASE_URL } from './api.js'

/** @typedef {'loading'|'enabled'|'disabled'|'error'} SecurityConfigStatus */

/** @type {{ status: SecurityConfigStatus, securityEnabled: boolean, error?: string|null }} */
let _state = {
  status: 'loading',
  securityEnabled: false,
  error: null
}

const _listeners = new Set()

/** @returns {{ status: SecurityConfigStatus, securityEnabled: boolean, securityConfigLoaded: boolean, error?: string|null }} */
export function getSecurityConfigSnapshot() {
  return {
    status: _state.status,
    securityEnabled: _state.securityEnabled,
    securityConfigLoaded: _state.status !== 'loading',
    error: _state.error ?? null
  }
}

export function isSecurityEnabled() {
  return _state.status === 'enabled' && _state.securityEnabled === true
}

export function isSecurityExplicitlyDisabled() {
  return _state.status === 'disabled'
}

export function isSecurityConfigError() {
  return _state.status === 'error'
}

export function isSecurityConfigLoading() {
  return _state.status === 'loading'
}

/** Protected flows must not proceed when config unavailable. */
export function canUseProtectedFlows() {
  return isSecurityEnabled()
}

/** Legacy flows (security off) when backend explicitly disabled. */
export function canUseLegacyPaymentFlows() {
  return isSecurityExplicitlyDisabled()
}

/** @param {(snapshot: ReturnType<typeof getSecurityConfigSnapshot>) => void} listener */
export function subscribeSecurityConfig(listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

function publish() {
  const snapshot = getSecurityConfigSnapshot()
  for (const listener of _listeners) {
    try {
      listener(snapshot)
    } catch (_) {
      /* ignore subscriber errors */
    }
  }
  return snapshot
}

/**
 * Fetch backend security config once. Never treats failure as disabled.
 * @returns {Promise<ReturnType<typeof getSecurityConfigSnapshot>>}
 */
export async function loadSecurityConfig() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/security/config`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) {
      _state = {
        status: 'error',
        securityEnabled: false,
        error: `security_config_http_${response.status}`
      }
      return publish()
    }
    const data = await response.json().catch(() => null)
    if (!data || typeof data.securityEnabled !== 'boolean') {
      _state = {
        status: 'error',
        securityEnabled: false,
        error: 'security_config_malformed'
      }
      return publish()
    }
    _state = {
      status: data.securityEnabled ? 'enabled' : 'disabled',
      securityEnabled: data.securityEnabled,
      error: null
    }
    return publish()
  } catch (_) {
    _state = {
      status: 'error',
      securityEnabled: false,
      error: 'security_config_network'
    }
    return publish()
  }
}

/** Test-only reset */
export function resetSecurityConfigForTests(next = { status: 'loading', securityEnabled: false, error: null }) {
  _state = { ...next }
  return publish()
}
