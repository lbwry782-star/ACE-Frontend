/**
 * Builder2 status parsing, URL resolution, resume and ownership helpers.
 */

export const BUILDER2_MSG_RESTORING = 'משחזר את העבודה האחרונה…'
export const BUILDER2_MSG_CANCELLING = 'מבטל את העבודה הקודמת…'
export const BUILDER2_MSG_CANCEL_BLOCKED =
  'לא ניתן לאשר שהעבודה הקודמת בוטלה. נסו לרענן שוב בעוד רגע.'
export const BUILDER2_MSG_DISCONNECTED =
  'החיבור נותק. העבודה נשמרה וננסה להתחבר מחדש.'
export const BUILDER2_MSG_RESUME_IN_PROGRESS = 'העבודה כבר ממשיכה מהשלב האחרון.'
export const BUILDER2_MSG_PREPARING_VIDEO_FILE = 'מכין את קובץ הווידאו לצפייה'
export const BUILDER2_MSG_NEW_VIDEO = 'צור סרטון חדש'

const BUILDER2_CANCEL_ACK_STATUSES = new Set([
  'cancelled',
  'canceled',
  'already_cancelled',
  'already_canceled',
  'already_completed',
  'already_terminal'
])
/** Internal constant — not shown in public Builder2 UI. */
export const BUILDER2_MSG_RESUME = 'המשך מאותה נקודה'
export const BUILDER2_MSG_GENERIC_FAILURE = 'לא הצלחנו להשלים את יצירת הסרטון.'

const OWNERSHIP_ERROR_CODES = new Set([
  'ownership_required_historical_job',
  'ownership_mismatch',
  'owner_context_mismatch',
  'historical_job_ownership_required'
])

/**
 * @param {unknown} st
 */
export function normalizeBuilder2Status(st) {
  return String(st?.status ?? '').trim().toLowerCase()
}

/**
 * @param {unknown} url
 */
export function isValidBuilder2VideoUrl(url) {
  const s = String(url ?? '').trim()
  return /^https?:\/\//i.test(s)
}

/**
 * Final URL precedence for completed Builder2 ads.
 * @param {object|null|undefined} payload
 */
export function resolveBuilder2FinalVideoUrl(payload) {
  if (!payload || typeof payload !== 'object') return null
  const candidates = [
    payload.finalVideoWithClosureUrl,
    payload.final_video_with_closure_url,
    payload.finalVideoUrl,
    payload.final_video_url,
    payload.videoUrl,
    payload.video_url
  ]
  for (const c of candidates) {
    if (isValidBuilder2VideoUrl(c)) {
      return String(c).trim()
    }
  }
  return null
}

/**
 * @param {object|null|undefined} payload
 */
export function isBuilder2StatusCompleted(payload) {
  const status = normalizeBuilder2Status(payload)
  return status === 'done' || status === 'completed' || Boolean(payload?.completed)
}

/**
 * @param {object|null|undefined} payload
 */
export function isBuilder2StatusRunning(payload) {
  const status = normalizeBuilder2Status(payload)
  return (
    status === 'running' ||
    status === 'processing' ||
    status === 'queued' ||
    status === 'in_progress'
  )
}

/**
 * @param {object|null|undefined} payload
 */
export function isBuilder2StatusFailed(payload) {
  const status = normalizeBuilder2Status(payload)
  return status === 'failed' || status === 'error' || Boolean(payload?.failed)
}

/**
 * @param {object|null|undefined} payload
 */
export function canBuilder2StatusResume(payload) {
  if (!payload || typeof payload !== 'object') return false
  if (payload.canResume === true || payload.can_resume === true) return true
  const status = normalizeBuilder2Status(payload)
  return status === 'failed' && Boolean(payload.canResume ?? payload.can_resume)
}

/**
 * Terminal failure with no automatic continuation — safe to release frontend job pointer.
 * Active, completed, recoverable, and transient poll errors are excluded.
 * @param {object|null|undefined} payload
 */
export function isBuilder2TerminalNonRecoverableFailure(payload) {
  if (!payload || typeof payload !== 'object') return false

  if (isBuilder2ResumeAlreadyInProgress(payload)) return false
  if (isBuilder2StatusRunning(payload)) return false
  if (isBuilder2StatusCompleted(payload)) return false
  if (canBuilder2StatusResume(payload)) return false

  const status = normalizeBuilder2Status(payload)
  if (status === 'error' && isTransientBuilder2PollFailure(payload)) {
    return false
  }

  if (getBuilder2OwnershipErrorCode(payload)) return true
  if (isBuilder2StatusFailed(payload)) return true
  if (status === 'interrupted') return true
  if (status === 'error') return true

  return false
}

/**
 * @param {object|null|undefined} payload
 */
export function isBuilder2CancelAcknowledged(payload) {
  if (!payload || typeof payload !== 'object') return false
  if (payload.ok === true) return true
  if (payload.acknowledged === true) return true

  const candidates = [
    payload.status,
    payload.result,
    payload.code,
    payload.cancelStatus,
    payload.cancel_status,
    payload.state
  ]
    .filter((v) => v != null)
    .map((v) => String(v).trim().toLowerCase())

  return candidates.some((value) => BUILDER2_CANCEL_ACK_STATUSES.has(value))
}

/**
 * @param {object|null|undefined} payload
 */
export function isBuilder2ResumeAlreadyInProgress(payload) {
  return Boolean(payload?.resumeAlreadyInProgress ?? payload?.resume_already_in_progress)
}

/**
 * @param {object|null|undefined} payload
 */
export function getBuilder2OwnershipErrorCode(payload) {
  const code = String(
    payload?.error ??
      payload?.code ??
      payload?.failureReason ??
      payload?.failure_reason ??
      ''
  )
    .trim()
    .toLowerCase()
  if (OWNERSHIP_ERROR_CODES.has(code)) return code
  const msg = String(payload?.message ?? payload?.error ?? '').toLowerCase()
  if (msg.includes('ownership') && msg.includes('historical')) {
    return 'ownership_required_historical_job'
  }
  if (msg.includes('ownership') && msg.includes('mismatch')) {
    return 'ownership_mismatch'
  }
  return null
}

/** @param {unknown} value */
function isBuilder2InternalFailureToken(value) {
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return false
  if (s.startsWith('builder2_')) return true
  if (/^create_failed$/i.test(s)) return true
  if (/_failed$/.test(s) && !s.includes(' ')) return true
  if (/_invalid_/.test(s) && !s.includes(' ')) return true
  return false
}

/**
 * @param {object|null|undefined} payload
 */
export function getBuilder2SafeFailureMessage(payload) {
  const ownership = getBuilder2OwnershipErrorCode(payload)
  if (ownership) {
    return 'לא ניתן להמשיך את העבודה הזו מהדפדפן הנוכחי. נסו שוב מאותו מכשיר ודפדפן.'
  }

  const stage = payload?.failureStage ?? payload?.failure_stage
  const reason = payload?.failureReason ?? payload?.failure_reason
  const err =
    typeof payload?.error === 'string'
      ? payload.error
      : payload?.error?.message ?? payload?.message

  const candidates = [stage, reason, err].filter(Boolean).map(String)
  if (candidates.some(isBuilder2InternalFailureToken)) {
    return BUILDER2_MSG_GENERIC_FAILURE
  }

  const userFacing = candidates.find((part) => /[\u0590-\u05FF]/.test(part))
  if (userFacing) {
    return userFacing
  }

  if (candidates.length > 0) {
    return BUILDER2_MSG_GENERIC_FAILURE
  }

  return BUILDER2_MSG_GENERIC_FAILURE
}

/**
 * Backend marketing copy for completed Builder2 ads (source of truth — no local generation).
 * @param {object|null|undefined} payload
 */
export function resolveBuilder2MarketingText(payload) {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload.marketingText ?? payload.marketing_text
  if (raw == null) return null
  const text = String(raw)
  return text.length > 0 ? text : null
}

/**
 * @param {object|null|undefined} payload
 */
export function buildBuilder2VideoResult(payload) {
  const videoUrl = resolveBuilder2FinalVideoUrl(payload)
  const marketingText = resolveBuilder2MarketingText(payload)
  return {
    videoUrl: videoUrl || null,
    marketingText,
    headline: payload?.headline || 'Video result',
    headlineText: payload?.headlineText ?? payload?.headline_text ?? null,
    overlayHeadline: payload?.overlayHeadline ?? payload?.overlay_headline ?? null,
    productNameResolved:
      payload?.productNameResolved ??
      payload?.product_name_resolved ??
      payload?.resolvedProductName ??
      payload?.resolved_product_name ??
      null,
    sessionId: payload?.sessionId ?? payload?.session_id ?? null,
    jobId: payload?.jobId ?? payload?.job_id ?? null
  }
}

/**
 * @param {object|null|undefined} payload
 */
export function isTransientBuilder2PollFailure(payload) {
  if (normalizeBuilder2Status(payload) !== 'error') return false
  const msg = String(payload?.error ?? payload?.message ?? '').toLowerCase()
  return (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('fetch') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('aborted') ||
    msg.includes('invalid response')
  )
}
