/**
 * Builder2 video generation progress (UI estimate only).
 */

/** Default Builder2 estimate — 30 minutes. */
export const BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS = 1800

export const BUILDER2_ESTIMATED_DURATION_MS = BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS * 1000

/** Early-success completion animation (300–700 ms). */
export const BUILDER2_PROGRESS_COMPLETION_DURATION_MS = 500

/** Max progress while job is still running (never 100% until completion). */
export const BUILDER2_PROGRESS_MAX_WHILE_RUNNING = 95

/** Cap while waiting for final URL after backend reports completed. */
export const BUILDER2_PROGRESS_PENDING_URL_CAP = 95

/** Linear cap for the first estimatedTotalSeconds. */
export const BUILDER2_PROGRESS_PRE_ESTIMATE_CAP = 95

/** Post-estimate crawl duration in seconds (reserved; cap equals max while running). */
export const BUILDER2_POST_ESTIMATE_CRAWL_SECONDS = 240

export const BUILDER2_PROGRESS_HEADLINE_HE = 'יוצר וידאו איכותי'
export const BUILDER2_PROGRESS_ESTIMATE_HE = 'זמן משוער: כ־30 דקות'
export const BUILDER2_PROGRESS_POST_ESTIMATE_TAIL_HE = 'מסיים את הווידאו'
export const BUILDER2_PROGRESS_REMAINING_PREFIX_HE = 'זמן שנותר: '
export const BUILDER2_PROGRESS_SEPARATOR = ' · '

/** @type {Readonly<Record<string, string>>} */
export const BUILDER2_STAGE_LABELS = Object.freeze({
  queued: 'העבודה ממתינה להתחלה',
  strategy: 'מגדיר את הבעיה והיתרון היחסי',
  planning: 'מגדיר את הבעיה והיתרון היחסי',
  plan: 'מגדיר את הבעיה והיתרון היחסי',
  creator_generation: 'מפתח רעיונות וסלוגנים',
  creator: 'מפתח רעיונות וסלוגנים',
  creating: 'מפתח רעיונות וסלוגנים',
  creator_complete: 'מפתח רעיונות וסלוגנים',
  judge_generation: 'השופטים בוחנים את הפרסומות',
  tournament: 'השופטים בוחנים את הפרסומות',
  judge: 'השופטים בוחנים את הפרסומות',
  judging: 'השופטים בוחנים את הפרסומות',
  judge_complete: 'השופטים בוחנים את הפרסומות',
  winner_selection: 'בוחר את הרעיון המנצח',
  winner: 'בוחר את הרעיון המנצח',
  winner_development: 'מפתח את הסרטון המנצח',
  winnerdevelopment: 'מפתח את הסרטון המנצח',
  developing_winner: 'מפתח את הסרטון המנצח',
  advertising_closure: 'מכין את הסגירה הפרסומית',
  media_prerequisite_validation: 'מכין את הסגירה הפרסומית',
  start_image_generation: 'מכין את תמונת הפתיחה',
  start_image: 'מכין את תמונת הפתיחה',
  startimage: 'מכין את תמונת הפתיחה',
  start_image_complete: 'מכין את תמונת הפתיחה',
  headline: 'מכין את תמונת הפתיחה',
  scene: 'מכין את תמונת הפתיחה',
  scene_planning: 'מכין את תמונת הפתיחה',
  runway_submission: 'שולח את הסרטון ליצירה',
  runway_waiting: 'יוצר את סרטון הווידאו',
  runway: 'יוצר את סרטון הווידאו',
  video: 'יוצר את סרטון הווידאו',
  generating_video: 'יוצר את סרטון הווידאו',
  runway_complete: 'יוצר את סרטון הווידאו',
  video_download: 'מוריד את תוצאת הווידאו',
  postprocessing: 'מעבד את הסרטון',
  rendering_advertising_closure: 'מוסיף שם מוצר וסלוגן',
  publishing_final_video: 'מכין את הווידאו לצפייה ולהורדה',
  packaging: 'מכין את הווידאו לצפייה ולהורדה',
  assembling: 'מכין את הווידאו לצפייה ולהורדה',
  final_packaging: 'מכין את הווידאו לצפייה ולהורדה',
  completed: 'הווידאו מוכן',
  done: 'הווידאו מוכן'
})

/** @type {Readonly<Record<string, number>>} */
export const BUILDER2_STAGE_PROGRESS_FLOORS = Object.freeze({
  queued: 0,
  strategy: 3,
  creator_generation: 8,
  creator_complete: 40,
  judge_generation: 42,
  judge_complete: 58,
  winner_selection: 60,
  winner_development: 62,
  advertising_closure: 66,
  media_prerequisite_validation: 68,
  start_image_generation: 70,
  start_image_complete: 74,
  runway_submission: 76,
  runway_waiting: 86,
  runway_complete: 95,
  video_download: 96,
  postprocessing: 97,
  rendering_advertising_closure: 98,
  publishing_final_video: 99,
  completed: 100
})

/** @type {Readonly<Record<string, string>>} */
const BUILDER2_STAGE_FLOOR_ALIASES = Object.freeze({
  planning: 'strategy',
  plan: 'strategy',
  creator: 'creator_generation',
  creating: 'creator_generation',
  tournament: 'judge_generation',
  judge: 'judge_generation',
  judging: 'judge_generation',
  winner: 'winner_selection',
  winnerdevelopment: 'winner_development',
  developing_winner: 'winner_development',
  start_image: 'start_image_generation',
  startimage: 'start_image_generation',
  headline: 'start_image_generation',
  scene: 'start_image_generation',
  scene_planning: 'start_image_generation',
  runway: 'runway_waiting',
  video: 'runway_waiting',
  generating_video: 'runway_waiting',
  packaging: 'publishing_final_video',
  assembling: 'publishing_final_video',
  final_packaging: 'publishing_final_video',
  done: 'completed'
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
 * @param {unknown} progressStage
 */
export function normalizeBuilder2ProgressStage(progressStage) {
  const raw = String(progressStage ?? '').trim().toLowerCase()
  if (!raw) return null
  const normalized = raw.replace(/[\s-]+/g, '_')
  return BUILDER2_STAGE_FLOOR_ALIASES[normalized] ?? normalized
}

/**
 * @param {unknown} progressStage
 */
export function getBuilder2StageProgressFloor(progressStage) {
  const canonical = normalizeBuilder2ProgressStage(progressStage)
  if (!canonical) return 0
  return BUILDER2_STAGE_PROGRESS_FLOORS[canonical] ?? 0
}

/**
 * Raw running target before per-frame smoothing (time + stage floor, capped at 95%).
 */
export function computeBuilder2ProgressTarget(
  elapsedSeconds,
  estimatedTotalSeconds = BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS,
  stageFloor = 0,
  pendingFinalUrl = false
) {
  if (pendingFinalUrl) {
    return Math.min(BUILDER2_PROGRESS_PENDING_URL_CAP, BUILDER2_PROGRESS_MAX_WHILE_RUNNING)
  }
  const timeTarget = computeBuilder2TimePercent(elapsedSeconds, estimatedTotalSeconds)
  const blendedTarget = Math.max(timeTarget, clampPercent(stageFloor, 0, 100))
  return Math.min(BUILDER2_PROGRESS_MAX_WHILE_RUNNING, blendedTarget)
}

/**
 * Smoothly raise displayed progress toward target without moving backward.
 * @param {number} targetPercent
 * @param {number} previousPercent
 * @param {number} [maxStep=0.12]
 */
export function advanceBuilder2DisplayedProgress(targetPercent, previousPercent, maxStep = 0.12) {
  const prev = clampPercent(previousPercent)
  const target = clampPercent(targetPercent, 0, BUILDER2_PROGRESS_MAX_WHILE_RUNNING)
  const delta = target - prev
  if (delta <= 0) {
    return prev
  }
  return Math.min(BUILDER2_PROGRESS_MAX_WHILE_RUNNING, prev + Math.min(delta, maxStep))
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
    serverElapsedAtMs: null,
    stageFloor: 0
  }
}

/**
 * Local startMs elapsed only (ignores server anchor).
 * @param {object} state
 * @param {number} nowMs
 */
function getBuilder2LocalElapsedFromState(state, nowMs) {
  if (state.startMs != null && Number.isFinite(state.startMs)) {
    return Math.max(0, (nowMs - state.startMs) / 1000)
  }
  return 0
}

/**
 * Effective elapsed from internal timing state (reconcile helper).
 * @param {object} state
 * @param {number} nowMs
 */
function getBuilder2EffectiveElapsedFromState(state, nowMs) {
  if (
    state.serverElapsedSeconds != null &&
    state.serverElapsedAtMs != null &&
    Number.isFinite(state.serverElapsedAtMs)
  ) {
    const deltaSec = Math.max(0, (nowMs - state.serverElapsedAtMs) / 1000)
    return Math.max(0, state.serverElapsedSeconds + deltaSec)
  }

  if (state.startMs != null && Number.isFinite(state.startMs)) {
    return Math.max(0, (nowMs - state.startMs) / 1000)
  }

  return 0
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
    const incoming = parsed.elapsedSeconds

    // Zero means "no useful server update yet" — never activate or refresh server timing.
    if (incoming > 0) {
      const nowMs = Date.now()

      if (state.serverElapsedSeconds != null) {
        const effectiveNow = getBuilder2EffectiveElapsedFromState(state, nowMs)

        if (incoming < effectiveNow - 0.001) {
          // Regressive relative to established server clock — keep monotonic timing.
        } else if (incoming === state.serverElapsedSeconds) {
          // Unchanged positive value — do not reset serverElapsedAtMs.
        } else if (incoming > state.serverElapsedSeconds) {
          state.serverElapsedSeconds = incoming
          state.serverElapsedAtMs = nowMs
        }
      } else {
        const localElapsed = getBuilder2LocalElapsedFromState(state, nowMs)
        const localLooksExtrapolated =
          localElapsed >
          (state.estimatedTotalSeconds ?? BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS)

        if (incoming >= localElapsed - 0.001 || localLooksExtrapolated) {
          state.serverElapsedSeconds = incoming
          state.serverElapsedAtMs = nowMs
        }
      }
    }
  }
  if (parsed.progressStage != null) {
    state.stageFloor = Math.max(state.stageFloor ?? 0, getBuilder2StageProgressFloor(parsed.progressStage))
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
 * Time-only progress target (no monotonic previous-percent guard).
 * @param {number} elapsedSeconds
 * @param {number} [estimatedTotalSeconds=1200]
 */
function computeBuilder2TimePercent(
  elapsedSeconds,
  estimatedTotalSeconds = BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS
) {
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0)
  const total = Math.max(1, Number(estimatedTotalSeconds) || BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS)

  if (elapsed <= total) {
    return Math.min(BUILDER2_PROGRESS_PRE_ESTIMATE_CAP, (elapsed / total) * BUILDER2_PROGRESS_PRE_ESTIMATE_CAP)
  }

  const postEstimateSeconds = elapsed - total
  const extraProgress = Math.min(
    BUILDER2_PROGRESS_MAX_WHILE_RUNNING - BUILDER2_PROGRESS_PRE_ESTIMATE_CAP,
    (postEstimateSeconds / BUILDER2_POST_ESTIMATE_CRAWL_SECONDS) *
      (BUILDER2_PROGRESS_MAX_WHILE_RUNNING - BUILDER2_PROGRESS_PRE_ESTIMATE_CAP)
  )
  return BUILDER2_PROGRESS_PRE_ESTIMATE_CAP + extraProgress
}

/**
 * Uniform time-based progress with optional stage floor.
 * @param {number} elapsedSeconds
 * @param {number} [estimatedTotalSeconds=1200]
 * @param {number} [previousPercent=0]
 * @param {number} [stageFloor=0]
 */
export function computeBuilder2ProgressPercent(
  elapsedSeconds,
  estimatedTotalSeconds = BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS,
  previousPercent = 0,
  stageFloor = 0
) {
  const prev = clampPercent(previousPercent)
  const timeTarget = computeBuilder2TimePercent(elapsedSeconds, estimatedTotalSeconds)
  const blendedTarget = Math.max(timeTarget, clampPercent(stageFloor, 0, 100))
  return Math.max(prev, Math.min(BUILDER2_PROGRESS_MAX_WHILE_RUNNING, blendedTarget))
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
  return (
    BUILDER2_STAGE_LABELS[normalized] ??
    BUILDER2_STAGE_LABELS[BUILDER2_STAGE_FLOOR_ALIASES[normalized] ?? ''] ??
    BUILDER2_STAGE_LABELS[raw.replace(/_/g, '')] ??
    null
  )
}

/**
 * @param {object} ctx
 */
export function resolveBuilder2ProgressFrame(ctx) {
  const {
    elapsedSeconds = 0,
    estimatedTotalSeconds = BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS,
    previousPercent = 0,
    stageFloor = 0,
    pendingFinalUrl = false,
    taskSucceeded = false,
    completionFromPercent = null,
    completionElapsedMs = 0
  } = ctx

  if (pendingFinalUrl) {
    return Math.max(
      previousPercent,
      Math.min(BUILDER2_PROGRESS_PENDING_URL_CAP, BUILDER2_PROGRESS_MAX_WHILE_RUNNING)
    )
  }

  if (taskSucceeded && completionFromPercent != null && Number.isFinite(completionElapsedMs)) {
    const from = Number(completionFromPercent)
    const animated = computeBuilder2CompletionProgress(from, completionElapsedMs)
    return Math.max(previousPercent, animated)
  }

  const target = computeBuilder2ProgressTarget(
    elapsedSeconds,
    estimatedTotalSeconds,
    stageFloor,
    pendingFinalUrl
  )
  return advanceBuilder2DisplayedProgress(target, previousPercent)
}

/**
 * @deprecated Prefer computeBuilder2ProgressTarget + advanceBuilder2DisplayedProgress.
 */
export function mergeBuilder2ProgressWithStageFloor(
  timePercent,
  stageFloor,
  previousPercent,
  maxStep = 0.12
) {
  const target = Math.max(
    clampPercent(timePercent, 0, BUILDER2_PROGRESS_MAX_WHILE_RUNNING),
    clampPercent(stageFloor, 0, 100)
  )
  return advanceBuilder2DisplayedProgress(target, previousPercent, maxStep)
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
