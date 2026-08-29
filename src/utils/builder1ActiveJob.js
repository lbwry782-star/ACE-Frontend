/**
 * Builder1 active job marker (sessionStorage) — survives hard refresh for cancel-on-reload.
 */

export const BUILDER1_ACTIVE_JOB_SESSION_KEY = 'ace.builder1.activeJob.v1'

const ACTIVE_JOB_VERSION = 1

/** @typedef {'initial'|'next'|'retry'|'repair'} Builder1ActiveJobOperation */

/**
 * @param {unknown} raw
 */
export function parseBuilder1ActiveJobRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const jobId = String(raw.jobId ?? '').trim()
  if (!jobId) return null
  const startedAtMs = Number(raw.startedAtMs)
  const operation = String(raw.operation ?? 'initial').trim().toLowerCase()
  const validOps = new Set(['initial', 'next', 'retry', 'repair'])
  const requestIdRaw = raw.requestId != null ? String(raw.requestId).trim() : ''
  return {
    v: Number(raw.v) || ACTIVE_JOB_VERSION,
    jobId,
    campaignId: raw.campaignId != null ? String(raw.campaignId).trim() || null : null,
    operation: validOps.has(operation) ? operation : 'initial',
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
    requestId: requestIdRaw || null
  }
}

/**
 * @param {Storage|null|undefined} storage
 */
export function readBuilder1ActiveJob(storage = globalThis.sessionStorage) {
  if (!storage) return null
  try {
    const raw = storage.getItem(BUILDER1_ACTIVE_JOB_SESSION_KEY)
    if (!raw) return null
    return parseBuilder1ActiveJobRecord(JSON.parse(raw))
  } catch (_) {
    return null
  }
}

/**
 * @param {{ jobId: string, campaignId?: string|null, operation?: Builder1ActiveJobOperation, startedAtMs?: number, requestId?: string|null }} patch
 * @param {Storage|null|undefined} storage
 */
export function writeBuilder1ActiveJob(patch, storage = globalThis.sessionStorage) {
  if (!storage || !patch?.jobId) return null
  const existing = readBuilder1ActiveJob(storage)
  const jobId = String(patch.jobId).trim()
  const campaignId =
    patch.campaignId !== undefined
      ? patch.campaignId != null
        ? String(patch.campaignId).trim() || null
        : null
      : (existing?.campaignId ?? null)
  if (existing?.campaignId && campaignId && existing.campaignId !== campaignId) {
    return null
  }
  const next = parseBuilder1ActiveJobRecord({
    v: ACTIVE_JOB_VERSION,
    jobId,
    campaignId,
    operation: patch.operation ?? existing?.operation ?? 'initial',
    startedAtMs: patch.startedAtMs ?? existing?.startedAtMs ?? Date.now(),
    requestId:
      patch.requestId !== undefined ? patch.requestId : (existing?.requestId ?? null)
  })
  if (!next) return null
  try {
    storage.setItem(BUILDER1_ACTIVE_JOB_SESSION_KEY, JSON.stringify(next))
  } catch (_) {
    return null
  }
  return next
}

/**
 * @param {Storage|null|undefined} storage
 */
export function clearBuilder1ActiveJob(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(BUILDER1_ACTIVE_JOB_SESSION_KEY)
  } catch (_) {
    /* ignore */
  }
}
