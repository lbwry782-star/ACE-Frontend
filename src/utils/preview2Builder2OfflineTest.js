/**
 * Preview2 → Builder2 explicit offline checkout handoff test.
 * Arms test mode only — targetVideoCount comes from the real Preview2 card click / persisted checkout.
 */

import {
  resolveBuilder2CheckoutTargetVideoCount,
  readBuilder2VideoCheckoutRecord,
  BUILDER2_VIDEO_CHECKOUT_RECORD_KEY_PREFIX,
  readActiveBuilder2VideoCheckoutId,
  isValidBuilder2VideoCheckoutId
} from './builder2VideoCheckout.js'
import {
  clearBuilder2OfflinePlaceholderFlag,
  resetBuilder2OfflinePlaceholderRuntime,
  dispatchBuilder2OfflineTestStateChange,
  registerPreview2PlaceholderActiveCheck
} from './builder2OfflinePlaceholders.js'

export const PREVIEW2_BUILDER2_OFFLINE_TEST_SESSION_KEY = 'ace.preview2.builder2.offlineTest.v1'
export const PREVIEW2_BUILDER2_OFFLINE_TEST_QUERY_PARAM = 'preview2Test'
export const PREVIEW2_BUILDER2_OFFLINE_TEST_QUERY_VALUE = '1'
export const PREVIEW2_BUILDER2_OFFLINE_TEST_STATE_EVENT = 'ace:preview2-builder2-offline-test-state'
export const PREVIEW2_BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE =
  'Preview2 test armed — switch DevTools Network to Offline.'

const PREVIEW2_BUILDER2_OFFLINE_TEST_ARMED_CONSOLE =
  '[Preview2→Builder2 test] ARMED.\nClick the real 1-video or 2-video Preview2 offer.\nPayment redirect will be skipped for this test only.'

/**
 * @param {Storage|null|undefined} sessionStorage
 */
export function readPreview2Builder2OfflineTestArmed(sessionStorage = globalThis.sessionStorage) {
  if (!sessionStorage) return false
  return (
    String(sessionStorage.getItem(PREVIEW2_BUILDER2_OFFLINE_TEST_SESSION_KEY) ?? '').trim() ===
    PREVIEW2_BUILDER2_OFFLINE_TEST_QUERY_VALUE
  )
}

/**
 * @param {Storage|null|undefined} sessionStorage
 */
export function armPreview2Builder2OfflineTest(sessionStorage = globalThis.sessionStorage) {
  sessionStorage?.setItem(
    PREVIEW2_BUILDER2_OFFLINE_TEST_SESSION_KEY,
    PREVIEW2_BUILDER2_OFFLINE_TEST_QUERY_VALUE
  )
  dispatchPreview2Builder2OfflineTestStateChange({ armed: true })
  return true
}

/**
 * @param {Storage|null|undefined} sessionStorage
 */
export function clearPreview2Builder2OfflineTest(sessionStorage = globalThis.sessionStorage) {
  try {
    sessionStorage?.removeItem(PREVIEW2_BUILDER2_OFFLINE_TEST_SESSION_KEY)
  } catch (_) {
    /* ignore */
  }
}

/**
 * @param {string} [search]
 * @param {string} [hash]
 */
export function isPreview2Builder2OfflineTestRoute(search = '', hash = '') {
  const hashText = String(hash ?? '')
  if (hashText.includes('?')) {
    const params = new URLSearchParams(hashText.split('?')[1])
    if (
      String(params.get(PREVIEW2_BUILDER2_OFFLINE_TEST_QUERY_PARAM) ?? '').trim() ===
      PREVIEW2_BUILDER2_OFFLINE_TEST_QUERY_VALUE
    ) {
      return true
    }
  }
  const searchText = String(search ?? '').replace(/^\?/, '')
  if (searchText) {
    const params = new URLSearchParams(searchText)
    if (
      String(params.get(PREVIEW2_BUILDER2_OFFLINE_TEST_QUERY_PARAM) ?? '').trim() ===
      PREVIEW2_BUILDER2_OFFLINE_TEST_QUERY_VALUE
    ) {
      return true
    }
  }
  return false
}

/**
 * @param {string} checkoutId
 */
export function buildPreview2Builder2OfflineTestBuilder2Hash(checkoutId) {
  const id = String(checkoutId ?? '').trim()
  const params = new URLSearchParams({
    [PREVIEW2_BUILDER2_OFFLINE_TEST_QUERY_PARAM]: PREVIEW2_BUILDER2_OFFLINE_TEST_QUERY_VALUE,
    checkoutId: id
  })
  return `#/builder2?${params.toString()}`
}

/**
 * Mark checkout record created during Preview2 offline test (safe reset identification).
 * @param {string} checkoutId
 * @param {Storage} [localStorage]
 */
export function markBuilder2VideoCheckoutPreview2OfflineTest(
  checkoutId,
  localStorage = globalThis.localStorage
) {
  const id = String(checkoutId ?? '').trim()
  if (!isValidBuilder2VideoCheckoutId(id) || !localStorage) return null
  const record = readBuilder2VideoCheckoutRecord(id, localStorage)
  if (!record) return null
  const key = `${BUILDER2_VIDEO_CHECKOUT_RECORD_KEY_PREFIX}${id}`
  const payload = {
    ...record,
    preview2OfflineTest: true
  }
  localStorage.setItem(key, JSON.stringify(payload))
  return payload
}

/**
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function clearPreview2OfflineTestCheckoutRecords(
  storages = {}
) {
  const localStorage = storages.localStorage ?? globalThis.localStorage
  const sessionStorage = storages.sessionStorage ?? globalThis.sessionStorage
  if (!localStorage) return

  const activeId = readActiveBuilder2VideoCheckoutId(sessionStorage)
  let clearedActive = false

  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(BUILDER2_VIDEO_CHECKOUT_RECORD_KEY_PREFIX)) continue
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (parsed?.preview2OfflineTest === true) {
        const checkoutId = key.slice(BUILDER2_VIDEO_CHECKOUT_RECORD_KEY_PREFIX.length)
        localStorage.removeItem(key)
        if (activeId === checkoutId) clearedActive = true
      }
    } catch (_) {
      /* ignore */
    }
  }

  if (clearedActive && sessionStorage) {
    try {
      sessionStorage.removeItem('ace.builder2.activeVideoCheckout.v1')
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Valid persisted Preview2 checkout for this explicit test path.
 * @param {{ hash?: string, search?: string, checkoutId?: string|null }} [ctx]
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function resolvePreview2Builder2OfflineTestCheckout(ctx = {}, storages = {}) {
  if (!readPreview2Builder2OfflineTestArmed(storages.sessionStorage ?? globalThis.sessionStorage)) {
    return {
      valid: false,
      checkoutId: null,
      targetVideoCount: null,
      source: 'test-not-armed'
    }
  }

  const resolved = resolveBuilder2CheckoutTargetVideoCount(
    {
      hash: ctx.hash,
      search: ctx.search,
      checkoutId: ctx.checkoutId
    },
    storages
  )

  const checkoutId = resolved.checkoutId
  const targetVideoCount = resolved.targetVideoCount

  if (!checkoutId || !isValidBuilder2VideoCheckoutId(checkoutId)) {
    return { valid: false, checkoutId: null, targetVideoCount: null, source: 'no-checkout' }
  }

  if (resolved.source === 'default' || resolved.source === 'missing-checkout-record') {
    return { valid: false, checkoutId, targetVideoCount, source: resolved.source }
  }

  if (targetVideoCount !== 1 && targetVideoCount !== 2) {
    return { valid: false, checkoutId, targetVideoCount, source: 'invalid-target' }
  }

  return {
    valid: true,
    checkoutId,
    targetVideoCount,
    source: resolved.source
  }
}

/**
 * @param {{ hash?: string, search?: string, navigatorOnline?: boolean }} [ctx]
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function isPreview2Builder2OfflinePlaceholderActive(ctx = {}, storages = {}) {
  const checkout = resolvePreview2Builder2OfflineTestCheckout(ctx, storages)
  if (!checkout.valid) return false

  const online =
    ctx.navigatorOnline !== undefined
      ? ctx.navigatorOnline
      : typeof navigator !== 'undefined'
        ? navigator.onLine
        : true
  return !online
}

/**
 * @param {{ hash?: string, search?: string, navigatorOnline?: boolean }} [ctx]
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function isPreview2Builder2OfflineTestArmedWhileOnline(ctx = {}, storages = {}) {
  const checkout = resolvePreview2Builder2OfflineTestCheckout(ctx, storages)
  if (!checkout.valid) return false

  const online =
    ctx.navigatorOnline !== undefined
      ? ctx.navigatorOnline
      : typeof navigator !== 'undefined'
        ? navigator.onLine
        : true
  return online
}

/**
 * @param {object} [detail]
 */
export function dispatchPreview2Builder2OfflineTestStateChange(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PREVIEW2_BUILDER2_OFFLINE_TEST_STATE_EVENT, { detail }))
}

/**
 * Log checkout handoff diagnostics on Builder2 (persisted checkout value only).
 * @param {{ hash?: string, search?: string }} [ctx]
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function syncPreview2Builder2OfflineTestConsoleState(ctx = {}, storages = {}) {
  if (typeof console === 'undefined' || !console.info) return

  const checkout = resolvePreview2Builder2OfflineTestCheckout(ctx, storages)
  if (!checkout.valid) return

  const online =
    ctx.navigatorOnline !== undefined
      ? ctx.navigatorOnline
      : typeof navigator !== 'undefined'
        ? navigator.onLine
        : true

  console.info(
    `[Preview2→Builder2 test] checkoutId=${checkout.checkoutId} targetVideoCount=${checkout.targetVideoCount}`
  )

  if (!online) {
    console.info(
      `[Preview2→Builder2 test] ACTIVE targetVideoCount=${checkout.targetVideoCount} network=offline`
    )
    return
  }

  console.info(
    `[Preview2→Builder2 test] ARMED targetVideoCount=${checkout.targetVideoCount} — switch DevTools Network to Offline. Do not reload. Then click GENERATE.`
  )
}

/**
 * Register DevTools console helpers — arms test only; does NOT choose 1 vs 2.
 */
export function registerPreview2Builder2OfflineTestConsoleHelpers() {
  if (typeof window === 'undefined') return

  window.__preview2Builder2OfflineTest = () => {
    armPreview2Builder2OfflineTest()
    console.info(PREVIEW2_BUILDER2_OFFLINE_TEST_ARMED_CONSOLE)
  }

  window.__resetPreview2Builder2OfflineTest = () => {
    clearPreview2Builder2OfflineTest()
    clearBuilder2OfflinePlaceholderFlag()
    resetBuilder2OfflinePlaceholderRuntime()
    clearPreview2OfflineTestCheckoutRecords()
    dispatchPreview2Builder2OfflineTestStateChange({ cleared: true })
    dispatchBuilder2OfflineTestStateChange({ cleared: true })
    console.info('[Preview2→Builder2 test] Reset. Normal Preview2/iCount behavior restored.')
  }
}

registerPreview2PlaceholderActiveCheck((ctx) => isPreview2Builder2OfflinePlaceholderActive(ctx))
