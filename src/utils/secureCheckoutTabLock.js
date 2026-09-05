/**
 * Same-checkout single-tab protection (defense-in-depth, no secrets in shared storage).
 */

const LOCK_PREFIX = 'ace-sec-checkout-lock-'
const BC_PREFIX = 'ace-sec-checkout-bc-'

/** @type {BroadcastChannel|null} */
let activeChannel = null
/** @type {AbortController|null} */
let lockAbort = null

function getTabInstanceId(sessionStorage = globalThis.sessionStorage) {
  const KEY = 'ace.security.tabInstance.v1'
  if (!sessionStorage) {
    return `tab-${Date.now()}`
  }
  try {
    let id = sessionStorage.getItem(KEY)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
      sessionStorage.setItem(KEY, id)
    }
    return id
  } catch (_) {
    return `tab-${Date.now()}`
  }
}

/**
 * @param {string} checkoutId
 * @param {() => void} onLostLeadership
 * @returns {() => void}
 */
export function initSecureCheckoutTabLock(checkoutId, onLostLeadership) {
  const id = String(checkoutId ?? '').trim()
  if (!id) return () => {}

  const tabId = getTabInstanceId()
  let released = false
  const claimTs = Date.now()

  const release = () => {
    if (released) return
    released = true
    try {
      lockAbort?.abort()
    } catch (_) {
      /* ignore */
    }
    lockAbort = null
    try {
      activeChannel?.close()
    } catch (_) {
      /* ignore */
    }
    activeChannel = null
  }

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      activeChannel = new BroadcastChannel(`${BC_PREFIX}${id}`)
      activeChannel.postMessage({ type: 'claim', tabId, ts: claimTs })
      activeChannel.onmessage = (event) => {
        const data = event?.data
        if (released || !data || data.type !== 'claim') return
        if (data.tabId !== tabId && data.ts >= claimTs) {
          onLostLeadership()
        }
      }
    } catch (_) {
      /* BroadcastChannel unavailable */
    }
  }

  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    lockAbort = new AbortController()
    void navigator.locks
      .request(`${LOCK_PREFIX}${id}`, { ifAvailable: true, signal: lockAbort.signal }, async (lock) => {
        if (!lock && !released) {
          onLostLeadership()
          return
        }
        if (!lock) return
        await new Promise((resolve) => {
          const wait = () => {
            if (released) {
              resolve()
              return
            }
            setTimeout(wait, 400)
          }
          wait()
        })
      })
      .catch(() => {})
  }

  return release
}
