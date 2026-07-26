/**
 * Builder2 video generation progress (UI estimate only).
 */

/** Default Builder2 estimate — 20 minutes. */
export const BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS = 1200

export const BUILDER2_ESTIMATED_DURATION_MS = BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS * 1000

/** Early-success completion animation (300–700 ms). */
export const BUILDER2_PROGRESS_COMPLETION_DURATION_MS = 500

/** Max progress while job is still running (never 100% until completion). */
export const BUILDER2_PROGRESS_MAX_WHILE_RUNNING = 99.5

/** Linear cap for the first estimatedTotalSeconds. */
export const BUILDER2_PROGRESS_PRE_ESTIMATE_CAP = 97

/** Post-estimate crawl duration in seconds (97 → 99.5). */
export const BUILDER2_POST_ESTIMATE_CRAWL_SECONDS = 240

export const BUILDER2_PROGRESS_HEADLINE_HE = 'יוצר וידאו איכותי'
export const BUILDER2_PROGRESS_ESTIMATE_HE = 'זמן משוער: כ־20 דקות'
export const BUILDER2_PROGRESS_POST_ESTIMATE_TAIL_HE = 'מסיים את הווידאו'
export const BUILDER2_PROGRESS_REMAINING_PREFIX_HE = 'זמן שנותר: '
export const BUILDER2_PROGRESS_SEPARATOR = ' · '

/** @type {Readonly<Record<string, string>>} */
export const BUILDER2_STAGE_LABELS = Object.freeze({
  strategy: 'מפתח אסטרטגיה',
  planning: 'מפתח אסטרטגיה',
  plan: 'מפתח אסטרטגיה',
  creator: 'יוצר רעיונות',
  creating: 'יוצר רעיונות',
  tournament: 'שופט את הרעיונות',
  judge: 'שופט את הרעיונות',
  judging: 'שופט את הרעיונות',
  winner: 'מפתח את הרעיון הזוכה',
  winner_development: 'מפתח את הרעיון הזוכה',
  winnerdevelopment: 'מפתח את הרעיון הזוכה',
  developing_winner: 'מפתח את הרעיון הזוכה',
  start_image: 'מכין תמונת פתיחה',
  startimage: 'מכין תמונת פתיחה',
  headline: 'מכין תמונת פתיחה',
  scene: 'מכין תמונת פתיחה',
  scene_planning: 'מכין תמונת פתיחה',
  video: 'יוצר את הווידאו',
  runway: 'יוצר את הווידאו',
  generating_video: 'יוצר את הווידאו',
  packaging: 'מסיים את הקובץ',
  assembling: 'מסיים את הקובץ',
  final_packaging: 'מסיים את הקובץ'
})

/** @type {Map<string, object>} */
const jobTimingById = new Map()

/**
 * @param {unknown} progress
 * @returns {number}
 */
export function normalizeBuilder2ProgressPercent(progress) {
  const n = Number(progress)
  if (!Number.isFinite(n)) {
    return 0
  }
  return Math.min(100, Math.max(0, n))
}

/**
 * @param {number} value
 * @param {number} [min=0]
 * @param {number} [max=100]
 */
function clampPercent(value, min = 0, max = 100) {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return min
  }
  return Math.min(max, Math.max(min, n))
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function parseProgressStartedAtMs(value) {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000
  }
  const raw = String(value).trim()
  if (!raw) return null
  const asNum = Number(raw)
  if (Number.isFinite(asNum)) {
    return asNum > 1e12 ? asNum : asNum * 1000
  }
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * @param {object|null|undefined} payload
 */
export function parseBuilder2ProgressTimingFromStatus(payload) {
  if (!payload || typeof payload !== 'object') {
    return {}
  }

  const estimatedTotalSecondsRaw =
    payload.estimatedTotalSeconds ?? payload.estimated_total_seconds
  const elapsedSecondsRaw = payload.elapsedSeconds ?? payload.elapsed_seconds
  const estimatedRemainingSecondsRaw =
    payload.estimatedRemainingSeconds ?? payload.estimated_remaining_seconds

  const estimatedTotalSeconds = Number(estimatedTotalSecondsRaw)
  const elapsedSeconds = Number(elapsedSecondsRaw)
  const estimatedRemainingSeconds = Number(estimatedRemainingSecondsRaw)

  return {
    progressStartedAtMs: parseProgressStartedAtMs(
      payload.progressStartedAt ?? payload.progress_started_at
    ),
    estimatedTotalSeconds:
      Number.isFinite(estimatedTotalSeconds) && estimatedTotalSeconds > 0
        ? estimatedTotalSeconds
        : null,
    elapsedSeconds:
      Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0 ? elapsedSeconds : null,
    estimatedRemainingSeconds:
      Number.isFinite(estimatedRemainingSeconds) && estimatedRemainingSeconds >= 0
        ? estimatedRemainingSeconds
        : null,
    progressStage: payload.progressStage ?? payload.progress_stage ?? null
  }
}

/**
 * @param {number} startMs
 */
function createDefaultTimingState(startMs) {
  return {
    startMs,
    estimatedTotalSeconds: BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS,
    serverElapsedSeconds: null,
    serverElapsedAtMs: null
  }
}

/**
 * @param {string} jobId
 * @param {object|null|undefined} statusPayload
 * @param {number} [fallbackStartMs=Date.now()]
 */
export function reconcileBuilder2JobTiming(jobId, statusPayload, fallbackStartMs = Date.now()) {
  const id = String(jobId ?? '').trim()
  const parsed = parseBuilder2ProgressTimingFromStatus(statusPayload)
  const fallback = Number.isFinite(fallbackStartMs) ? fallbackStartMs : Date.now()

  if (!id) {
    return createDefaultTimingState(fallback)
  }

  let state = jobTimingById.get(id)
  if (!state) {
    state = createDefaultTimingState(fallback)
    jobTimingById.set(id, state)
  }

  if (parsed.progressStartedAtMs != null) {
    state.startMs =
      state.startMs != null
        ? Math.min(state.startMs, parsed.progressStartedAtMs)
        : parsed.progressStartedAtMs
  }
  if (parsed.estimatedTotalSeconds != null) {
    state.estimatedTotalSeconds = parsed.estimatedTotalSeconds
  }
  if (parsed.elapsedSeconds != null) {
    state.serverElapsedSeconds =
      state.serverElapsedSeconds != null
        ? Math.max(state.serverElapsedSeconds, parsed.elapsedSeconds)
        : parsed.elapsedSeconds
    state.serverElapsedAtMs = Date.now()
  }

  return { ...state }
}

/**
 * @param {string} jobId
 */
export function getBuilder2JobTiming(jobId) {
  const id = String(jobId ?? '').trim()
  if (!id || !jobTimingById.has(id)) {
    return null
  }
  return { ...jobTimingById.get(id) }
}

/**
 * @param {object|null|undefined} timingState
 * @param {number} [nowMs=Date.now()]
 */
export function getBuilder2ElapsedSeconds(timingState, nowMs = Date.now()) {
  if (!timingState || typeof timingState !== 'object') {
    return 0
  }

  if (
    timingState.serverElapsedSeconds != null &&
    timingState.serverElapsedAtMs != null &&
    Number.isFinite(timingState.serverElapsedAtMs)
  ) {
    const deltaSec = Math.max(0, (nowMs - timingState.serverElapsedAtMs) / 1000)
    return Math.max(0, timingState.serverElapsedSeconds + deltaSec)
  }

  if (timingState.startMs != null && Number.isFinite(timingState.startMs)) {
    return Math.max(0, (nowMs - timingState.startMs) / 1000)
  }

  return 0
}

/**
 * Uniform time-based progress (stage-independent).
 * @param {number} elapsedSeconds
 * @param {number} [estimatedTotalSeconds=1200]
 * @param {number} [previousPercent=0]
 */
export function computeBuilder2ProgressPercent(
  elapsedSeconds,
  estimatedTotalSeconds = BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS,
  previousPercent = 0
) {
  const prev = clampPercent(previousPercent)
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0)
  const total = Math.max(1, Number(estimatedTotalSeconds) || BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS)

  let target
  if (elapsed <= total) {
    target = Math.min(BUILDER2_PROGRESS_PRE_ESTIMATE_CAP, (elapsed / total) * BUILDER2_PROGRESS_PRE_ESTIMATE_CAP)
  } else {
    const postEstimateSeconds = elapsed - total
    const extraProgress = Math.min(
      BUILDER2_PROGRESS_MAX_WHILE_RUNNING - BUILDER2_PROGRESS_PRE_ESTIMATE_CAP,
      (postEstimateSeconds / BUILDER2_POST_ESTIMATE_CRAWL_SECONDS) *
        (BUILDER2_PROGRESS_MAX_WHILE_RUNNING - BUILDER2_PROGRESS_PRE_ESTIMATE_CAP)
    )
    target = BUILDER2_PROGRESS_PRE_ESTIMATE_CAP + extraProgress
  }

  return Math.max(prev, Math.min(BUILDER2_PROGRESS_MAX_WHILE_RUNNING, target))
}

/**
 * @param {number} fromPercent
 * @param {number} elapsedInCompletionMs
 */
export function computeBuilder2CompletionProgress(fromPercent, elapsedInCompletionMs) {
  const start = clampPercent(fromPercent)
  const duration = BUILDER2_PROGRESS_COMPLETION_DURATION_MS
  if (!Number.isFinite(elapsedInCompletionMs) || elapsedInCompletionMs <= 0) {
    return start
  }
  const t = Math.min(1, elapsedInCompletionMs / duration)
  return Math.min(100, start + (100 - start) * t)
}

/**
 * @param {number} remainingSeconds
 */
export function formatBuilder2RemainingClock(remainingSeconds) {
  const safe = Math.max(0, Math.floor(Number(remainingSeconds) || 0))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * @param {number} elapsedSeconds
 * @param {number} [estimatedTotalSeconds=1200]
 */
export function getBuilder2RemainingTimeText(
  elapsedSeconds,
  estimatedTotalSeconds = BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS
) {
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0)
  const total = Math.max(1, Number(estimatedTotalSeconds) || BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS)

  if (elapsed >= total) {
    return BUILDER2_PROGRESS_POST_ESTIMATE_TAIL_HE
  }

  const remainingSeconds = Math.max(0, total - elapsed)
  return `${BUILDER2_PROGRESS_REMAINING_PREFIX_HE}${formatBuilder2RemainingClock(remainingSeconds)}`
}

/**
 * @param {string} remainingTimeText
 */
export function formatBuilder2ProgressStatusLine(remainingTimeText) {
  const remaining = String(remainingTimeText ?? '').trim()
  if (!remaining) {
    return `${BUILDER2_PROGRESS_HEADLINE_HE}${BUILDER2_PROGRESS_SEPARATOR}${BUILDER2_PROGRESS_ESTIMATE_HE}`
  }
  return `${BUILDER2_PROGRESS_HEADLINE_HE}${BUILDER2_PROGRESS_SEPARATOR}${BUILDER2_PROGRESS_ESTIMATE_HE}${BUILDER2_PROGRESS_SEPARATOR}${remaining}`
}

/**
 * @param {unknown} progressStage
 */
export function getBuilder2StageLabel(progressStage) {
  const raw = String(progressStage ?? '').trim().toLowerCase()
  if (!raw) return null
  const normalized = raw.replace(/[\s-]+/g, '_')
  return BUILDER2_STAGE_LABELS[normalized] ?? BUILDER2_STAGE_LABELS[raw.replace(/_/g, '')] ?? null
}

/**
 * @param {object} ctx
 */
export function resolveBuilder2ProgressFrame(ctx) {
  const {
    elapsedSeconds = 0,
    estimatedTotalSeconds = BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS,
    previousPercent = 0,
    taskSucceeded = false,
    completionFromPercent = null,
    completionElapsedMs = 0
  } = ctx

  if (taskSucceeded && completionFromPercent != null && Number.isFinite(completionElapsedMs)) {
    const from = Number(completionFromPercent)
    const animated = computeBuilder2CompletionProgress(from, completionElapsedMs)
    return Math.max(previousPercent, animated)
  }

  return computeBuilder2ProgressPercent(elapsedSeconds, estimatedTotalSeconds, previousPercent)
}

/**
 * @param {string} jobId
 * @param {number} fallbackStartMs
 * @returns {number}
 */
export function resolveBuilder2JobStartTime(jobId, fallbackStartMs = Date.now()) {
  return reconcileBuilder2JobTiming(jobId, {}, fallbackStartMs).startMs
}

/** @param {string|null|undefined} jobId */
export function clearBuilder2JobStartTime(jobId) {
  const id = String(jobId ?? '').trim()
  if (!id) return
  jobTimingById.delete(id)
}

export function clearAllBuilder2JobStartTimes() {
  jobTimingById.clear()
}

/** @deprecated Use computeBuilder2ProgressPercent with elapsed seconds. */
export function computeBuilder2Progress(elapsedMs, previousPercent = 0) {
  return computeBuilder2ProgressPercent(elapsedMs / 1000, BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS, previousPercent)
}
