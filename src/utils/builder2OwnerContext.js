/**
 * Stable Builder2 owner context for X-ACE-Batch-State (survives refresh).
 */

export const BUILDER2_OWNER_CONTEXT_STORAGE_KEY = 'ace.ownerContext.v1'

const OWNER_CONTEXT_VERSION = 1

/** Session-stable fallback when storage is unavailable — never rotated per request. */
let sessionOwnerContext = null

function createOwnerId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ace-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * @param {Storage|null|undefined} storage
 */
export function readBuilder2OwnerContext(storage = globalThis.localStorage) {
  if (!storage) return null
  try {
    const raw = storage.getItem(BUILDER2_OWNER_CONTEXT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const ownerId = String(parsed?.ownerId ?? parsed?.id ?? '').trim()
    if (!ownerId) return null
    return {
      version: Number(parsed?.version) || OWNER_CONTEXT_VERSION,
      ownerId,
      createdAt: String(parsed?.createdAt ?? '')
    }
  } catch (_) {
    return null
  }
}

/**
 * @param {Storage|null|undefined} storage
 */
export function ensureBuilder2OwnerContext(storage = globalThis.localStorage) {
  const existing = readBuilder2OwnerContext(storage)
  if (existing?.ownerId) {
    sessionOwnerContext = existing
    return existing
  }

  if (sessionOwnerContext?.ownerId) {
    try {
      storage?.setItem(BUILDER2_OWNER_CONTEXT_STORAGE_KEY, JSON.stringify(sessionOwnerContext))
    } catch (_) {
      /* ignore quota errors */
    }
    return sessionOwnerContext
  }

  const record = {
    version: OWNER_CONTEXT_VERSION,
    ownerId: createOwnerId(),
    createdAt: new Date().toISOString()
  }
  sessionOwnerContext = record
  try {
    storage?.setItem(BUILDER2_OWNER_CONTEXT_STORAGE_KEY, JSON.stringify(record))
  } catch (_) {
    /* ignore quota errors */
  }
  return record
}

/**
 * Opaque header value — no creative content, not for UI display.
 * Reads persisted owner context; creates once if missing (never per-poll rotation).
 * @param {Storage|null|undefined} storage
 */
export function getBuilder2OwnerBatchStateHeader(storage = globalThis.localStorage) {
  const ctx =
    readBuilder2OwnerContext(storage) ?? sessionOwnerContext ?? ensureBuilder2OwnerContext(storage)
  sessionOwnerContext = ctx
  return JSON.stringify({
    v: ctx.version,
    ownerId: ctx.ownerId
  })
}

/**
 * Test-only reset of session owner cache.
 */
export function resetBuilder2OwnerContextSessionCacheForTests() {
  sessionOwnerContext = null
}
