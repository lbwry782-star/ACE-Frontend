/**
 * Builder1 recoverable terminal job marker (sessionStorage).
 * NOT an active job — must never trigger refresh cancellation.
 */

export const BUILDER1_RECOVERABLE_TERMINAL_JOB_SESSION_KEY =
  'ace.builder1.recoverableTerminalJob.v1'

const RECORD_VERSION = 1

/** Terminal errors where backend/operator recovery may later succeed on the same jobId. */
const RECOVERABLE_TERMINAL_ERROR_CODES = new Set([
  'planning_failed',
  'campaign_integrity_failed',
  'response_contract_invalid'
])

/**
 * @param {unknown} raw
 */
export function parseBuilder1RecoverableTerminalJobRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const jobId = String(raw.jobId ?? '').trim()
  if (!jobId) return null
  const recordedAtMs = Number(raw.recordedAtMs ?? raw.recordedAt)
  return {
    v: Number(raw.v) || RECORD_VERSION,
    jobId,
    campaignId: raw.campaignId != null ? String(raw.campaignId).trim() || null : null,
    recordedAtMs: Number.isFinite(recordedAtMs) ? recordedAtMs : Date.now(),
    originalTerminalError: String(raw.originalTerminalError ?? '').trim() || null
  }
}

/**
 * @param {Storage|null|undefined} storage
 */
export function readBuilder1RecoverableTerminalJob(storage = globalThis.sessionStorage) {
  if (!storage) return null
  try {
    const raw = storage.getItem(BUILDER1_RECOVERABLE_TERMINAL_JOB_SESSION_KEY)
    if (!raw) return null
    return parseBuilder1RecoverableTerminalJobRecord(JSON.parse(raw))
  } catch (_) {
    return null
  }
}

/**
 * @param {{ jobId: string, campaignId?: string|null, originalTerminalError?: string|null, recordedAtMs?: number }} record
 * @param {Storage|null|undefined} storage
 */
export function writeBuilder1RecoverableTerminalJob(record, storage = globalThis.sessionStorage) {
  if (!storage || !record?.jobId) return null
  const next = parseBuilder1RecoverableTerminalJobRecord({
    v: RECORD_VERSION,
    jobId: record.jobId,
    campaignId: record.campaignId ?? null,
    recordedAtMs: record.recordedAtMs ?? Date.now(),
    originalTerminalError: record.originalTerminalError ?? null
  })
  if (!next) return null
  try {
    storage.setItem(BUILDER1_RECOVERABLE_TERMINAL_JOB_SESSION_KEY, JSON.stringify(next))
  } catch (_) {
    return null
  }
  return next
}

/**
 * @param {Storage|null|undefined} storage
 */
export function clearBuilder1RecoverableTerminalJob(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(BUILDER1_RECOVERABLE_TERMINAL_JOB_SESSION_KEY)
  } catch (_) {
    /* ignore */
  }
}

/**
 * @param {unknown} err
 */
export function isBuilder1RecoverableTerminalError(err) {
  if (!err || typeof err !== 'object') return false
  if (err.isOwnershipError) return false
  if (err.isIdempotencyConflict) return false
  if (err.aborted) return false
  const code = String(
    err.code ?? err?.body?.error ?? err?.body?.code ?? err?.body?.result?.error ?? ''
  )
    .trim()
    .toLowerCase()
  if (!code) return false
  return RECOVERABLE_TERMINAL_ERROR_CODES.has(code)
}

/**
 * @param {unknown} err
 * @param {string|null|undefined} mutationCampaignId
 */
export function resolveRecoverableTerminalCampaignId(err, mutationCampaignId) {
  const fromMutation = String(mutationCampaignId ?? '').trim()
  if (fromMutation) return fromMutation
  const body = err?.body
  if (!body || typeof body !== 'object') return null
  const nested = body.result && typeof body.result === 'object' ? body.result : body
  const id = String(nested.campaignId ?? nested.campaign_id ?? '').trim()
  return id || null
}

/**
 * Persist recoverable terminal reference before active recovery state is cleared.
 * @param {{ jobId: string|null|undefined, campaignId?: string|null, err: unknown }} ctx
 * @param {Storage|null|undefined} storage
 */
export function persistBuilder1RecoverableTerminalJobIfEligible(ctx, storage = globalThis.sessionStorage) {
  const jobId = String(ctx?.jobId ?? '').trim()
  if (!jobId || !isBuilder1RecoverableTerminalError(ctx?.err)) return null
  return writeBuilder1RecoverableTerminalJob(
    {
      jobId,
      campaignId: resolveRecoverableTerminalCampaignId(ctx.err, ctx.campaignId),
      originalTerminalError: String(
        ctx.err?.code ?? ctx.err?.body?.error ?? ctx.err?.body?.code ?? 'terminal_error'
      )
    },
    storage
  )
}
