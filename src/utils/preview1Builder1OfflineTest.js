/**
 * Preview1 → Builder1 explicit offline checkout handoff test.
 * Arms test mode only — adCount comes from the real Preview1 card click / persisted checkout.
 */

import {
  resolveBuilder1CheckoutAdCount,
  readBuilder1CheckoutRecord,
  BUILDER1_CHECKOUT_RECORD_KEY_PREFIX,
  readActiveBuilder1CheckoutId,
  isValidBuilder1CheckoutId
} from './builder1Checkout.js'
import {
  PREVIEW1_TIER_AD_COUNTS,
  parseStoredBuilder1AdCount
} from './builder1CampaignCount.js'
import {
  resetBuilder1OfflinePlaceholderRuntime,
  registerPreview1PlaceholderActiveCheck,
  isValidPreview1OfflineTestAdCount
} from './builder1OfflinePlaceholders.js'

export const PREVIEW1_BUILDER1_OFFLINE_TEST_SESSION_KEY = 'ace.preview1.builder1.offlineTest.v1'
export const PREVIEW1_BUILDER1_OFFLINE_TEST_QUERY_PARAM = 'preview1Test'
export const PREVIEW1_BUILDER1_OFFLINE_TEST_QUERY_VALUE = '1'
export const PREVIEW1_BUILDER1_OFFLINE_TEST_STATE_EVENT = 'ace:preview1-builder1-offline-test-state'
export const PREVIEW1_BUILDER1_OFFLINE_TEST_ARMED_ONLINE_MESSAGE =
  'Preview1 test armed — switch DevTools Network to Offline.'

const PREVIEW1_BUILDER1_OFFLINE_TEST_ARMED_CONSOLE =
  '[Preview1→Builder1 test] ARMED.\nClick a real Preview1 offer.\nPayment redirect will be skipped for this test only.'

/**
 * @param {Storage|null|undefined} sessionStorage
 */
export function readPreview1Builder1OfflineTestArmed(sessionStorage = globalThis.sessionStorage) {
  if (!sessionStorage) return false
  return (
    String(sessionStorage.getItem(PREVIEW1_BUILDER1_OFFLINE_TEST_SESSION_KEY) ?? '').trim() ===
    PREVIEW1_BUILDER1_OFFLINE_TEST_QUERY_VALUE
  )
}

/**
 * @param {Storage|null|undefined} sessionStorage
 */
export function armPreview1Builder1OfflineTest(sessionStorage = globalThis.sessionStorage) {
  sessionStorage?.setItem(
    PREVIEW1_BUILDER1_OFFLINE_TEST_SESSION_KEY,
    PREVIEW1_BUILDER1_OFFLINE_TEST_QUERY_VALUE
  )
  dispatchPreview1Builder1OfflineTestStateChange({ armed: true })
  return true
}

/**
 * @param {Storage|null|undefined} sessionStorage
 */
export function clearPreview1Builder1OfflineTest(sessionStorage = globalThis.sessionStorage) {
  try {
    sessionStorage?.removeItem(PREVIEW1_BUILDER1_OFFLINE_TEST_SESSION_KEY)
  } catch (_) {
    /* ignore */
  }
}

/**
 * @param {string} [search]
 * @param {string} [hash]
 */
export function isPreview1Builder1OfflineTestRoute(search = '', hash = '') {
  const hashText = String(hash ?? '')
  if (hashText.includes('?')) {
    const params = new URLSearchParams(hashText.split('?')[1])
    if (
      String(params.get(PREVIEW1_BUILDER1_OFFLINE_TEST_QUERY_PARAM) ?? '').trim() ===
      PREVIEW1_BUILDER1_OFFLINE_TEST_QUERY_VALUE
    ) {
      return true
    }
  }
  const searchText = String(search ?? '').replace(/^\?/, '')
  if (searchText) {
    const params = new URLSearchParams(searchText)
    if (
      String(params.get(PREVIEW1_BUILDER1_OFFLINE_TEST_QUERY_PARAM) ?? '').trim() ===
      PREVIEW1_BUILDER1_OFFLINE_TEST_QUERY_VALUE
    ) {
      return true
    }
  }
  return false
}

/**
 * @param {string} checkoutId
 */
export function buildPreview1Builder1OfflineTestBuilderHash(checkoutId) {
  const id = String(checkoutId ?? '').trim()
  const params = new URLSearchParams({
    [PREVIEW1_BUILDER1_OFFLINE_TEST_QUERY_PARAM]: PREVIEW1_BUILDER1_OFFLINE_TEST_QUERY_VALUE,
    checkoutId: id
  })
  return `#/builder?${params.toString()}`
}

/**
 * @param {string} checkoutId
 * @param {Storage} [localStorage]
 */
export function markBuilder1CheckoutPreview1OfflineTest(
  checkoutId,
  localStorage = globalThis.localStorage
) {
  const id = String(checkoutId ?? '').trim()
  if (!isValidBuilder1CheckoutId(id) || !localStorage) return null
  const record = readBuilder1CheckoutRecord(id, localStorage)
  if (!record) return null
  const key = `${BUILDER1_CHECKOUT_RECORD_KEY_PREFIX}${id}`
  localStorage.setItem(
    key,
    JSON.stringify({
      ...record,
      preview1OfflineTest: true
    })
  )
  return record
}

/**
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function clearPreview1OfflineTestCheckoutRecords(storages = {}) {
  const localStorage = storages.localStorage ?? globalThis.localStorage
  const sessionStorage = storages.sessionStorage ?? globalThis.sessionStorage
  if (!localStorage) return

  const activeId = readActiveBuilder1CheckoutId(sessionStorage)
  let clearedActive = false

  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(BUILDER1_CHECKOUT_RECORD_KEY_PREFIX)) continue
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (parsed?.preview1OfflineTest === true) {
        const checkoutId = key.slice(BUILDER1_CHECKOUT_RECORD_KEY_PREFIX.length)
        localStorage.removeItem(key)
        if (activeId === checkoutId) clearedActive = true
      }
    } catch (_) {
      /* ignore */
    }
  }

  if (clearedActive && sessionStorage) {
    try {
      sessionStorage.removeItem('ace.builder1.activeCheckout.v1')
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * @param {{ hash?: string, search?: string, checkoutId?: string|null }} [ctx]
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function resolvePreview1Builder1OfflineTestCheckout(ctx = {}, storages = {}) {
  if (!readPreview1Builder1OfflineTestArmed(storages.sessionStorage ?? globalThis.sessionStorage)) {
    return {
      valid: false,
      checkoutId: null,
      adCount: null,
      source: 'test-not-armed'
    }
  }

  const resolved = resolveBuilder1CheckoutAdCount(
    {
      hash: ctx.hash,
      search: ctx.search,
      checkoutId: ctx.checkoutId
    },
    storages
  )

  const checkoutId = resolved.checkoutId
  const adCount = resolved.adCount

  if (!checkoutId || !isValidBuilder1CheckoutId(checkoutId)) {
    return { valid: false, checkoutId: null, adCount: null, source: 'no-checkout' }
  }

  if (
    resolved.source === 'default' ||
    resolved.source === 'missing-checkout-record' ||
    resolved.source === 'legacy-global'
  ) {
    return { valid: false, checkoutId, adCount, source: resolved.source }
  }

  if (!isValidPreview1OfflineTestAdCount(adCount)) {
    return { valid: false, checkoutId, adCount, source: 'invalid-ad-count' }
  }

  return {
    valid: true,
    checkoutId,
    adCount,
    source: resolved.source
  }
}

/**
 * @param {{ hash?: string, search?: string, navigatorOnline?: boolean }} [ctx]
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function isPreview1Builder1OfflinePlaceholderActive(ctx = {}, storages = {}) {
  const checkout = resolvePreview1Builder1OfflineTestCheckout(ctx, storages)
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
export function isPreview1Builder1OfflineTestArmedWhileOnline(ctx = {}, storages = {}) {
  const checkout = resolvePreview1Builder1OfflineTestCheckout(ctx, storages)
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
export function dispatchPreview1Builder1OfflineTestStateChange(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PREVIEW1_BUILDER1_OFFLINE_TEST_STATE_EVENT, { detail }))
}

/**
 * @param {{ hash?: string, search?: string }} [ctx]
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function syncPreview1Builder1OfflineTestConsoleState(ctx = {}, storages = {}) {
  if (typeof console === 'undefined' || !console.info) return

  const checkout = resolvePreview1Builder1OfflineTestCheckout(ctx, storages)
  if (!checkout.valid) return

  const online =
    ctx.navigatorOnline !== undefined
      ? ctx.navigatorOnline
      : typeof navigator !== 'undefined'
        ? navigator.onLine
        : true

  console.info(
    `[Preview1→Builder1 test] checkoutId=${checkout.checkoutId} adCount=${checkout.adCount}`
  )

  if (!online) {
    console.info(
      `[Preview1→Builder1 test] ACTIVE adCount=${checkout.adCount} network=offline`
    )
    return
  }

  console.info(
    `[Preview1→Builder1 test] ARMED adCount=${checkout.adCount} — switch DevTools Network to Offline. Do not reload. Then click GENERATE.`
  )
}

/**
 * Register DevTools console helpers — arms test only; does NOT choose ad count.
 */
export function registerPreview1Builder1OfflineTestConsoleHelpers() {
  if (typeof window === 'undefined') return

  window.__preview1Builder1OfflineTest = () => {
    armPreview1Builder1OfflineTest()
    console.info(PREVIEW1_BUILDER1_OFFLINE_TEST_ARMED_CONSOLE)
  }

  window.__resetPreview1Builder1OfflineTest = () => {
    clearPreview1Builder1OfflineTest()
    resetBuilder1OfflinePlaceholderRuntime()
    clearPreview1OfflineTestCheckoutRecords()
    dispatchPreview1Builder1OfflineTestStateChange({ cleared: true })
    console.info('[Preview1→Builder1 test] Reset. Normal Preview1/iCount behavior restored.')
  }
}

registerPreview1PlaceholderActiveCheck((ctx) => isPreview1Builder1OfflinePlaceholderActive(ctx))

export { PREVIEW1_TIER_AD_COUNTS, parseStoredBuilder1AdCount }
