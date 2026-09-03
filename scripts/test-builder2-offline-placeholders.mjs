/**
 * Builder2 explicit offline placeholder mode tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { countMarketingWords } from '../src/utils/builder1Campaign.js'
import {
  getBuilder2GenerateButtonLabel
} from '../src/utils/builder2Allowance.js'
import {
  resolveBuilder2FinalVideoUrl,
  isBuilder2PlaceholderPlaybackUrl
} from '../src/utils/builder2Status.js'
import {
  BUILDER2_OFFLINE_PLACEHOLDER_SESSION_KEY,
  BUILDER2_OFFLINE_TEST_STATE_EVENT,
  BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE,
  BUILDER2_PLACEHOLDER_MARKETING_TEXT_1,
  BUILDER2_PLACEHOLDER_MARKETING_TEXT_2,
  BUILDER2_OFFLINE_ESTIMATED_TOTAL_SECONDS,
  enableBuilder2OfflinePlaceholderMode,
  clearBuilder2OfflinePlaceholderFlag,
  isBuilder2OfflinePlaceholderModeActive,
  isBuilder2OfflineTestFlagPendingActivation,
  isBuilder2OfflineTestArmedWhileOnline,
  readBuilder2OfflineArmedTargetVideoCount,
  dispatchBuilder2OfflineTestStateChange,
  resolveBuilder2OfflineTargetVideoCount,
  offlineGenerateVideo,
  offlineGenerateVideoNext,
  offlineFetchVideoStatus,
  offlineDownloadBuilder2Zip,
  assertBuilder2PlaceholderMarketingTexts,
  resetBuilder2OfflinePlaceholderRuntime,
  readBuilder2OfflinePlaceholderFlag,
  mp4FilenameForVideoIndex,
  marketingTextForVideoIndex
} from '../src/utils/builder2OfflinePlaceholders.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const apiSource = readFileSync(join(root, 'src/services/api.js'), 'utf8')
const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const offlineSource = readFileSync(join(root, 'src/utils/builder2OfflinePlaceholders.js'), 'utf8')

class MemoryStorage {
  constructor() {
    this.map = new Map()
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null
  }
  setItem(key, value) {
    this.map.set(key, String(value))
  }
  removeItem(key) {
    this.map.delete(key)
  }
}

Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
  writable: true
})

const session = new MemoryStorage()
globalThis.sessionStorage = session
globalThis.localStorage = new MemoryStorage()
let fetchCalls = 0

const originalFetch = globalThis.fetch
globalThis.fetch = (...args) => {
  fetchCalls += 1
  return originalFetch(...args)
}

function offlineCtx(online = false) {
  return { sessionStorage: session, navigatorOnline: online }
}

clearBuilder2OfflinePlaceholderFlag(session)
resetBuilder2OfflinePlaceholderRuntime()
assert.equal(isBuilder2OfflinePlaceholderModeActive(offlineCtx(false)), false)

enableBuilder2OfflinePlaceholderMode(2, session)
assert.equal(isBuilder2OfflineTestFlagPendingActivation(), true)
assert.equal(isBuilder2OfflinePlaceholderModeActive(offlineCtx(true)), false)
assert.equal(resolveBuilder2OfflineTargetVideoCount(offlineCtx(true)), null)

globalThis.navigator.onLine = false

assert.equal(isBuilder2OfflineTestFlagPendingActivation(), false)
assert.equal(isBuilder2OfflinePlaceholderModeActive(offlineCtx(false)), true)
assert.equal(resolveBuilder2OfflineTargetVideoCount(offlineCtx(false)), 2)
assert.equal(readBuilder2OfflineArmedTargetVideoCount(session), 2)

// Dynamic online → offline on same runtime (no remount/reload)
globalThis.navigator.onLine = true
assert.equal(isBuilder2OfflineTestArmedWhileOnline(), true)
assert.equal(isBuilder2OfflinePlaceholderModeActive(), false)
globalThis.navigator.onLine = false
assert.equal(isBuilder2OfflineTestArmedWhileOnline(), false)
assert.equal(isBuilder2OfflinePlaceholderModeActive(), true)
assert.equal(resolveBuilder2OfflineTargetVideoCount(), 2)

assertBuilder2PlaceholderMarketingTexts()
assert.equal(countMarketingWords(BUILDER2_PLACEHOLDER_MARKETING_TEXT_1), 50)
assert.equal(countMarketingWords(BUILDER2_PLACEHOLDER_MARKETING_TEXT_2), 50)
assert.notEqual(BUILDER2_PLACEHOLDER_MARKETING_TEXT_1, BUILDER2_PLACEHOLDER_MARKETING_TEXT_2)

enableBuilder2OfflinePlaceholderMode(1, session)
resetBuilder2OfflinePlaceholderRuntime()
fetchCalls = 0
const one = await offlineGenerateVideo({ targetVideoCount: 1 })
assert.ok(one.jobId)
assert.equal(one.videoIndex, 1)
assert.equal(one.targetVideoCount, 1)
assert.equal(one.consumed, true)
assert.equal(one.canGenerateNext, false)
assert.equal(getBuilder2GenerateButtonLabel({ consumed: true }), 'CONSUMED')

enableBuilder2OfflinePlaceholderMode(2, session)
resetBuilder2OfflinePlaceholderRuntime()
fetchCalls = 0
const first = await offlineGenerateVideo({ targetVideoCount: 2 })
assert.equal(first.canGenerateNext, true)
assert.equal(first.consumed, false)
assert.equal(first.estimatedTotalSeconds, BUILDER2_OFFLINE_ESTIMATED_TOTAL_SECONDS)
assert.equal(getBuilder2GenerateButtonLabel({ canGenerateNext: true }), 'GENERATE AGAIN')

const firstStatus = await offlineFetchVideoStatus(first.jobId)
assert.ok(isBuilder2PlaceholderPlaybackUrl(firstStatus.videoUrl))
assert.ok(resolveBuilder2FinalVideoUrl(firstStatus), 'blob placeholder URL must resolve (no 95% stall)')
assert.equal(firstStatus.isPlaceholder, true)

const second = await offlineGenerateVideoNext({ videoAllowanceId: first.videoAllowanceId })
assert.equal(second.videoIndex, 2)
assert.equal(second.consumed, true)
assert.equal(second.canGenerateNext, false)

const status = await offlineFetchVideoStatus(second.jobId)
assert.equal(status.generatedVideoCount, 2)
assert.equal(status.videos.length, 2)
assert.equal(status.videos[0].videoIndex, 1)
assert.equal(status.videos[1].videoIndex, 2)
assert.equal(getBuilder2GenerateButtonLabel({ consumed: true }), 'CONSUMED')

const oneDone = await offlineFetchVideoStatus(first.jobId)
const twoDone = await offlineFetchVideoStatus(second.jobId)
assert.ok(resolveBuilder2FinalVideoUrl(oneDone))
assert.ok(resolveBuilder2FinalVideoUrl(twoDone))
assert.notEqual(oneDone.placeholderLabel, twoDone.placeholderLabel)

const zip1 = await offlineDownloadBuilder2Zip({ jobId: first.jobId })
const zip1Archive = await JSZip.loadAsync(zip1.blob)
assert.ok(zip1Archive.file(mp4FilenameForVideoIndex(1)))
const zip1Text = await zip1Archive.file('marketing-text.txt').async('string')
assert.equal(zip1Text, marketingTextForVideoIndex(1))
assert.notEqual(zip1Text, marketingTextForVideoIndex(2))

const zip2 = await offlineDownloadBuilder2Zip({ jobId: second.jobId })
const zip2Archive = await JSZip.loadAsync(zip2.blob)
assert.ok(zip2Archive.file(mp4FilenameForVideoIndex(2)))
const zip2Text = await zip2Archive.file('marketing-text.txt').async('string')
assert.equal(zip2Text, marketingTextForVideoIndex(2))
assert.notEqual(zip2Text, marketingTextForVideoIndex(1))

fetchCalls = 0
globalThis.navigator.onLine = true
enableBuilder2OfflinePlaceholderMode(2, session)
const { generateVideo, generateVideoNext, fetchVideoStatus, downloadBuilder2Zip } = await import(
  '../src/services/api.js'
)
const blockedWhileOnline = await generateVideo({
  productName: 'x',
  productDescription: 'y',
  targetVideoCount: 2
})
assert.equal(blockedWhileOnline.ok, false)
assert.equal(blockedWhileOnline.error, 'offline_test_armed_online')
assert.equal(blockedWhileOnline.message, BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE)
assert.equal(fetchCalls, 0)

globalThis.navigator.onLine = false
resetBuilder2OfflinePlaceholderRuntime()
const gen = await generateVideo({ productName: 'x', productDescription: 'y', targetVideoCount: 2 })
assert.equal(gen.canGenerateNext, true)
const gen2 = await generateVideoNext({ videoAllowanceId: gen.videoAllowanceId })
assert.equal(gen2.videoIndex, 2)
assert.equal(gen2.consumed, true)
await fetchVideoStatus(gen.jobId)
await downloadBuilder2Zip({ jobId: gen.jobId })
await downloadBuilder2Zip({ jobId: gen2.jobId })
assert.equal(fetchCalls, 0)
assert.equal(getBuilder2GenerateButtonLabel({ consumed: true }), 'CONSUMED')

assert.match(apiSource, /isBuilder2OfflineTestArmedWhileOnline/)
assert.match(apiSource, /offline_test_armed_online/)
assert.match(builder2PageSource, /BUILDER2_OFFLINE_TEST_STATE_EVENT/)
assert.match(builder2PageSource, /addEventListener\('offline'/)
assert.match(builder2PageSource, /syncOfflineTestRuntime/)
assert.match(builder2PageSource, /BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE/)
assert.match(offlineSource, /BUILDER2_OFFLINE_TEST_STATE_EVENT/)
assert.match(offlineSource, /dispatchBuilder2OfflineTestStateChange/)
assert.match(offlineSource, /Do not reload/)
assert.doesNotMatch(offlineSource, /Reload Builder2/i)
assert.doesNotMatch(offlineSource, /then open \/builder2/i)
assert.match(offlineSource, /ACTIVE targetVideoCount=/)
assert.match(offlineSource, /ARMED targetVideoCount=/)
assert.match(offlineSource, /cleared: true/)
assert.equal(BUILDER2_OFFLINE_TEST_STATE_EVENT, 'ace:builder2-offline-test-state')
assert.match(offlineSource, /window\.__builder2OfflineOneVideo/)
assert.match(offlineSource, /window\.__builder2OfflineTwoVideos/)
assert.match(offlineSource, /window\.__resetBuilder2OfflineTest/)
assert.equal(BUILDER2_OFFLINE_PLACEHOLDER_SESSION_KEY, 'ace.builder2.offlinePlaceholders.v1')

clearBuilder2OfflinePlaceholderFlag(session)
resetBuilder2OfflinePlaceholderRuntime()
assert.equal(readBuilder2OfflinePlaceholderFlag(session), null)
assert.equal(isBuilder2OfflinePlaceholderModeActive(offlineCtx(false)), false)
globalThis.fetch = originalFetch

console.log('test-builder2-offline-placeholders.mjs: passed')
