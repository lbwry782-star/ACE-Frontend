/**
 * Builder2 explicit offline placeholder test mode.
 * Active ONLY when session flag is set AND navigator.onLine === false.
 */

import JSZip from 'jszip'
import { countMarketingWords } from './builder1Campaign.js'
import { createBuilder1RequestId } from './builder1RequestId.js'
import { mergeBuilder2AllowanceState, buildBuilder2CompletedVideoFromEntry } from './builder2Allowance.js'

export const BUILDER2_OFFLINE_PLACEHOLDER_SESSION_KEY = 'ace.builder2.offlinePlaceholders.v1'

/** Builder2-only custom event — helpers notify mounted Builder2Page without reload. */
export const BUILDER2_OFFLINE_TEST_STATE_EVENT = 'ace:builder2-offline-test-state'

export const BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE =
  'Offline test armed — switch DevTools Network to Offline.'

/** Distinct exactly-50-word placeholder marketing texts. */
export const BUILDER2_PLACEHOLDER_MARKETING_TEXT_1 =
  'Placeholder marketing text number one for Builder2 offline testing only alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november'

export const BUILDER2_PLACEHOLDER_MARKETING_TEXT_2 =
  'Placeholder marketing text number two for Builder2 offline testing only hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform'

/** Simulated generation delay before synthetic DONE (UI test only). */
export const BUILDER2_OFFLINE_PROGRESS_MS = 1500

/** Short progress estimate while offline placeholder job runs (not 30-minute production). */
export const BUILDER2_OFFLINE_ESTIMATED_TOTAL_SECONDS = 3

/** Minimal valid MP4 bytes (ftyp + empty mdat) — no network fetch. */
const MINIMAL_MP4_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, 0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74
])

/** @type {((ctx?: object) => boolean) | null} */
let preview2PlaceholderActiveCheck = null

/**
 * Register Preview2→Builder2 offline test placeholder resolver (avoids circular import at load).
 * @param {(ctx?: object) => boolean} fn
 */
export function registerPreview2PlaceholderActiveCheck(fn) {
  preview2PlaceholderActiveCheck = fn
}

/** @type {Map<string, object>} */
const offlineJobs = new Map()

/** @type {object|null} */
let offlineAllowance = null

/**
 * @param {Storage|null|undefined} sessionStorage
 */
export function readBuilder2OfflinePlaceholderFlag(sessionStorage = globalThis.sessionStorage) {
  if (!sessionStorage) return null
  const raw = String(sessionStorage.getItem(BUILDER2_OFFLINE_PLACEHOLDER_SESSION_KEY) ?? '').trim()
  if (raw === '1' || raw === '2') return Number(raw)
  return null
}

/**
 * @param {Storage|null|undefined} sessionStorage
 */
export function clearBuilder2OfflinePlaceholderFlag(sessionStorage = globalThis.sessionStorage) {
  try {
    sessionStorage?.removeItem(BUILDER2_OFFLINE_PLACEHOLDER_SESSION_KEY)
  } catch (_) {
    /* ignore */
  }
}

/**
 * @param {1|2} targetVideoCount
 * @param {Storage|null|undefined} sessionStorage
 */
export function enableBuilder2OfflinePlaceholderMode(targetVideoCount, sessionStorage = globalThis.sessionStorage) {
  const normalized = targetVideoCount === 2 ? 2 : 1
  sessionStorage?.setItem(BUILDER2_OFFLINE_PLACEHOLDER_SESSION_KEY, String(normalized))
  resetBuilder2OfflinePlaceholderRuntime()
  dispatchBuilder2OfflineTestStateChange({ targetVideoCount: normalized, armed: true })
  syncBuilder2OfflineTestConsoleState()
  return normalized
}

export function resetBuilder2OfflinePlaceholderRuntime() {
  offlineJobs.clear()
  offlineAllowance = null
}

/**
 * Offline mode is active ONLY when explicit flag exists AND browser reports offline.
 * @param {{ sessionStorage?: Storage, navigatorOnline?: boolean }} [ctx]
 */
export function isBuilder2OfflinePlaceholderModeActive(ctx = {}) {
  const sessionStorage = ctx.sessionStorage ?? globalThis.sessionStorage
  const flag = readBuilder2OfflinePlaceholderFlag(sessionStorage)
  if (flag == null) return false
  const online =
    ctx.navigatorOnline !== undefined
      ? ctx.navigatorOnline
      : typeof navigator !== 'undefined'
        ? navigator.onLine
        : true
  return !online
}

/**
 * Legacy Builder2 offline flag OR explicit Preview2→Builder2 offline test (when registered).
 * @param {{ sessionStorage?: Storage, navigatorOnline?: boolean, hash?: string, search?: string }} [ctx]
 */
export function isBuilder2OfflinePlaceholderTransportActive(ctx = {}) {
  if (isBuilder2OfflinePlaceholderModeActive(ctx)) return true
  return preview2PlaceholderActiveCheck?.(ctx) === true
}

/**
 * @param {{ sessionStorage?: Storage, navigatorOnline?: boolean }} [ctx]
 * @returns {1|2|null}
 */
export function resolveBuilder2OfflineTargetVideoCount(ctx = {}) {
  if (!isBuilder2OfflinePlaceholderModeActive(ctx)) return null
  const sessionStorage = ctx.sessionStorage ?? globalThis.sessionStorage
  return readBuilder2OfflinePlaceholderFlag(sessionStorage) ?? 1
}

/**
 * Armed test target (1|2) regardless of navigator.onLine — for runtime sync without reload.
 * @param {Storage|null|undefined} sessionStorage
 * @returns {1|2|null}
 */
export function readBuilder2OfflineArmedTargetVideoCount(sessionStorage = globalThis.sessionStorage) {
  return readBuilder2OfflinePlaceholderFlag(sessionStorage)
}

/**
 * @returns {boolean}
 */
export function isBuilder2OfflineTestArmedWhileOnline() {
  return readBuilder2OfflinePlaceholderFlag() != null && !isBuilder2OfflinePlaceholderModeActive()
}

/**
 * Notify mounted Builder2Page that test flag/runtime changed (no reload).
 * @param {object} [detail]
 */
export function dispatchBuilder2OfflineTestStateChange(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(BUILDER2_OFFLINE_TEST_STATE_EVENT, { detail }))
}

/**
 * Console-only state line for armed vs active offline test.
 */
export function syncBuilder2OfflineTestConsoleState() {
  if (typeof console === 'undefined' || !console.info) return
  const flag = readBuilder2OfflinePlaceholderFlag()
  if (flag == null) return
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true
  if (!online) {
    console.info(`[Builder2 offline test] ACTIVE targetVideoCount=${flag} network=offline`)
    return
  }
  console.info(
    `[Builder2 offline test] ARMED targetVideoCount=${flag} — switch DevTools Network to Offline. Do not reload. Then click GENERATE.`
  )
}

function placeholderVideoUrl(_videoIndex) {
  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const blob = new Blob([MINIMAL_MP4_BYTES], { type: 'video/mp4' })
    return URL.createObjectURL(blob)
  }
  const base64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(MINIMAL_MP4_BYTES).toString('base64')
      : btoa(String.fromCharCode(...MINIMAL_MP4_BYTES))
  return `data:video/mp4;base64,${base64}`
}

function parsePlaceholderVideoIndexFromUrl(videoUrl) {
  const match = String(videoUrl ?? '').match(/^offline-placeholder-video-(\d+):/)
  return match ? Number(match[1]) : null
}

function marketingTextForVideoIndex(videoIndex) {
  return videoIndex === 2 ? BUILDER2_PLACEHOLDER_MARKETING_TEXT_2 : BUILDER2_PLACEHOLDER_MARKETING_TEXT_1
}

function placeholderLabelForVideoIndex(videoIndex) {
  return videoIndex === 2 ? 'PLACEHOLDER VIDEO 2' : 'PLACEHOLDER VIDEO 1'
}

function mp4FilenameForVideoIndex(videoIndex) {
  return videoIndex === 2 ? 'placeholder-video-2.mp4' : 'placeholder-video-1.mp4'
}

function buildOfflineVideosArray() {
  if (!offlineAllowance) return []
  const entries = []
  for (const job of offlineJobs.values()) {
    if (job.status === 'done') {
      entries.push({
        videoIndex: job.videoIndex,
        jobId: job.jobId,
        status: 'done',
        finalVideoAvailable: true,
        videoUrl: job.videoUrl,
        marketingText: job.marketingText,
        isPlaceholder: true,
        placeholderLabel: job.placeholderLabel
      })
    }
  }
  return entries.sort((a, b) => a.videoIndex - b.videoIndex)
}

function buildOfflineProgressFields(job) {
  const startedAt = Number(job?.startedAt) || Date.now()
  const elapsedRaw = Math.max(0, (Date.now() - startedAt) / 1000)
  const isDone = job?.status === 'done'
  const elapsedSeconds = isDone
    ? BUILDER2_OFFLINE_ESTIMATED_TOTAL_SECONDS
    : Math.min(BUILDER2_OFFLINE_ESTIMATED_TOTAL_SECONDS - 0.05, elapsedRaw)
  return {
    estimatedTotalSeconds: BUILDER2_OFFLINE_ESTIMATED_TOTAL_SECONDS,
    estimated_total_seconds: BUILDER2_OFFLINE_ESTIMATED_TOTAL_SECONDS,
    elapsedSeconds,
    elapsed_seconds: elapsedSeconds,
    progressStage: isDone ? 'done' : 'runway_waiting',
    progress_stage: isDone ? 'done' : 'runway_waiting'
  }
}

function buildOfflineAllowanceStatus(job) {
  const videos = buildOfflineVideosArray()
  const generatedVideoCount = videos.length
  const targetVideoCount = offlineAllowance?.targetVideoCount ?? 1
  const remainingVideoCount = Math.max(0, targetVideoCount - generatedVideoCount)
  const canGenerateNext =
    targetVideoCount === 2 && generatedVideoCount === 1 && job?.status === 'done'
  const consumed =
    (targetVideoCount === 1 && generatedVideoCount >= 1) ||
    (targetVideoCount === 2 && generatedVideoCount >= 2)

  return {
    ok: true,
    status: job?.status ?? 'running',
    jobId: job?.jobId,
    videoAllowanceId: offlineAllowance?.videoAllowanceId,
    videoIndex: job?.videoIndex,
    targetVideoCount,
    generatedVideoCount,
    remainingVideoCount,
    canGenerateNext,
    consumed,
    videos,
    videoUrl: job?.videoUrl,
    marketingText: job?.marketingText,
    completed: job?.status === 'done',
    isPlaceholder: true,
    placeholderLabel: job?.placeholderLabel,
    ...buildOfflineProgressFields(job)
  }
}

/**
 * @param {{ productName?: string, productDescription?: string, targetVideoCount?: number }} params
 */
export async function offlineGenerateVideo(params = {}) {
  if (!isBuilder2OfflinePlaceholderTransportActive()) {
    return { ok: false, error: 'offline_mode_inactive' }
  }

  resetBuilder2OfflinePlaceholderRuntime()
  const targetVideoCount = params.targetVideoCount === 2 ? 2 : 1
  const videoAllowanceId = createBuilder1RequestId()
  const jobId = createBuilder1RequestId()
  const videoIndex = 1

  offlineAllowance = { videoAllowanceId, targetVideoCount }

  const job = {
    jobId,
    videoIndex,
    status: 'running',
    startedAt: Date.now(),
    videoUrl: null,
    marketingText: null,
    placeholderLabel: placeholderLabelForVideoIndex(videoIndex)
  }
  offlineJobs.set(jobId, job)

  await new Promise((resolve) => setTimeout(resolve, BUILDER2_OFFLINE_PROGRESS_MS))

  job.status = 'done'
  job.videoUrl = placeholderVideoUrl(videoIndex)
  job.marketingText = marketingTextForVideoIndex(videoIndex)

  return {
    ok: true,
    jobId,
    videoAllowanceId,
    targetVideoCount,
    videoIndex,
    status: 'done',
    ...buildOfflineAllowanceStatus(job)
  }
}

/**
 * @param {{ videoAllowanceId?: string }} params
 */
export async function offlineGenerateVideoNext(params = {}) {
  if (!isBuilder2OfflinePlaceholderTransportActive()) {
    return { ok: false, error: 'offline_mode_inactive' }
  }

  const allowanceId = String(params.videoAllowanceId ?? '').trim()
  if (!offlineAllowance || offlineAllowance.videoAllowanceId !== allowanceId) {
    return { ok: false, error: 'invalid_allowance' }
  }
  if (offlineAllowance.targetVideoCount !== 2) {
    return { ok: false, error: 'no_next_video' }
  }

  const existingDone = [...offlineJobs.values()].filter((j) => j.status === 'done')
  if (existingDone.length !== 1) {
    return { ok: false, error: 'video1_not_complete' }
  }

  const jobId = createBuilder1RequestId()
  const videoIndex = 2
  const job = {
    jobId,
    videoIndex,
    status: 'running',
    startedAt: Date.now(),
    videoUrl: null,
    marketingText: null,
    placeholderLabel: placeholderLabelForVideoIndex(videoIndex)
  }
  offlineJobs.set(jobId, job)

  await new Promise((resolve) => setTimeout(resolve, BUILDER2_OFFLINE_PROGRESS_MS))

  job.status = 'done'
  job.videoUrl = placeholderVideoUrl(videoIndex)
  job.marketingText = marketingTextForVideoIndex(videoIndex)

  return {
    ok: true,
    jobId,
    videoAllowanceId: offlineAllowance.videoAllowanceId,
    targetVideoCount: 2,
    videoIndex,
    status: 'done',
    ...buildOfflineAllowanceStatus(job)
  }
}

/**
 * @param {string} jobId
 */
export async function offlineFetchVideoStatus(jobId) {
  if (!isBuilder2OfflinePlaceholderTransportActive()) {
    return { status: 'error', error: 'offline_mode_inactive' }
  }

  const job = offlineJobs.get(String(jobId ?? '').trim())
  if (!job) {
    return { status: 'error', error: 'unknown_job' }
  }

  return buildOfflineAllowanceStatus(job)
}

/**
 * @param {{ jobId?: string }} params
 */
export async function offlineDownloadBuilder2Zip(params = {}) {
  if (!isBuilder2OfflinePlaceholderTransportActive()) {
    throw new Error('offline_mode_inactive')
  }

  const jobId = String(params.jobId ?? '').trim()
  const job = offlineJobs.get(jobId)
  if (!job || job.status !== 'done') {
    throw new Error('Video not ready')
  }

  const videoIndex = job.videoIndex
  const marketingText = marketingTextForVideoIndex(videoIndex)
  const zip = new JSZip()
  zip.file(mp4FilenameForVideoIndex(videoIndex), MINIMAL_MP4_BYTES)
  zip.file('marketing-text.txt', marketingText)
  const useNodeBuffer = typeof Buffer !== 'undefined' && typeof document === 'undefined'
  const blob = await zip.generateAsync({ type: useNodeBuffer ? 'nodebuffer' : 'blob' })
  return { blob, filename: `builder2-placeholder-video-${videoIndex}.zip` }
}

const BUILDER2_OFFLINE_TEST_USAGE_HINT =
  'Switch DevTools Network to Offline. Do not reload. Then click GENERATE.'

/** @deprecated Use syncBuilder2OfflineTestConsoleState — kept for test grep compatibility. */
export function logBuilder2OfflineTestMountState() {
  syncBuilder2OfflineTestConsoleState()
}

/**
 * @returns {boolean}
 */
export function isBuilder2OfflineTestFlagPendingActivation() {
  const flag = readBuilder2OfflinePlaceholderFlag()
  if (flag == null) return false
  return !isBuilder2OfflinePlaceholderModeActive()
}

/**
 * Register DevTools console helpers (safe — only set session flag, no auto-fake).
 */
export function registerBuilder2OfflineConsoleHelpers() {
  if (typeof window === 'undefined') return

  window.__builder2OfflineOneVideo = () => {
    enableBuilder2OfflinePlaceholderMode(1)
    console.info(`[Builder2 offline test] 1-video test armed. ${BUILDER2_OFFLINE_TEST_USAGE_HINT}`)
  }
  window.__builder2OfflineTwoVideos = () => {
    enableBuilder2OfflinePlaceholderMode(2)
    console.info(`[Builder2 offline test] 2-video test armed. ${BUILDER2_OFFLINE_TEST_USAGE_HINT}`)
  }
  window.__resetBuilder2OfflineTest = () => {
    clearBuilder2OfflinePlaceholderFlag()
    resetBuilder2OfflinePlaceholderRuntime()
    dispatchBuilder2OfflineTestStateChange({ cleared: true })
    console.info('[Builder2 offline test] Flag cleared and offline runtime reset.')
  }
}

/** Dev/test assertions for placeholder copy. */
export function assertBuilder2PlaceholderMarketingTexts() {
  const count1 = countMarketingWords(BUILDER2_PLACEHOLDER_MARKETING_TEXT_1)
  const count2 = countMarketingWords(BUILDER2_PLACEHOLDER_MARKETING_TEXT_2)
  if (count1 !== 50 || count2 !== 50) {
    throw new Error(`Placeholder word counts invalid: text1=${count1} text2=${count2}`)
  }
  if (BUILDER2_PLACEHOLDER_MARKETING_TEXT_1 === BUILDER2_PLACEHOLDER_MARKETING_TEXT_2) {
    throw new Error('Placeholder marketing texts must differ')
  }
}

export {
  mergeBuilder2AllowanceState,
  buildBuilder2CompletedVideoFromEntry,
  parsePlaceholderVideoIndexFromUrl,
  marketingTextForVideoIndex,
  mp4FilenameForVideoIndex,
  MINIMAL_MP4_BYTES
}
