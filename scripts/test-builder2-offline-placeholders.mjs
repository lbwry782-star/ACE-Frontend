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
  BUILDER2_OFFLINE_PLACEHOLDER_SESSION_KEY,
  BUILDER2_PLACEHOLDER_MARKETING_TEXT_1,
  BUILDER2_PLACEHOLDER_MARKETING_TEXT_2,
  enableBuilder2OfflinePlaceholderMode,
  clearBuilder2OfflinePlaceholderFlag,
  isBuilder2OfflinePlaceholderModeActive,
  resolveBuilder2OfflineTargetVideoCount,
  offlineGenerateVideo,
  offlineGenerateVideoNext,
  offlineFetchVideoStatus,
  offlineDownloadBuilder2Zip,
  assertBuilder2PlaceholderMarketingTexts,
  resetBuilder2OfflinePlaceholderRuntime,
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
assert.equal(isBuilder2OfflinePlaceholderModeActive(offlineCtx(true)), false)
assert.equal(resolveBuilder2OfflineTargetVideoCount(offlineCtx(true)), null)

globalThis.navigator.onLine = false

assert.equal(isBuilder2OfflinePlaceholderModeActive(offlineCtx(false)), true)
assert.equal(resolveBuilder2OfflineTargetVideoCount(offlineCtx(false)), 2)

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
const second = await offlineGenerateVideoNext({ videoAllowanceId: first.videoAllowanceId })
assert.equal(second.videoIndex, 2)
assert.equal(second.consumed, true)
assert.equal(second.canGenerateNext, false)

const status = await offlineFetchVideoStatus(second.jobId)
assert.equal(status.generatedVideoCount, 2)
assert.equal(status.videos.length, 2)
assert.equal(status.videos[0].videoIndex, 1)
assert.equal(status.videos[1].videoIndex, 2)

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
const { generateVideo, generateVideoNext, fetchVideoStatus, downloadBuilder2Zip } = await import(
  '../src/services/api.js'
)
enableBuilder2OfflinePlaceholderMode(2, session)
resetBuilder2OfflinePlaceholderRuntime()
const gen = await generateVideo({ productName: 'x', productDescription: 'y', targetVideoCount: 2 })
await generateVideoNext({ videoAllowanceId: gen.videoAllowanceId })
await fetchVideoStatus(gen.jobId)
await downloadBuilder2Zip({ jobId: gen.jobId })
assert.equal(fetchCalls, 0)

assert.match(apiSource, /isBuilder2OfflinePlaceholderModeActive/)
assert.match(builder2PageSource, /registerBuilder2OfflineConsoleHelpers/)
assert.match(offlineSource, /window\.__builder2OfflineOneVideo/)
assert.match(offlineSource, /window\.__builder2OfflineTwoVideos/)
assert.match(offlineSource, /window\.__resetBuilder2OfflineTest/)
assert.equal(BUILDER2_OFFLINE_PLACEHOLDER_SESSION_KEY, 'ace.builder2.offlinePlaceholders.v1')

clearBuilder2OfflinePlaceholderFlag(session)
resetBuilder2OfflinePlaceholderRuntime()
globalThis.fetch = originalFetch

console.log('test-builder2-offline-placeholders.mjs: passed')
