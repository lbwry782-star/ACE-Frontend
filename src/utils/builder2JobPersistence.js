/**
 * Builder2 durable job record (browser-only, no creative payloads).
 */

export const BUILDER2_CURRENT_JOB_STORAGE_KEY = 'ace.builder2.currentJob.v1'
export const BUILDER2_RESUME_CONTRACT_VERSION = 'builder2_resume_v1'

/**
 * @typedef {object} Builder2CurrentJobRecord
 * @property {string} jobId
 * @property {string} createdAt
 * @property {string} [lastKnownStatus]
 * @property {string} [lastKnownProgressStage]
 * @property {string} [lastSuccessfulPollAt]
 * @property {boolean} completed
 * @property {string} [builder2ResumeContractVersion]
 */

/**
 * @param {unknown} raw
 * @returns {Builder2CurrentJobRecord|null}
 */
export function parseBuilder2CurrentJobRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const jobId = String(raw.jobId ?? '').trim()
  if (!jobId) return null
  const createdAt = String(raw.createdAt ?? '').trim()
  if (!createdAt) return null
  return {
    jobId,
    createdAt,
    lastKnownStatus: raw.lastKnownStatus != null ? String(raw.lastKnownStatus) : undefined,
    lastKnownProgressStage:
      raw.lastKnownProgressStage != null ? String(raw.lastKnownProgressStage) : undefined,
    lastSuccessfulPollAt:
      raw.lastSuccessfulPollAt != null ? String(raw.lastSuccessfulPollAt) : undefined,
    completed: Boolean(raw.completed),
    builder2ResumeContractVersion:
      raw.builder2ResumeContractVersion != null
        ? String(raw.builder2ResumeContractVersion)
        : BUILDER2_RESUME_CONTRACT_VERSION
  }
}

/**
 * @param {Storage|null|undefined} storage
 */
export function readBuilder2CurrentJob(storage = globalThis.localStorage) {
  if (!storage) return null
  try {
    const raw = storage.getItem(BUILDER2_CURRENT_JOB_STORAGE_KEY)
    if (!raw) return null
    return parseBuilder2CurrentJobRecord(JSON.parse(raw))
  } catch (_) {
    return null
  }
}

/**
 * @param {Partial<Builder2CurrentJobRecord> & { jobId: string }} patch
 * @param {Storage|null|undefined} storage
 */
export function writeBuilder2CurrentJob(patch, storage = globalThis.localStorage) {
  if (!storage || !patch?.jobId) return null
  const existing = readBuilder2CurrentJob(storage)
  const next = parseBuilder2CurrentJobRecord({
    jobId: String(patch.jobId).trim(),
    createdAt: patch.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
    lastKnownStatus: patch.lastKnownStatus ?? existing?.lastKnownStatus,
    lastKnownProgressStage: patch.lastKnownProgressStage ?? existing?.lastKnownProgressStage,
    lastSuccessfulPollAt: patch.lastSuccessfulPollAt ?? existing?.lastSuccessfulPollAt,
    completed: patch.completed ?? existing?.completed ?? false,
    builder2ResumeContractVersion:
      patch.builder2ResumeContractVersion ??
      existing?.builder2ResumeContractVersion ??
      BUILDER2_RESUME_CONTRACT_VERSION
  })
  if (!next) return null
  try {
    storage.setItem(BUILDER2_CURRENT_JOB_STORAGE_KEY, JSON.stringify(next))
  } catch (_) {
    return null
  }
  return next
}

/**
 * @param {Storage|null|undefined} storage
 */
export function clearBuilder2CurrentJob(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(BUILDER2_CURRENT_JOB_STORAGE_KEY)
  } catch (_) {
    /* ignore */
  }
}

/**
 * @param {string} jobId
 * @param {object} statusPayload
 * @param {Storage|null|undefined} storage
 */
export function updateBuilder2CurrentJobFromStatus(jobId, statusPayload, storage = globalThis.localStorage) {
  const status = String(statusPayload?.status ?? '').trim().toLowerCase()
  const stage = statusPayload?.progressStage ?? statusPayload?.progress_stage
  const completed = status === 'done' || status === 'completed' || Boolean(statusPayload?.completed)
  return writeBuilder2CurrentJob(
    {
      jobId,
      lastKnownStatus: status || undefined,
      lastKnownProgressStage: stage != null ? String(stage) : undefined,
      lastSuccessfulPollAt: new Date().toISOString(),
      completed
    },
    storage
  )
}
