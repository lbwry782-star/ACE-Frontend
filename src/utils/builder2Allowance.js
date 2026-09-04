/**
 * Builder2 purchase allowance helpers — one or two customer videos (not a campaign).
 */

import { buildBuilder2VideoResult, resolveBuilder2FinalVideoUrl, resolveBuilder2MarketingText } from './builder2Status.js'

/**
 * @typedef {object} Builder2AllowanceState
 * @property {string|null} videoAllowanceId
 * @property {1|2} targetVideoCount
 * @property {number} generatedVideoCount
 * @property {number} remainingVideoCount
 * @property {boolean} canGenerateNext
 * @property {boolean} consumed
 */

/**
 * @typedef {object} Builder2CompletedVideo
 * @property {number} videoIndex
 * @property {string} jobId
 * @property {string|null} videoUrl
 * @property {string|null} marketingText
 * @property {string} [headline]
 * @property {string|null} [headlineText]
 * @property {string|null} [overlayHeadline]
 * @property {string|null} [productNameResolved]
 * @property {string|null} [sessionId]
 * @property {boolean} [isPlaceholder]
 * @property {string|null} [placeholderLabel]
 */

/**
 * @param {unknown} value
 */
function parsePositiveInt(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/**
 * @param {object|null|undefined} payload
 * @returns {Builder2AllowanceState|null}
 */
export function extractBuilder2AllowanceState(payload) {
  if (!payload || typeof payload !== 'object') return null
  const videoAllowanceId = String(payload.videoAllowanceId ?? payload.video_allowance_id ?? '').trim()
  const targetRaw = parsePositiveInt(payload.targetVideoCount ?? payload.target_video_count)
  const targetVideoCount = targetRaw === 1 || targetRaw === 2 ? targetRaw : null
  if (!videoAllowanceId && targetVideoCount == null) return null

  const generatedVideoCount =
    parsePositiveInt(payload.generatedVideoCount ?? payload.generated_video_count) ?? 0
  const remainingVideoCount =
    parsePositiveInt(payload.remainingVideoCount ?? payload.remaining_video_count) ?? 0

  return {
    videoAllowanceId: videoAllowanceId || null,
    targetVideoCount: targetVideoCount ?? 1,
    generatedVideoCount,
    remainingVideoCount,
    canGenerateNext: Boolean(payload.canGenerateNext ?? payload.can_generate_next),
    consumed: Boolean(payload.consumed)
  }
}

/**
 * Merge allowance fields from a status/generate payload into existing state.
 * @param {Builder2AllowanceState|null|undefined} prev
 * @param {object|null|undefined} payload
 */
export function mergeBuilder2AllowanceState(prev, payload) {
  const extracted = extractBuilder2AllowanceState(payload)
  if (!extracted) return prev ?? null
  return {
    videoAllowanceId: extracted.videoAllowanceId ?? prev?.videoAllowanceId ?? null,
    targetVideoCount: extracted.targetVideoCount ?? prev?.targetVideoCount ?? 1,
    generatedVideoCount: extracted.generatedVideoCount ?? prev?.generatedVideoCount ?? 0,
    remainingVideoCount: extracted.remainingVideoCount ?? prev?.remainingVideoCount ?? 0,
    canGenerateNext:
      extracted.canGenerateNext !== undefined
        ? extracted.canGenerateNext
        : Boolean(prev?.canGenerateNext),
    consumed: extracted.consumed !== undefined ? extracted.consumed : Boolean(prev?.consumed)
  }
}

/**
 * @param {object|null|undefined} entry
 * @param {object|null|undefined} [fallbackPayload]
 * @returns {Builder2CompletedVideo|null}
 */
export function buildBuilder2CompletedVideoFromEntry(entry, fallbackPayload = null) {
  const source = entry && typeof entry === 'object' ? entry : fallbackPayload
  if (!source || typeof source !== 'object') return null

  const videoIndex = parsePositiveInt(source.videoIndex ?? source.video_index)
  const jobId = String(source.jobId ?? source.job_id ?? '').trim()
  if (!videoIndex || !jobId) return null

  const built = buildBuilder2VideoResult(source)
  const videoUrl = built.videoUrl ?? resolveBuilder2FinalVideoUrl(source)
  const marketingText = built.marketingText ?? resolveBuilder2MarketingText(source)

  return {
    videoIndex,
    jobId,
    videoUrl: videoUrl || null,
    marketingText,
    headline: built.headline,
    headlineText: built.headlineText,
    overlayHeadline: built.overlayHeadline,
    productNameResolved: built.productNameResolved,
    sessionId: built.sessionId,
    isPlaceholder: Boolean(source.isPlaceholder),
    placeholderLabel: source.placeholderLabel ?? null
  }
}

/**
 * @param {object|null|undefined} payload
 * @returns {Builder2CompletedVideo[]}
 */
export function parseBuilder2CompletedVideosFromStatus(payload) {
  if (!payload || typeof payload !== 'object') return []
  const videos = payload.videos ?? payload.completedVideos ?? payload.completed_videos
  if (!Array.isArray(videos)) return []

  const parsed = videos
    .map((entry) => buildBuilder2CompletedVideoFromEntry(entry))
    .filter(Boolean)

  return parsed.sort((a, b) => a.videoIndex - b.videoIndex)
}

/**
 * Append or replace a completed video by videoIndex.
 * @param {Builder2CompletedVideo[]} existing
 * @param {Builder2CompletedVideo} video
 */
export function upsertBuilder2CompletedVideo(existing, video) {
  if (!video?.jobId || !video.videoIndex) return existing
  const without = existing.filter((v) => v.videoIndex !== video.videoIndex)
  return [...without, video].sort((a, b) => a.videoIndex - b.videoIndex)
}

/**
 * Main Builder2 generate button label.
 * @param {{ isActivelyProcessing?: boolean, consumed?: boolean, canGenerateNext?: boolean, hasCompletedVideos?: boolean }} ctx
 * @returns {'GENERATE'|'GENERATE AGAIN'|'CONSUMED'|'GENERATING'}
 */
export function getBuilder2GenerateButtonLabel(ctx) {
  if (ctx?.isActivelyProcessing) {
    return 'GENERATING'
  }
  if (ctx?.consumed) {
    return 'CONSUMED'
  }
  if (ctx?.canGenerateNext) {
    return 'GENERATE AGAIN'
  }
  return 'GENERATE'
}

/**
 * Whether the main generate button should be disabled.
 * @param {{ isActivelyProcessing?: boolean, consumed?: boolean, canGenerateNext?: boolean, submitInFlight?: boolean, initBlocked?: boolean, hasActiveIncompleteJob?: boolean, hasPendingMutation?: boolean, hasActiveJob?: boolean }} ctx
 */
export function isBuilder2GenerateButtonDisabled(ctx) {
  if (ctx?.initBlocked) return true
  if (ctx?.isActivelyProcessing || ctx?.submitInFlight) return true
  if (ctx?.hasActiveIncompleteJob) return true
  if (ctx?.hasPendingMutation) return true
  if (ctx?.hasActiveJob) return true
  if (ctx?.consumed) return true
  if (ctx?.canGenerateNext) return false
  return false
}

/**
 * Whether allowance is fully consumed (no more videos allowed).
 * @param {Builder2AllowanceState|null|undefined} allowance
 */
export function isBuilder2AllowanceConsumed(allowance) {
  if (!allowance) return false
  if (allowance.consumed) return true
  if (allowance.targetVideoCount === 1 && allowance.generatedVideoCount >= 1) return true
  if (allowance.targetVideoCount === 2 && allowance.generatedVideoCount >= 2) return true
  if (allowance.targetVideoCount === 1 && !allowance.canGenerateNext && allowance.generatedVideoCount >= 1) {
    return true
  }
  if (allowance.targetVideoCount === 2 && !allowance.canGenerateNext && allowance.generatedVideoCount >= 2) {
    return true
  }
  return false
}
