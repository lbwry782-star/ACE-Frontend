/**
 * Builder1 progress (UI estimate only).
 */

/** Initial campaign planning + ad 1 — midpoint ~10 minutes. */
export const BUILDER1_INITIAL_ESTIMATED_DURATION_MS = 600_000

/** One later GENERATE AGAIN (no re-planning) — approximately 1 minute. */
export const BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS = 60_000

/** Early-success completion animation (300–700 ms). */
export const BUILDER1_PROGRESS_COMPLETION_DURATION_MS = 500

/** Max progress while initial job is still running (never 100% until completion). */
export const BUILDER1_INITIAL_PROGRESS_MAX_WHILE_RUNNING = 96

/** @readonly */
export const BUILDER1_PROGRESS_OPERATION = Object.freeze({
  INITIAL_CAMPAIGN: 'initial_campaign',
  NEXT_AD: 'next_ad'
})

export const BUILDER1_INITIAL_PROGRESS_HEADLINE_HE = 'יוצרים עבורך קמפיין משובח'
export const BUILDER1_INITIAL_PROGRESS_ESTIMATE_HE = 'זמן משוער: 8–12 דקות'

export const BUILDER1_INITIAL_PROGRESS_HEADLINE_EN = 'Creating a polished campaign for you'
export const BUILDER1_INITIAL_PROGRESS_ESTIMATE_EN = 'Estimated time: 8–12 minutes'

export const BUILDER1_INITIAL_PROGRESS_SEPARATOR = ' · '

/** @type {ReadonlyArray<{ t: number, p: number }>} */
const INITIAL_PROGRESS_CURVE = Object.freeze([
  { t: 0, p: 0 },
  { t: 120_000, p: 20 },
  { t: 300_000, p: 50 },
  { t: 480_000, p: 75 },
  { t: 600_000, p: 90 }
])

/** Slow crawl from 90% toward 96% after the midpoint estimate. */
const INITIAL_PROGRESS_POST_ESTIMATE_CRAWL_MS = 600_000

/** @type {Map<string, number>} */
const jobStartTimesById = new Map()

/**
 * Select progress operation type before starting the bar.
 * @param {{ campaignId?: string|null, canGenerateNext?: boolean }} ctx
 * @returns {'initial_campaign'|'next_ad'}
 */
export function resolveBuilder1ProgressOperationType(ctx) {
  const campaignId = String(ctx?.campaignId ?? '').trim()
  if (campaignId && ctx?.canGenerateNext) {
    return BUILDER1_PROGRESS_OPERATION.NEXT_AD
  }
  return BUILDER1_PROGRESS_OPERATION.INITIAL_CAMPAIGN
}

/**
 * @param {'initial_campaign'|'next_ad'|string} operationType
 * @returns {number}
 */
export function getBuilder1EstimatedDurationForOperation(operationType) {
  if (operationType === BUILDER1_PROGRESS_OPERATION.NEXT_AD) {
    return BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS
  }
  return BUILDER1_INITIAL_ESTIMATED_DURATION_MS
}

/**
 * @param {unknown} progress
 * @returns {number} Safe 0–100 integer for DOM width.
 */
export function normalizeBuilder1ProgressPercent(progress) {
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
 * Ease-out within each segment (fast start, slower finish).
 * @param {number} ratio 0–1
 */
function easeOutRatio(ratio) {
  const t = Math.min(1, Math.max(0, ratio))
  return 1 - (1 - t) ** 2
}

/**
 * Piecewise ease-out curve for initial campaign generation.
 * @param {number} elapsedMs
 * @returns {number}
 */
export function computeBuilder1InitialCampaignProgress(elapsedMs, previousPercent = 0) {
  const prev = clampPercent(previousPercent)
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return prev
  }

  let target = 0
  for (let i = 1; i < INITIAL_PROGRESS_CURVE.length; i += 1) {
    const segmentStart = INITIAL_PROGRESS_CURVE[i - 1]
    const segmentEnd = INITIAL_PROGRESS_CURVE[i]
    if (elapsedMs <= segmentEnd.t) {
      const span = segmentEnd.t - segmentStart.t
      const ratio = span > 0 ? (elapsedMs - segmentStart.t) / span : 1
      target = segmentStart.p + (segmentEnd.p - segmentStart.p) * easeOutRatio(ratio)
      break
    }
  }

  if (elapsedMs > BUILDER1_INITIAL_ESTIMATED_DURATION_MS) {
    const overdueMs = elapsedMs - BUILDER1_INITIAL_ESTIMATED_DURATION_MS
    const crawlRatio = Math.min(1, overdueMs / INITIAL_PROGRESS_POST_ESTIMATE_CRAWL_MS)
    target = 90 + (BUILDER1_INITIAL_PROGRESS_MAX_WHILE_RUNNING - 90) * easeOutRatio(crawlRatio)
  }

  const capped = Math.min(BUILDER1_INITIAL_PROGRESS_MAX_WHILE_RUNNING, target)
  return Math.max(prev, capped)
}

/**
 * Linear progress from elapsed time; caps at 100, never decreases.
 * @param {number} elapsedMs
 * @param {number} estimatedDurationMs
 * @param {number} [previousPercent=0]
 */
export function computeBuilder1LinearProgress(elapsedMs, estimatedDurationMs, previousPercent = 0) {
  const prev = clampPercent(previousPercent)
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return prev
  }
  if (!Number.isFinite(estimatedDurationMs) || estimatedDurationMs <= 0) {
    return Math.max(prev, 100)
  }
  const linear = (elapsedMs / estimatedDurationMs) * 100
  const next = Math.min(100, Math.max(0, linear))
  return Math.max(prev, next)
}

/**
 * Smooth completion animation from `fromPercent` to 100.
 * @param {number} fromPercent
 * @param {number} elapsedInCompletionMs
 */
export function computeBuilder1CompletionProgress(fromPercent, elapsedInCompletionMs) {
  const start = clampPercent(fromPercent)
  const duration = BUILDER1_PROGRESS_COMPLETION_DURATION_MS
  if (!Number.isFinite(elapsedInCompletionMs) || elapsedInCompletionMs <= 0) {
    return start
  }
  const t = Math.min(1, elapsedInCompletionMs / duration)
  return Math.min(100, start + (100 - start) * t)
}

/**
 * @param {number} remainingMs
 */
export function formatBuilder1RemainingClock(remainingMs) {
  const safeSec = Math.max(0, Math.floor(Number(remainingMs) / 1000))
  const minutes = Math.floor(safeSec / 60)
  const seconds = safeSec % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Second-level remaining clock for Builder1 progress (local estimate only).
 * @param {number} elapsedMs
 * @param {number} estimatedDurationMs
 * @param {'he'|'en'} [language='he']
 */
export function getBuilder1RemainingTimeText(
  elapsedMs,
  estimatedDurationMs = BUILDER1_INITIAL_ESTIMATED_DURATION_MS,
  language = 'he'
) {
  const isHe = language === 'he'
  const safeElapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0
  const total = Number.isFinite(estimatedDurationMs) && estimatedDurationMs > 0
    ? estimatedDurationMs
    : BUILDER1_INITIAL_ESTIMATED_DURATION_MS

  if (safeElapsed >= total) {
    return '00:00'
  }

  const remainingMs = Math.max(0, total - safeElapsed)
  return formatBuilder1RemainingClock(remainingMs)
}

/**
 * @deprecated Use getBuilder1RemainingTimeText — kept for legacy tests.
 * @param {number} elapsedMs
 * @param {'he'|'en'} [language='he']
 */
export function getBuilder1InitialRemainingTimeText(elapsedMs, language = 'he') {
  return getBuilder1RemainingTimeText(elapsedMs, BUILDER1_INITIAL_ESTIMATED_DURATION_MS, language)
}

/**
 * Single-line initial progress status (headline · estimate · remaining).
 * @param {string} remainingTimeText
 * @param {'he'|'en'} [language='he']
 */
export function formatBuilder1InitialProgressStatusLine(remainingTimeText, language = 'he') {
  const isHe = language === 'he'
  const headline = isHe ? BUILDER1_INITIAL_PROGRESS_HEADLINE_HE : BUILDER1_INITIAL_PROGRESS_HEADLINE_EN
  const estimate = isHe ? BUILDER1_INITIAL_PROGRESS_ESTIMATE_HE : BUILDER1_INITIAL_PROGRESS_ESTIMATE_EN
  const remaining = String(remainingTimeText ?? '').trim()
  const remainingLabel = isHe ? 'זמן שנותר: ' : 'Remaining: '
  if (!remaining) {
    return `${headline}${BUILDER1_INITIAL_PROGRESS_SEPARATOR}${estimate}`
  }
  return `${headline}${BUILDER1_INITIAL_PROGRESS_SEPARATOR}${estimate}${BUILDER1_INITIAL_PROGRESS_SEPARATOR}${remainingLabel}${remaining}`
}

/**
 * Next-ad progress status line with MM:SS countdown.
 * @param {string} remainingTimeText
 * @param {string} [stageLabel='']
 * @param {'he'|'en'} [language='he']
 */
export function formatBuilder1NextAdProgressStatusLine(
  remainingTimeText,
  stageLabel = '',
  language = 'he'
) {
  const isHe = language === 'he'
  const remaining = String(remainingTimeText ?? '').trim()
  const remainingLabel = isHe ? 'זמן שנותר: ' : 'Remaining: '
  const stage = String(stageLabel ?? '').trim()
  const parts = []
  if (stage) parts.push(stage)
  if (remaining) parts.push(`${remainingLabel}${remaining}`)
  return parts.join(BUILDER1_INITIAL_PROGRESS_SEPARATOR)
}

/**
 * Resolve display progress for one animation frame.
 * @param {object} ctx
 */
export function resolveBuilder1ProgressFrame(ctx) {
  const {
    elapsedMs,
    estimatedDurationMs,
    previousPercent = 0,
    operationType = BUILDER1_PROGRESS_OPERATION.NEXT_AD,
    taskSucceeded = false,
    completionFromPercent = null,
    completionElapsedMs = 0
  } = ctx

  if (taskSucceeded && completionFromPercent != null && Number.isFinite(completionElapsedMs)) {
    const from = Number(completionFromPercent)
    const animated = computeBuilder1CompletionProgress(from, completionElapsedMs)
    return Math.max(previousPercent, animated)
  }

  if (operationType === BUILDER1_PROGRESS_OPERATION.INITIAL_CAMPAIGN) {
    return computeBuilder1InitialCampaignProgress(elapsedMs, previousPercent)
  }

  return computeBuilder1LinearProgress(elapsedMs, estimatedDurationMs, previousPercent)
}

/**
 * Persist a per-job start timestamp (isolated by job ID).
 * @param {string} jobId
 * @param {number} fallbackStartMs
 * @returns {number}
 */
export function resolveBuilder1JobStartTime(jobId, fallbackStartMs = Date.now()) {
  const id = String(jobId ?? '').trim()
  const fallback = Number.isFinite(fallbackStartMs) ? fallbackStartMs : Date.now()
  if (!id) {
    return fallback
  }
  if (!jobStartTimesById.has(id)) {
    jobStartTimesById.set(id, fallback)
  }
  return jobStartTimesById.get(id)
}

/** @param {string|null|undefined} jobId */
export function clearBuilder1JobStartTime(jobId) {
  const id = String(jobId ?? '').trim()
  if (!id) return
  jobStartTimesById.delete(id)
}

export function clearAllBuilder1JobStartTimes() {
  jobStartTimesById.clear()
}
