/**
 * Keyboard refresh interception + beforeunload warning when security mode is ON.
 */

import { isSecurityEnabled } from '../services/securityConfig.js'

let installed = false

/**
 * @param {{ warnBeforeUnload?: boolean }} [options]
 * @returns {() => void}
 */
export function installSecureRefreshGuard(options = {}) {
  if (typeof window === 'undefined' || installed) {
    return () => {}
  }
  installed = true
  const warnBeforeUnload = options.warnBeforeUnload !== false

  const onKeyDown = (event) => {
    if (!isSecurityEnabled()) return
    const key = String(event.key ?? '').toLowerCase()
    const isRefreshKey =
      key === 'f5' ||
      ((event.ctrlKey || event.metaKey) && key === 'r')
    if (isRefreshKey) {
      event.preventDefault()
    }
  }

  const onBeforeUnload = (event) => {
    if (!isSecurityEnabled() || !warnBeforeUnload) return
    event.preventDefault()
    event.returnValue = ''
  }

  window.addEventListener('keydown', onKeyDown, { capture: true })
  if (warnBeforeUnload) {
    window.addEventListener('beforeunload', onBeforeUnload)
  }

  return () => {
    installed = false
    window.removeEventListener('keydown', onKeyDown, { capture: true })
    window.removeEventListener('beforeunload', onBeforeUnload)
  }
}

export function isSecureRefreshGuardInstalled() {
  return installed
}
