/**
 * Direct Builder entry guard when security mode is ON.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getSecurityConfigSnapshot,
  isSecurityConfigError,
  isSecurityConfigLoading,
  isSecurityEnabled,
  subscribeSecurityConfig
} from '../services/securityConfig.js'
import { readSecureCheckoutRecord } from '../utils/secureCheckout.js'
import { initSecureCheckoutTabLock } from '../utils/secureCheckoutTabLock.js'
import { installSecureRefreshGuard } from '../utils/secureRefreshGuard.js'

const HOME_PATH = '/'
const CONFIG_ERROR_MESSAGE =
  'שירות האבטחה אינו זמין כרגע. לא ניתן להמשיך — נסו שוב בעוד רגע.'
const ACCESS_DENIED_MESSAGE =
  'גישה לבונה דורשת תשלום מאומת באותו חלון דפדפן.'

/**
 * @param {'builder1'|'builder2'} expectedBuilder
 */
export function evaluateSecureBuilderEntry(expectedBuilder) {
  const snapshot = getSecurityConfigSnapshot()
  if (snapshot.status === 'loading') {
    return { allowed: false, phase: 'loading', message: null }
  }
  if (isSecurityConfigError()) {
    return { allowed: false, phase: 'error', message: CONFIG_ERROR_MESSAGE }
  }
  if (!isSecurityEnabled()) {
    return { allowed: true, phase: 'legacy', message: null }
  }

  const secure = readSecureCheckoutRecord()
  if (!secure) {
    return { allowed: false, phase: 'denied', message: ACCESS_DENIED_MESSAGE }
  }
  if (secure.builder !== expectedBuilder) {
    return { allowed: false, phase: 'denied', message: ACCESS_DENIED_MESSAGE }
  }
  return { allowed: true, phase: 'secure', message: null, secure }
}

/**
 * @param {'builder1'|'builder2'} expectedBuilder
 */
export function useSecureBuilderEntryGuard(expectedBuilder) {
  const navigate = useNavigate()
  const [entryState, setEntryState] = useState(() => evaluateSecureBuilderEntry(expectedBuilder))

  useEffect(() => {
    const sync = () => setEntryState(evaluateSecureBuilderEntry(expectedBuilder))
    sync()
    return subscribeSecurityConfig(sync)
  }, [expectedBuilder])

  useEffect(() => {
    if (!isSecurityEnabled()) return undefined
    const secure = readSecureCheckoutRecord()
    if (!secure) return undefined
    return initSecureCheckoutTabLock(secure.checkoutId, () => {
      navigate(HOME_PATH, { replace: true, state: { aceMessage: ACCESS_DENIED_MESSAGE } })
    })
  }, [entryState.phase, navigate])

  useEffect(() => {
    if (!isSecurityEnabled()) return undefined
    return installSecureRefreshGuard({ warnBeforeUnload: true })
  }, [entryState.phase])

  useEffect(() => {
    if (entryState.phase === 'loading') return
    if (entryState.phase === 'legacy') return
    if (entryState.allowed) return
    navigate(HOME_PATH, {
      replace: true,
      state: { aceMessage: entryState.message ?? ACCESS_DENIED_MESSAGE }
    })
  }, [entryState, navigate])

  return entryState
}

export { ACCESS_DENIED_MESSAGE, CONFIG_ERROR_MESSAGE }
