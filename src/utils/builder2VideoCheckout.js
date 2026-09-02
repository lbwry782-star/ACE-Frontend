/**
 * Builder2 Preview2 checkout-scoped targetVideoCount isolation (multi-tab safe).
 */

import { createBuilder1RequestId, isValidBuilder1RequestId } from './builder1RequestId.js'

export const BUILDER2_ACTIVE_VIDEO_CHECKOUT_SESSION_KEY = 'ace.builder2.activeVideoCheckout.v1'
export const BUILDER2_VIDEO_CHECKOUT_RECORD_KEY_PREFIX = 'ace.builder2.videoCheckout.v1.'
export const BUILDER2_VIDEO_CHECKOUT_QUERY_PARAM = 'checkoutId'
export const BUILDER2_VIDEO_CHECKOUT_RECORD_VERSION = 1
export const BUILDER2_VIDEO_CHECKOUT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const BUILDER2_VIDEO_CHECKOUT_MAX_RECORDS = 32

/** Preview2 tier keys → explicit targetVideoCount (not inferred from filename/price). */
export const PREVIEW2_TIER_TARGET_VIDEO_COUNTS = Object.freeze({
  '1': 1,
  '2': 2
})

/**
 * @returns {string}
 */
export function createBuilder2VideoCheckoutId() {
  return createBuilder1RequestId()
}

/**
 * @param {unknown} value
 */
export function isValidBuilder2VideoCheckoutId(value) {
  return isValidBuilder1RequestId(value)
}

/**
 * @param {unknown} raw
 * @returns {1|2|null}
 */
export function parseStoredBuilder2TargetVideoCount(raw) {
  if (raw == null) return null
  const parsed = Number(String(raw).trim())
  if (parsed === 1 || parsed === 2) return parsed
  return null
}

/**
 * @param {unknown} value
 * @returns {1|2}
 */
export function normalizeBuilder2TargetVideoCount(value) {
  return parseStoredBuilder2TargetVideoCount(value) ?? 1
}

/**
 * @param {unknown} tierKey Preview2 asset key ('1' | '2').
 * @returns {1|2|null}
 */
export function preview2TierKeyToTargetVideoCount(tierKey) {
  const key = String(tierKey ?? '').trim()
  if (Object.prototype.hasOwnProperty.call(PREVIEW2_TIER_TARGET_VIDEO_COUNTS, key)) {
    return PREVIEW2_TIER_TARGET_VIDEO_COUNTS[key]
  }
  return null
}

/**
 * @param {string} checkoutId
 */
function builder2VideoCheckoutRecordStorageKey(checkoutId) {
  return `${BUILDER2_VIDEO_CHECKOUT_RECORD_KEY_PREFIX}${checkoutId}`
}

/**
 * @param {unknown} checkoutId
 * @param {Storage} [localStorage]
 */
export function readBuilder2VideoCheckoutRecord(checkoutId, localStorage = globalThis.localStorage) {
  const id = String(checkoutId ?? '').trim()
  if (!isValidBuilder2VideoCheckoutId(id) || !localStorage) return null
  try {
    const raw = localStorage.getItem(builder2VideoCheckoutRecordStorageKey(id))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (String(parsed.checkoutId ?? '').trim() !== id) return null
    const targetVideoCount = parseStoredBuilder2TargetVideoCount(parsed.targetVideoCount)
    if (targetVideoCount == null) return null
    return {
      version: BUILDER2_VIDEO_CHECKOUT_RECORD_VERSION,
      checkoutId: id,
      targetVideoCount,
      createdAt: Number(parsed.createdAt) || 0
    }
  } catch (_) {
    return null
  }
}

/**
 * @param {{ checkoutId: string, targetVideoCount: unknown, createdAt?: number }} record
 * @param {Storage} [localStorage]
 * @param {string|null} [activeCheckoutId]
 */
export function writeBuilder2VideoCheckoutRecord(
  record,
  localStorage = globalThis.localStorage,
  activeCheckoutId = null
) {
  const checkoutId = String(record?.checkoutId ?? '').trim()
  if (!isValidBuilder2VideoCheckoutId(checkoutId) || !localStorage) return null
  const payload = {
    version: BUILDER2_VIDEO_CHECKOUT_RECORD_VERSION,
    checkoutId,
    targetVideoCount: normalizeBuilder2TargetVideoCount(record?.targetVideoCount),
    createdAt: Number(record?.createdAt) || Date.now()
  }
  localStorage.setItem(builder2VideoCheckoutRecordStorageKey(checkoutId), JSON.stringify(payload))
  pruneStaleBuilder2VideoCheckoutRecords(localStorage, activeCheckoutId ?? checkoutId)
  return payload
}

/**
 * @param {Storage} localStorage
 * @param {string|null} preserveCheckoutId
 */
export function pruneStaleBuilder2VideoCheckoutRecords(localStorage, preserveCheckoutId = null) {
  if (!localStorage) return
  const now = Date.now()
  const entries = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(BUILDER2_VIDEO_CHECKOUT_RECORD_KEY_PREFIX)) continue
    const checkoutId = key.slice(BUILDER2_VIDEO_CHECKOUT_RECORD_KEY_PREFIX.length)
    const record = readBuilder2VideoCheckoutRecord(checkoutId, localStorage)
    if (!record) {
      entries.push({ key, createdAt: 0, checkoutId })
      continue
    }
    entries.push({ key, createdAt: record.createdAt, checkoutId: record.checkoutId })
  }
  entries.sort((a, b) => b.createdAt - a.createdAt)
  for (const entry of entries) {
    const isPreserved = preserveCheckoutId && entry.checkoutId === preserveCheckoutId
    const isStale = entry.createdAt > 0 && now - entry.createdAt > BUILDER2_VIDEO_CHECKOUT_MAX_AGE_MS
    const overCapacity = entries.indexOf(entry) >= BUILDER2_VIDEO_CHECKOUT_MAX_RECORDS
    if (!isPreserved && (isStale || overCapacity)) {
      localStorage.removeItem(entry.key)
    }
  }
}

/**
 * @param {unknown} checkoutId
 * @param {Storage} [sessionStorage]
 */
export function setActiveBuilder2VideoCheckoutId(
  checkoutId,
  sessionStorage = globalThis.sessionStorage
) {
  const id = String(checkoutId ?? '').trim()
  if (!isValidBuilder2VideoCheckoutId(id) || !sessionStorage) return null
  sessionStorage.setItem(BUILDER2_ACTIVE_VIDEO_CHECKOUT_SESSION_KEY, id)
  return id
}

/**
 * @param {Storage} [sessionStorage]
 */
export function readActiveBuilder2VideoCheckoutId(sessionStorage = globalThis.sessionStorage) {
  if (!sessionStorage) return null
  const id = String(sessionStorage.getItem(BUILDER2_ACTIVE_VIDEO_CHECKOUT_SESSION_KEY) ?? '').trim()
  return isValidBuilder2VideoCheckoutId(id) ? id : null
}

/**
 * @param {unknown} targetVideoCount
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function startBuilder2Preview2Checkout(targetVideoCount, storages = {}) {
  const localStorage = storages.localStorage ?? globalThis.localStorage
  const sessionStorage = storages.sessionStorage ?? globalThis.sessionStorage
  const checkoutId = createBuilder2VideoCheckoutId()
  const normalized = normalizeBuilder2TargetVideoCount(targetVideoCount)
  writeBuilder2VideoCheckoutRecord(
    { checkoutId, targetVideoCount: normalized, createdAt: Date.now() },
    localStorage,
    checkoutId
  )
  setActiveBuilder2VideoCheckoutId(checkoutId, sessionStorage)
  if (typeof console !== 'undefined' && console.info) {
    console.info(`BUILDER2_VIDEO_CHECKOUT checkoutId=${checkoutId} targetVideoCount=${normalized}`)
  }
  return { checkoutId, targetVideoCount: normalized }
}

/**
 * @param {string} [search]
 * @param {string} [hash]
 */
export function readBuilder2VideoCheckoutIdFromRoute(search = '', hash = '') {
  const hashText = String(hash ?? '')
  if (hashText.includes('?')) {
    const params = new URLSearchParams(hashText.split('?')[1])
    const fromHash = String(params.get(BUILDER2_VIDEO_CHECKOUT_QUERY_PARAM) ?? '').trim()
    if (isValidBuilder2VideoCheckoutId(fromHash)) return fromHash
  }
  const searchText = String(search ?? '').replace(/^\?/, '')
  if (searchText) {
    const params = new URLSearchParams(searchText)
    const fromSearch = String(params.get(BUILDER2_VIDEO_CHECKOUT_QUERY_PARAM) ?? '').trim()
    if (isValidBuilder2VideoCheckoutId(fromSearch)) return fromSearch
  }
  return null
}

/**
 * Resolve Builder2 initial targetVideoCount for THIS checkout/tab context.
 * No "latest checkout" fallback — only exact checkout identity.
 *
 * @param {{ checkoutId?: string|null, search?: string, hash?: string, lockedTargetVideoCount?: number|null }} [ctx]
 * @param {{ localStorage?: Storage, sessionStorage?: Storage }} [storages]
 */
export function resolveBuilder2CheckoutTargetVideoCount(ctx = {}, storages = {}) {
  const locked = parseStoredBuilder2TargetVideoCount(ctx.lockedTargetVideoCount)
  if (locked != null) {
    return { targetVideoCount: locked, checkoutId: ctx.checkoutId ?? null, source: 'locked-target' }
  }

  const localStorage = storages.localStorage ?? globalThis.localStorage
  const sessionStorage = storages.sessionStorage ?? globalThis.sessionStorage

  const explicitFromRoute = readBuilder2VideoCheckoutIdFromRoute(ctx.search, ctx.hash)
  const explicitRaw = ctx.checkoutId ?? explicitFromRoute
  let checkoutId =
    explicitRaw && isValidBuilder2VideoCheckoutId(String(explicitRaw).trim())
      ? String(explicitRaw).trim()
      : null

  if (!checkoutId) {
    checkoutId = readActiveBuilder2VideoCheckoutId(sessionStorage)
  }

  if (checkoutId) {
    const record = readBuilder2VideoCheckoutRecord(checkoutId, localStorage)
    if (record) {
      if (explicitRaw) {
        setActiveBuilder2VideoCheckoutId(checkoutId, sessionStorage)
      }
      return {
        targetVideoCount: record.targetVideoCount,
        checkoutId,
        source: explicitRaw ? 'url-checkout' : 'active-checkout'
      }
    }
    return { targetVideoCount: 1, checkoutId, source: 'missing-checkout-record' }
  }

  return { targetVideoCount: 1, checkoutId: null, source: 'default' }
}

/**
 * Build HashRouter-safe Builder2 return hash after payment.
 * @param {Storage} [sessionStorage]
 */
export function buildBuilder2PaymentReturnHash(sessionStorage = globalThis.sessionStorage) {
  const checkoutId = readActiveBuilder2VideoCheckoutId(sessionStorage)
  if (checkoutId) {
    const params = new URLSearchParams({ fromPayment: '1', checkoutId })
    return `#/builder2?${params.toString()}`
  }
  return '#/builder2?fromPayment=1'
}
