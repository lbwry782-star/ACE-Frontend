/**
 * Builder2 pending initial-generate mutation (sessionStorage) — persisted BEFORE POST for idempotent replay.
 */

import { isValidBuilder2RequestId } from './builder2RequestId.js'

export const BUILDER2_PENDING_MUTATION_SESSION_KEY = 'ace.builder2.pendingMutation.v1'

const PENDING_MUTATION_VERSION = 1

/** @typedef {'initial_generate'} Builder2PendingMutationOperation */

/**
 * @param {unknown} raw
 */
export function parseBuilder2PendingMutationRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const requestId = String(raw.requestId ?? '').trim()
  if (!isValidBuilder2RequestId(requestId)) return null
  const operation = String(raw.operation ?? 'initial_generate').trim().toLowerCase()
  if (operation !== 'initial_generate') return null
  const requestPayload = raw.requestPayload
  if (!requestPayload || typeof requestPayload !== 'object') return null
  const productName = requestPayload.productName != null ? String(requestPayload.productName) : ''
  const productDescription =
    requestPayload.productDescription != null ? String(requestPayload.productDescription) : ''
  const targetVideoCount = Number(requestPayload.targetVideoCount)
  if (targetVideoCount !== 1 && targetVideoCount !== 2) return null
  const createdAtMs = Number(raw.createdAtMs)
  const checkoutContext =
    raw.checkoutContext && typeof raw.checkoutContext === 'object' ? raw.checkoutContext : null
  return {
    v: Number(raw.v) || PENDING_MUTATION_VERSION,
    requestId,
    operation: 'initial_generate',
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    requestPayload: {
      productName,
      productDescription,
      targetVideoCount
    },
    checkoutContext
  }
}

/**
 * @param {Storage|null|undefined} storage
 */
export function readBuilder2PendingMutation(storage = globalThis.sessionStorage) {
  if (!storage) return null
  try {
    const raw = storage.getItem(BUILDER2_PENDING_MUTATION_SESSION_KEY)
    if (!raw) return null
    return parseBuilder2PendingMutationRecord(JSON.parse(raw))
  } catch (_) {
    return null
  }
}

/**
 * @param {{
 *   requestId: string,
 *   operation?: Builder2PendingMutationOperation,
 *   requestPayload: { productName?: string, productDescription?: string, targetVideoCount: number },
 *   createdAtMs?: number,
 *   checkoutContext?: object|null
 * }} record
 * @param {Storage|null|undefined} storage
 */
export function writeBuilder2PendingMutation(record, storage = globalThis.sessionStorage) {
  if (!storage || !record?.requestId || !record?.requestPayload) return null
  const next = parseBuilder2PendingMutationRecord({
    v: PENDING_MUTATION_VERSION,
    requestId: record.requestId,
    operation: record.operation ?? 'initial_generate',
    createdAtMs: record.createdAtMs ?? Date.now(),
    requestPayload: record.requestPayload,
    checkoutContext: record.checkoutContext ?? null
  })
  if (!next) return null
  try {
    storage.setItem(BUILDER2_PENDING_MUTATION_SESSION_KEY, JSON.stringify(next))
  } catch (_) {
    return null
  }
  return next
}

/**
 * @param {Storage|null|undefined} storage
 */
export function clearBuilder2PendingMutation(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(BUILDER2_PENDING_MUTATION_SESSION_KEY)
  } catch (_) {
    /* ignore */
  }
}

/**
 * Pending initial mutation without a confirmed terminal outcome on the client.
 * @param {ReturnType<typeof parseBuilder2PendingMutationRecord>|null|undefined} record
 */
export function isUnresolvedBuilder2PendingMutation(record) {
  return Boolean(record?.requestId && record?.requestPayload)
}
