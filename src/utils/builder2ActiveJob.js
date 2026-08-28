/**
 * Builder2 active job marker (sessionStorage) — survives hard refresh for cancel-on-reload.
 */

export const BUILDER2_ACTIVE_JOB_SESSION_KEY = 'ace.builder2.activeJob.v1'

/**
 * @typedef {object} Builder2ActiveJobRecord
 * @property {string} jobId
 * @property {boolean} active
 * @property {string} createdAt
 */

/**
 * @param {unknown} raw
 * @returns {Builder2ActiveJobRecord|null}
 */
export function parseBuilder2ActiveJobRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const jobId = String(raw.jobId ?? '').trim()
  if (!jobId) return null
  const createdAt = String(raw.createdAt ?? '').trim()
  if (!createdAt) return null
  return {
    jobId,
    active: raw.active !== false,
    createdAt
  }
}

/**
 * @param {Storage|null|undefined} storage
 */
export function readBuilder2ActiveJob(storage = globalThis.sessionStorage) {
  if (!storage) return null
  try {
    const raw = storage.getItem(BUILDER2_ACTIVE_JOB_SESSION_KEY)
    if (!raw) return null
    const record = parseBuilder2ActiveJobRecord(JSON.parse(raw))
    if (!record?.active) return null
    return record
  } catch (_) {
    return null
  }
}

/**
 * @param {{ jobId: string }} patch
 * @param {Storage|null|undefined} storage
 */
export function writeBuilder2ActiveJob(patch, storage = globalThis.sessionStorage) {
  if (!storage || !patch?.jobId) return null
  const next = parseBuilder2ActiveJobRecord({
    jobId: String(patch.jobId).trim(),
    active: true,
    createdAt: new Date().toISOString()
  })
  if (!next) return null
  try {
    storage.setItem(BUILDER2_ACTIVE_JOB_SESSION_KEY, JSON.stringify(next))
  } catch (_) {
    return null
  }
  return next
}

/**
 * @param {Storage|null|undefined} storage
 */
export function clearBuilder2ActiveJob(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(BUILDER2_ACTIVE_JOB_SESSION_KEY)
  } catch (_) {
    /* ignore */
  }
}
