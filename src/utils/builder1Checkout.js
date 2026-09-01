/**
 * Builder1 Preview1 checkout-scoped ad-count isolation (multi-tab safe).
 */

import { createBuilder1RequestId, isValidBuilder1RequestId } from './builder1RequestId.js'
import {
  normalizeBuilder1AdCount,
  parseStoredBuilder1AdCount,
  BUILDER1_CAMPAIGN_AD_COUNT_KEY,
  BUILDER1_LEGACY_MAX_ADS_KEY,
  logBuilder1AdCount
} from './builder1CampaignCount.js'

export const BUILDER1_ACTIVE_CHECKOUT_SESSION_KEY = 'ace.builder1.activeCheckout.v1'
export const BUILDER1_CHECKOUT_RECORD_KEY_PREFIX = 'ace.builder1.checkout.v1.'
export const BUILDER1_CHECKOUT_QUERY_PARAM = 'checkoutId'
export const BUILDER1_CHECKOUT_RECORD_VERSION = 1
export const BUILDER1_CHECKOUT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const BUILDER1_CHECKOUT_MAX_RECORDS = 32

/**
 * @returns {string}
 */
export function createBuilder1CheckoutId() {
  return createBuilder1RequestId()
}

/**
 * @param {unknown} value
 */
export function isValidBuilder1CheckoutId(value) {
  return isValidBuilder1RequestId(value)
}

/**
 * @param {string} checkoutId
 */
function builder1CheckoutRecordStorageKey(checkoutId) {
  return `${BUILDER1_CHECKOUT_RECORD_KEY_PREFIX}${checkoutId}`
}

/**
 * @param {unknown} checkoutId
 * @param {Storage} [localStorage]
 */
export function readBuilder1CheckoutRecord(checkoutId, localStorage = globalThis.localStorage) {
  const id = String(checkoutId ?? '').trim()
  if (!isValidBuilder1CheckoutId(id) || !localStorage) return null
  try {
    const raw = localStorage.getItem(builder1CheckoutRecordStorageKey(id))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (String(parsed.checkoutId ?? '').trim() !== id) return null
    const adCount = parseStoredBuilder1AdCount(parsed.adCount)
    if (adCount == null) return null
    return {
      version: BUILDER1_CHECKOUT_RECORD_VERSION,
      checkoutId: id,
      adCount,
      createdAt: Number(parsed.createdAt) || 0
    }
  } catch (_) {
    return null
  }
}

/**
 * @param {{ checkoutId: string, adCount: unknown, createdAt?: number }} record
 * @param {Storage} [localStorage]
 * @param {string|null} [activeCheckoutId]
 */
export function writeBuilder1CheckoutRecord(
  record,
  localStorage = globalThis.localStorage,
  activeCheckoutId = null
) {
  const checkoutId = String(record?.checkoutId ?? '').trim()
  if (!isValidBuilder1CheckoutId(checkoutId) || !localStorage) return null
  const payload = {
    version: BUILDER1_CHECKOUT_RECORD_VERSION,
    checkoutId,
    adCount: normalizeBuilder1AdCount(record?.adCount),
    createdAt: Number(record?.createdAt) || Date.now()
  }
  localStorage.setItem(builder1CheckoutRecordStorageKey(checkoutId), JSON.stringify(payload))
  pruneStaleBuilder1CheckoutRecords(localStorage, activeCheckoutId ?? checkoutId)
  return payload
}

/**
 * @param {Storage} localStorage
 * @param {string|null} preserveCheckoutId
 */
export function pruneStaleBuilder1CheckoutRecords(localStorage, preserveCheckoutId = null) {
  if (!localStorage) return
  const now = Date.now()
  const entries = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(BUILDER1_CHECKOUT_RECORD_KEY_PREFIX)) continue
    const checkoutId = key.slice(BUILDER1_CHECKOUT_RECORD_KEY_PREFIX.length)
    const record = readBuilder1CheckoutRecord(checkoutId, localStorage)
    if (!record) {
      entries.push({ key, createdAt: 0, checkoutId })
      continue
    }
    entries.push({ key, createdAt: record.createdAt, checkoutId: record.checkoutId })
  }
  entries.sort((a, b) => b.createdAt - a.createdAt)
  for (const entry of entries) {
    const isPreserved = preserveCheckoutId && entry.checkoutId === preserveCheckoutId
    const isStale = entry.createdAt > 0 && now - entry.createdAt > BUILDER1_CHECKOUT_MAX_AGE_MS
    const overCapacity = entries.indexOf(entry) >= BUILDER1_CHECKOUT_MAX_RECORDS
    if (!isPreserved && (isStale || overCapacity)) {
      localStorage.removeItem(entry.key)
    }
  }
}

/**
 * @param {unknown} checkoutId
 * @param {Storage} [sessionStorage]
 */
export function setActiveBuilder1CheckoutId(checkoutId, sessionStorage = globalThis.sessionStorage) {
  const id = String(checkoutId ?? '').trim()
  if (!isValidBuilder1CheckoutId(id) || !sessionStorage) return null
  sessionStorage.setItem(BUILDER1_ACTIVE_CHECKOUT_SESSION_KEY, id)
  return id
}

/**
 * @param {Storage} [sessionStorage]
 */
export function readActiveBuilder1CheckoutId(sessionStorage = globalThis.sessionStorage) {
  if (!sessionStorage) return null
  const id = String(sessionStorage.getItem(BUILDER1_ACTIVE_CHECKOUT_SESSION_KEY) ?? '').trim()
  return isValidBuilder1CheckoutId(id) ? id : null
}

/**
 * @param {unknown} adCount
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function startBuilder1Preview1Checkout(adCount, storages = {}) {
  const localStorage = storages.localStorage ?? globalThis.localStorage
  const sessionStorage = storages.sessionStorage ?? globalThis.sessionStorage
  const checkoutId = createBuilder1CheckoutId()
  const normalized = normalizeBuilder1AdCount(adCount)
  writeBuilder1CheckoutRecord({ checkoutId, adCount: normalized, createdAt: Date.now() }, localStorage, checkoutId)
  setActiveBuilder1CheckoutId(checkoutId, sessionStorage)
  logBuilder1AdCount('BUILDER1_CHECKOUT_STARTED', normalized)
  if (typeof console !== 'undefined' && console.info) {
    console.info(`BUILDER1_CHECKOUT checkoutId=${checkoutId} adCount=${normalized}`)
  }
  return { checkoutId, adCount: normalized }
}

/**
 * HashRouter-safe checkoutId read (hash query preferred, then document search).
 * @param {string} [search]
 * @param {string} [hash]
 */
export function readBuilder1CheckoutIdFromRoute(search = '', hash = '') {
  const hashText = String(hash ?? '')
  if (hashText.includes('?')) {
    const params = new URLSearchParams(hashText.split('?')[1])
    const fromHash = String(params.get(BUILDER1_CHECKOUT_QUERY_PARAM) ?? '').trim()
    if (isValidBuilder1CheckoutId(fromHash)) return fromHash
  }
  const searchText = String(search ?? '').replace(/^\?/, '')
  if (searchText) {
    const params = new URLSearchParams(searchText)
    const fromSearch = String(params.get(BUILDER1_CHECKOUT_QUERY_PARAM) ?? '').trim()
    if (isValidBuilder1CheckoutId(fromSearch)) return fromSearch
  }
  return null
}

/**
 * @param {Storage} [localStorage]
 * @param {Storage} [sessionStorage]
 */
function readLegacyGlobalAdCountOnly(
  localStorage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage
) {
  const storages = [sessionStorage, localStorage]
  const keys = [BUILDER1_CAMPAIGN_AD_COUNT_KEY, BUILDER1_LEGACY_MAX_ADS_KEY]
  for (const storage of storages) {
    if (!storage) continue
    for (const key of keys) {
      try {
        const parsed = parseStoredBuilder1AdCount(storage.getItem(key))
        if (parsed != null) return parsed
      } catch (_) {
        /* ignore */
      }
    }
  }
  return null
}

/**
 * Resolve Builder1 initial ad count for THIS checkout/tab context.
 * Authority:
 * 1. checkoutId from URL/context
 * 2. active checkoutId in THIS tab's sessionStorage
 * 3. exact checkout record for that id
 * 4. narrow legacy global fallback (no checkout identity)
 *
 * @param {{ checkoutId?: string|null, search?: string, hash?: string, targetAdCount?: number|null }} [ctx]
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function resolveBuilder1CheckoutAdCount(ctx = {}, storages = {}) {
  const locked = Number(ctx.targetAdCount)
  if (Number.isInteger(locked) && locked >= 2 && locked <= 4) {
    return { adCount: locked, checkoutId: ctx.checkoutId ?? null, source: 'locked-target' }
  }

  const localStorage = storages.localStorage ?? globalThis.localStorage
  const sessionStorage = storages.sessionStorage ?? globalThis.sessionStorage

  const explicitFromRoute = readBuilder1CheckoutIdFromRoute(ctx.search, ctx.hash)
  const explicitRaw = ctx.checkoutId ?? explicitFromRoute
  let checkoutId =
    explicitRaw && isValidBuilder1CheckoutId(String(explicitRaw).trim())
      ? String(explicitRaw).trim()
      : null

  if (!checkoutId) {
    checkoutId = readActiveBuilder1CheckoutId(sessionStorage)
  }

  if (checkoutId) {
    const record = readBuilder1CheckoutRecord(checkoutId, localStorage)
    if (record) {
      if (explicitRaw) {
        setActiveBuilder1CheckoutId(checkoutId, sessionStorage)
      }
      return {
        adCount: record.adCount,
        checkoutId,
        source: explicitRaw ? 'url-checkout' : 'active-checkout'
      }
    }
    return { adCount: 2, checkoutId, source: 'missing-checkout-record' }
  }

  const legacy = readLegacyGlobalAdCountOnly(localStorage, sessionStorage)
  if (legacy != null) {
    return { adCount: legacy, checkoutId: null, source: 'legacy-global' }
  }

  return { adCount: 2, checkoutId: null, source: 'default' }
}

/**
 * Build HashRouter-safe Builder return hash after payment.
 * @param {Storage} [sessionStorage]
 */
export function buildBuilder1PaymentReturnHash(sessionStorage = globalThis.sessionStorage) {
  const checkoutId = readActiveBuilder1CheckoutId(sessionStorage)
  if (checkoutId) {
    const params = new URLSearchParams({ fromPayment: '1', checkoutId })
    return `#/builder?${params.toString()}`
  }
  return '#/builder?fromPayment=1'
}
