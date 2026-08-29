/**
 * Builder1 owner context for X-ACE-Batch-State (reads shared ACE storage; Builder1-only code).
 */

export const BUILDER1_OWNER_CONTEXT_STORAGE_KEY = 'ace.ownerContext.v1'

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
 * @param {unknown} parsed
 */
function normalizeStoredOwnerRecord(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  const ownerId = String(parsed.ownerId ?? parsed.id ?? '').trim()
  if (!ownerId) return null
  const version = Number(parsed.v ?? parsed.version) || OWNER_CONTEXT_VERSION
  return {
    v: version,
    ownerId,
    createdAt: String(parsed.createdAt ?? '')
  }
}

/**
 * @param {Storage|null|undefined} storage
 */
export function readBuilder1OwnerContext(storage = globalThis.localStorage) {
  if (!storage) return null
  try {
    const raw = storage.getItem(BUILDER1_OWNER_CONTEXT_STORAGE_KEY)
    if (!raw) return null
    return normalizeStoredOwnerRecord(JSON.parse(raw))
  } catch (_) {
    return null
  }
}

/**
 * @param {Storage|null|undefined} storage
 */
export function ensureBuilder1OwnerContext(storage = globalThis.localStorage) {
  const existing = readBuilder1OwnerContext(storage)
  if (existing?.ownerId) {
    sessionOwnerContext = existing
    return existing
  }

  if (sessionOwnerContext?.ownerId) {
    try {
      storage?.setItem(BUILDER1_OWNER_CONTEXT_STORAGE_KEY, JSON.stringify(sessionOwnerContext))
    } catch (_) {
      /* ignore quota errors */
    }
    return sessionOwnerContext
  }

  const record = {
    v: OWNER_CONTEXT_VERSION,
    ownerId: createOwnerId(),
    createdAt: new Date().toISOString()
  }
  sessionOwnerContext = record
  try {
    storage?.setItem(BUILDER1_OWNER_CONTEXT_STORAGE_KEY, JSON.stringify(record))
  } catch (_) {
    /* ignore quota errors */
  }
  return record
}

/**
 * @param {Storage|null|undefined} storage
 */
export function getBuilder1OwnerBatchStateHeader(storage = globalThis.localStorage) {
  const ctx =
    readBuilder1OwnerContext(storage) ?? sessionOwnerContext ?? ensureBuilder1OwnerContext(storage)
  sessionOwnerContext = ctx
  return JSON.stringify({
    v: ctx.v ?? OWNER_CONTEXT_VERSION,
    ownerId: ctx.ownerId
  })
}

/** Test-only reset of session owner cache. */
export function resetBuilder1OwnerContextSessionCacheForTests() {
  sessionOwnerContext = null
}
