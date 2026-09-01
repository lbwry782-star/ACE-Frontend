/**
 * Builder1 pending paid mutation (sessionStorage) — persisted BEFORE POST for idempotent replay.
 */

import { isValidBuilder1RequestId } from './builder1RequestId.js'

export const BUILDER1_PENDING_MUTATION_SESSION_KEY = 'ace.builder1.pendingMutation.v1'

const PENDING_MUTATION_VERSION = 1

/** @typedef {'initial'|'next'|'retry'|'repair'|'resume_planning'} Builder1PendingMutationOperation */

/**
 * @param {unknown} raw
 */
export function parseBuilder1PendingMutationRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const requestId = String(raw.requestId ?? '').trim()
  if (!isValidBuilder1RequestId(requestId)) return null
  const operation = String(raw.operation ?? 'initial').trim().toLowerCase()
  const validOps = new Set(['initial', 'next', 'retry', 'repair', 'resume_planning'])
  const requestPayload = raw.requestPayload
  if (!requestPayload || typeof requestPayload !== 'object') return null
  const createdAtMs = Number(raw.createdAtMs)
  const jobIdRaw = raw.jobId != null ? String(raw.jobId).trim() : ''
  const campaignIdRaw = raw.campaignId != null ? String(raw.campaignId).trim() : ''
  return {
    v: Number(raw.v) || PENDING_MUTATION_VERSION,
    requestId,
    operation: validOps.has(operation) ? operation : 'initial',
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    requestPayload,
    jobId: jobIdRaw || null,
    campaignId: campaignIdRaw || null
  }
}

/**
 * @param {Storage|null|undefined} storage
 */
export function readBuilder1PendingMutation(storage = globalThis.sessionStorage) {
  if (!storage) return null
  try {
    const raw = storage.getItem(BUILDER1_PENDING_MUTATION_SESSION_KEY)
    if (!raw) return null
    return parseBuilder1PendingMutationRecord(JSON.parse(raw))
  } catch (_) {
    return null
  }
}

/**
 * @param {{
 *   requestId: string,
 *   operation: Builder1PendingMutationOperation,
 *   requestPayload: object,
 *   createdAtMs?: number,
 *   jobId?: string|null,
 *   campaignId?: string|null
 * }} record
 * @param {Storage|null|undefined} storage
 */
export function writeBuilder1PendingMutation(record, storage = globalThis.sessionStorage) {
  if (!storage || !record?.requestId || !record?.requestPayload) return null
  const next = parseBuilder1PendingMutationRecord({
    v: PENDING_MUTATION_VERSION,
    requestId: record.requestId,
    operation: record.operation ?? 'initial',
    createdAtMs: record.createdAtMs ?? Date.now(),
    requestPayload: record.requestPayload,
    jobId: record.jobId ?? null,
    campaignId: record.campaignId ?? null
  })
  if (!next) return null
  try {
    storage.setItem(BUILDER1_PENDING_MUTATION_SESSION_KEY, JSON.stringify(next))
  } catch (_) {
    return null
  }
  return next
}

/**
 * @param {Partial<{ jobId: string|null, campaignId: string|null, requestPayload: object }>} patch
 * @param {Storage|null|undefined} storage
 */
export function updateBuilder1PendingMutation(patch, storage = globalThis.sessionStorage) {
  const existing = readBuilder1PendingMutation(storage)
  if (!existing) return null
  return writeBuilder1PendingMutation(
    {
      ...existing,
      requestPayload: patch.requestPayload ?? existing.requestPayload,
      jobId: patch.jobId !== undefined ? patch.jobId : existing.jobId,
      campaignId: patch.campaignId !== undefined ? patch.campaignId : existing.campaignId
    },
    storage
  )
}

/**
 * @param {Storage|null|undefined} storage
 */
export function clearBuilder1PendingMutation(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(BUILDER1_PENDING_MUTATION_SESSION_KEY)
  } catch (_) {
    /* ignore */
  }
}

/**
 * Pending mutation without a confirmed terminal job outcome.
 * @param {ReturnType<typeof parseBuilder1PendingMutationRecord>|null|undefined} record
 */
export function isUnresolvedBuilder1PendingMutation(record) {
  return Boolean(record?.requestId && record?.requestPayload)
}
