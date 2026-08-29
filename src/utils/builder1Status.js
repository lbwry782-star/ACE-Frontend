/**
 * Builder1 status, ownership, and cancellation helpers.
 */

export const BUILDER1_MSG_CANCEL_BLOCKED =
  'לא ניתן לאשר שהעבודה הקודמת בוטלה. נסו לרענן שוב בעוד רגע.'
export const BUILDER1_MSG_CANCELLING = 'מבטל את העבודה הקודמת…'
export const BUILDER1_MSG_OWNERSHIP =
  'לא ניתן להמשיך את העבודה הזו מהדפדפן הנוכחי. נסו שוב מאותו מכשיר ודפדפן.'
export const BUILDER1_MSG_CAMPAIGN_NOT_READY =
  'הקמפיין עדיין לא מוכן למסירה סופית. נא להמתין או לנסות שוב מאוחר יותר.'
export const BUILDER1_MSG_IDEMPOTENCY_CONFLICT =
  'אירעה התנגשות בבקשה. לא ניתן להמשיך אוטומטית — נסו לרענן את הדף.'

const BUILDER1_CANCEL_ACK_STATUSES = new Set([
  'cancelled',
  'canceled',
  'already_cancelled',
  'already_canceled',
  'already_completed',
  'already_terminal',
  'not_found',
  'job_not_found'
])

const OWNERSHIP_ERROR_CODES = new Set([
  'ownership_required',
  'ownership_required_historical_job',
  'ownership_mismatch',
  'owner_context_mismatch',
  'historical_job_ownership_required'
])

/**
 * @param {object|null|undefined} payload
 */
export function getBuilder1OwnershipErrorCode(payload) {
  const code = String(
    payload?.error ?? payload?.code ?? payload?.failureReason ?? payload?.failure_reason ?? ''
  )
    .trim()
    .toLowerCase()
  if (OWNERSHIP_ERROR_CODES.has(code)) return code

  const httpStatus = Number(payload?.httpStatus ?? payload?.statusCode ?? payload?.status_code)
  if (httpStatus === 403) {
    return code && OWNERSHIP_ERROR_CODES.has(code) ? code : 'ownership_mismatch'
  }

  const msg = String(payload?.message ?? payload?.error ?? '').toLowerCase()
  if (msg.includes('ownership') && msg.includes('historical')) {
    return 'ownership_required_historical_job'
  }
  if (msg.includes('ownership') && msg.includes('required')) {
    return 'ownership_required'
  }
  if (msg.includes('ownership') && msg.includes('mismatch')) {
    return 'ownership_mismatch'
  }
  return null
}

/**
 * @param {object|null|undefined} payload
 */
export function isBuilder1OwnershipFailure(payload) {
  return Boolean(getBuilder1OwnershipErrorCode(payload))
}

/**
 * @param {object|null|undefined} payload
 */
export function isBuilder1CancelAcknowledged(payload) {
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

  return candidates.some((value) => BUILDER1_CANCEL_ACK_STATUSES.has(value))
}

/**
 * @param {object|null|undefined} payload
 */
export function isTransientBuilder1PollFailure(payload) {
  if (isBuilder1OwnershipFailure(payload)) return false
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

/**
 * @param {unknown} payload
 */
export function parseBuilder1CampaignReadinessFields(payload) {
  if (!payload || typeof payload !== 'object') {
    return { campaignReady: false, deliveryReconstructible: false }
  }
  const campaign =
    payload.campaign && typeof payload.campaign === 'object' ? payload.campaign : payload
  return {
    campaignReady: Boolean(campaign.campaignReady ?? campaign.campaign_ready),
    deliveryReconstructible: Boolean(
      campaign.deliveryReconstructible ?? campaign.delivery_reconstructible
    )
  }
}

/**
 * @param {object|null|undefined} session
 */
export function isBuilder1CampaignAuthoritativelyReady(session) {
  if (!session || typeof session !== 'object') return false
  const target = Number(session.targetAdCount)
  const generated = Number(session.generatedCount)
  if (!Number.isInteger(target) || !Number.isInteger(generated) || generated < target) {
    return false
  }
  return session.campaignReady === true
}

/**
 * @param {object|null|undefined} session
 */
export function isBuilder1CampaignDeliveryPending(session) {
  if (!session || typeof session !== 'object') return false
  const target = Number(session.targetAdCount)
  const generated = Number(session.generatedCount)
  return (
    Number.isInteger(target) &&
    Number.isInteger(generated) &&
    generated >= target &&
    session.campaignReady !== true
  )
}

/**
 * @param {object|null|undefined} payload
 */
export function isBuilder1IdempotentReplay(payload) {
  if (!payload || typeof payload !== 'object') return false
  return payload.idempotentReplay === true || payload.idempotent_replay === true
}

/**
 * @param {object|null|undefined} payload
 * @param {number} [httpStatus]
 */
export function isBuilder1IdempotencyConflict(payload, httpStatus) {
  const status = Number(httpStatus ?? payload?.httpStatus ?? payload?.statusCode)
  const code = String(payload?.error ?? payload?.code ?? '')
    .trim()
    .toLowerCase()
  return status === 409 && code === 'builder1_idempotency_conflict'
}

/**
 * @param {object|null|undefined} payload
 */
export function extractBuilder1MutationJobIds(payload) {
  if (!payload || typeof payload !== 'object') {
    return { jobId: null, campaignId: null, idempotentReplay: false }
  }
  const jobId = String(payload.jobId ?? payload.job_id ?? '').trim() || null
  const campaignId =
    String(payload.campaignId ?? payload.campaign_id ?? '').trim() || null
  return {
    jobId,
    campaignId,
    idempotentReplay: isBuilder1IdempotentReplay(payload)
  }
}
