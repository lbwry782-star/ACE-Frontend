/**
 * Preview2 → Builder2 explicit offline checkout handoff tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { getBuilder2GenerateButtonLabel } from '../src/utils/builder2Allowance.js'
import {
  startBuilder2Preview2Checkout,
  preview2TierKeyToTargetVideoCount,
  readBuilder2VideoCheckoutRecord
} from '../src/utils/builder2VideoCheckout.js'
import {
  enableBuilder2OfflinePlaceholderMode,
  clearBuilder2OfflinePlaceholderFlag,
  resetBuilder2OfflinePlaceholderRuntime,
  offlineGenerateVideo,
  offlineGenerateVideoNext,
  offlineDownloadBuilder2Zip,
  isBuilder2OfflinePlaceholderTransportActive,
  marketingTextForVideoIndex,
  mp4FilenameForVideoIndex
} from '../src/utils/builder2OfflinePlaceholders.js'
import {
  PREVIEW2_BUILDER2_OFFLINE_TEST_SESSION_KEY,
  PREVIEW2_BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE,
  PREVIEW2_BUILDER2_OFFLINE_TEST_STATE_EVENT,
  armPreview2Builder2OfflineTest,
  clearPreview2Builder2OfflineTest,
  readPreview2Builder2OfflineTestArmed,
  buildPreview2Builder2OfflineTestBuilder2Hash,
  markBuilder2VideoCheckoutPreview2OfflineTest,
  resolvePreview2Builder2OfflineTestCheckout,
  isPreview2Builder2OfflinePlaceholderActive,
  isPreview2Builder2OfflineTestArmedWhileOnline,
  isPreview2Builder2OfflineTestRoute,
  clearPreview2OfflineTestCheckoutRecords
} from '../src/utils/preview2Builder2OfflineTest.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const preview2Source = readFileSync(join(root, 'src/pages/Preview2/Preview2Page.jsx'), 'utf8')
const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const apiSource = readFileSync(join(root, 'src/services/api.js'), 'utf8')
const preview2TestSource = readFileSync(join(root, 'src/utils/preview2Builder2OfflineTest.js'), 'utf8')
const preview1Source = readFileSync(join(root, 'src/pages/Preview/PreviewPage.jsx'), 'utf8')

const PAYMENT_URL_2 =
  'https://app.icount.co.il/m/0a7c0/c6937615p17u6a98a23?utm_source=iCount&utm_medium=paypage&utm_campaign=23'
const PAYMENT_URL_1 =
  'https://app.icount.co.il/m/8ca25/c6937615p12u6a98a2e?utm_source=iCount&utm_medium=paypage&utm_campaign=18'

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
  key(index) {
    return [...this.map.keys()][index] ?? null
  }
  get length() {
    return this.map.size
  }
}

Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
  writable: true
})

const session = new MemoryStorage()
const local = new MemoryStorage()
globalThis.sessionStorage = session
globalThis.localStorage = local

function storages() {
  return { localStorage: local, sessionStorage: session }
}

function routeCtx(hash, search = '') {
  return { hash, search, navigatorOnline: globalThis.navigator.onLine }
}

clearPreview2Builder2OfflineTest(session)
clearBuilder2OfflinePlaceholderFlag(session)
resetBuilder2OfflinePlaceholderRuntime()
local.map.clear()
session.map.clear()

// 1. Helper only ARMS — does not choose 1/2
assert.match(preview2TestSource, /window\.__preview2Builder2OfflineTest/)
assert.match(preview2TestSource, /window\.__resetPreview2Builder2OfflineTest/)
assert.doesNotMatch(preview2TestSource, /targetVideoCount:\s*1/)
assert.doesNotMatch(preview2TestSource, /targetVideoCount:\s*2/)
assert.doesNotMatch(preview2TestSource, /enableBuilder2OfflinePlaceholderMode/)
armPreview2Builder2OfflineTest(session)
assert.equal(readPreview2Builder2OfflineTestArmed(session), true)
assert.equal(resolvePreview2Builder2OfflineTestCheckout({}, storages()).valid, false)

// 2–3. Real tier mapping persists targetVideoCount via production checkout path
armPreview2Builder2OfflineTest(session)
const tierOneCount = preview2TierKeyToTargetVideoCount('1')
const tierTwoCount = preview2TierKeyToTargetVideoCount('2')
assert.equal(tierOneCount, 1)
assert.equal(tierTwoCount, 2)

const checkoutOne = startBuilder2Preview2Checkout(tierOneCount, storages())
markBuilder2VideoCheckoutPreview2OfflineTest(checkoutOne.checkoutId, local)
assert.equal(readBuilder2VideoCheckoutRecord(checkoutOne.checkoutId, local)?.targetVideoCount, 1)

session.map.clear()
armPreview2Builder2OfflineTest(session)
const checkoutTwo = startBuilder2Preview2Checkout(tierTwoCount, storages())
markBuilder2VideoCheckoutPreview2OfflineTest(checkoutTwo.checkoutId, local)
assert.equal(readBuilder2VideoCheckoutRecord(checkoutTwo.checkoutId, local)?.targetVideoCount, 2)

// 4–5. Builder2 reads targetVideoCount from persisted checkout — no separate test mapping
const hashOne = buildPreview2Builder2OfflineTestBuilder2Hash(checkoutOne.checkoutId)
const hashTwo = buildPreview2Builder2OfflineTestBuilder2Hash(checkoutTwo.checkoutId)
assert.ok(isPreview2Builder2OfflineTestRoute('', hashOne))

armPreview2Builder2OfflineTest(session)
session.setItem('ace.builder2.activeVideoCheckout.v1', checkoutOne.checkoutId)
const resolvedOne = resolvePreview2Builder2OfflineTestCheckout({ hash: hashOne }, storages())
assert.equal(resolvedOne.valid, true)
assert.equal(resolvedOne.targetVideoCount, 1)
assert.equal(resolvedOne.checkoutId, checkoutOne.checkoutId)

armPreview2Builder2OfflineTest(session)
session.setItem('ace.builder2.activeVideoCheckout.v1', checkoutTwo.checkoutId)
const resolvedTwo = resolvePreview2Builder2OfflineTestCheckout({ hash: hashTwo }, storages())
assert.equal(resolvedTwo.valid, true)
assert.equal(resolvedTwo.targetVideoCount, 2)

assert.doesNotMatch(preview2TestSource, /__builder2OfflineOneVideo/)
assert.doesNotMatch(preview2TestSource, /__builder2OfflineTwoVideos/)

// 6–7. Preview2 source: test mode skips iCount; normal mode keeps exact URLs
assert.match(preview2Source, /readPreview2Builder2OfflineTestArmed/)
assert.match(preview2Source, /buildPreview2Builder2OfflineTestBuilder2Hash/)
assert.match(preview2Source, /startBuilder2Preview2Checkout/)
assert.match(
  preview2Source,
  /readPreview2Builder2OfflineTestArmed\(\)[\s\S]*?buildPreview2Builder2OfflineTestBuilder2Hash[\s\S]*?return[\s\S]*?const url = PREVIEW2_PAYMENT_URLS/
)
assert.match(preview2Source, new RegExp(`'1': '${PAYMENT_URL_1.replace(/\?/g, '\\?')}'`))
assert.match(preview2Source, new RegExp(`'2': '${PAYMENT_URL_2.replace(/\?/g, '\\?')}'`))
assert.match(preview2Source, /window\.location\.href = url/)

// 8. Test navigation hash reaches Builder2 while still online
assert.match(hashOne, /#\/builder2\?/)
assert.match(hashOne, /preview2Test=1/)
assert.match(hashOne, /checkoutId=/)
globalThis.navigator.onLine = true
armPreview2Builder2OfflineTest(session)
session.setItem('ace.builder2.activeVideoCheckout.v1', checkoutOne.checkoutId)
assert.equal(isPreview2Builder2OfflineTestArmedWhileOnline({ hash: hashOne }, storages()), true)
assert.equal(isPreview2Builder2OfflinePlaceholderActive({ hash: hashOne }, storages()), false)

// 9. Armed-online Builder2 cannot call real generation
let fetchCalls = 0
const originalFetch = globalThis.fetch
globalThis.fetch = (...args) => {
  fetchCalls += 1
  return originalFetch(...args)
}

const { generateVideo, generateVideoNext, fetchVideoStatus, downloadBuilder2Zip } = await import(
  '../src/services/api.js'
)

armPreview2Builder2OfflineTest(session)
session.setItem('ace.builder2.activeVideoCheckout.v1', checkoutOne.checkoutId)
const blockedPreview2Online = await generateVideo({
  productName: 'x',
  productDescription: 'y',
  targetVideoCount: 1
})
assert.equal(blockedPreview2Online.ok, false)
assert.equal(blockedPreview2Online.error, 'preview2_test_armed_online')
assert.equal(blockedPreview2Online.message, PREVIEW2_BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE)
assert.equal(fetchCalls, 0)

// 10. Online → Offline activates placeholder without reload
globalThis.navigator.onLine = false
assert.equal(isPreview2Builder2OfflinePlaceholderActive({ hash: hashOne }, storages()), true)
assert.equal(isBuilder2OfflinePlaceholderTransportActive({ hash: hashOne }), true)
assert.equal(isPreview2Builder2OfflineTestArmedWhileOnline({ hash: hashOne }, storages()), false)

// 11. target=1 lifecycle
resetBuilder2OfflinePlaceholderRuntime()
fetchCalls = 0
armPreview2Builder2OfflineTest(session)
session.setItem('ace.builder2.activeVideoCheckout.v1', checkoutOne.checkoutId)
const oneVideo = await generateVideo({
  productName: 'Product',
  productDescription: 'Desc',
  targetVideoCount: resolvedOne.targetVideoCount
})
assert.equal(oneVideo.targetVideoCount, 1)
assert.equal(oneVideo.consumed, true)
assert.equal(oneVideo.canGenerateNext, false)
assert.equal(getBuilder2GenerateButtonLabel({ consumed: true }), 'CONSUMED')
assert.equal(fetchCalls, 0)

// 12–13. target=2 lifecycle — video #2 below zip #1
resetBuilder2OfflinePlaceholderRuntime()
fetchCalls = 0
armPreview2Builder2OfflineTest(session)
session.setItem('ace.builder2.activeVideoCheckout.v1', checkoutTwo.checkoutId)
const firstTwo = await generateVideo({
  productName: 'Product',
  productDescription: 'Desc',
  targetVideoCount: resolvedTwo.targetVideoCount
})
assert.equal(firstTwo.targetVideoCount, 2)
assert.equal(firstTwo.canGenerateNext, true)
assert.equal(firstTwo.consumed, false)
assert.equal(getBuilder2GenerateButtonLabel({ canGenerateNext: true }), 'GENERATE AGAIN')

const secondTwo = await generateVideoNext({ videoAllowanceId: firstTwo.videoAllowanceId })
assert.equal(secondTwo.videoIndex, 2)
assert.equal(secondTwo.consumed, true)
assert.equal(secondTwo.videos.length, 2)
assert.equal(secondTwo.videos[0].videoIndex, 1)
assert.equal(secondTwo.videos[1].videoIndex, 2)

// 14. Offline Builder2 API calls = 0 (already asserted via fetchCalls)

// 15. iCount — Preview2 test path uses hash navigation, not payment URL (source-level)
assert.match(preview2Source, /window\.location\.hash = buildPreview2Builder2OfflineTestBuilder2Hash/)

// 16–17. Local ZIP #1 and #2
const zip1 = await downloadBuilder2Zip({ jobId: firstTwo.jobId })
const zip1Archive = await JSZip.loadAsync(zip1.blob)
assert.ok(zip1Archive.file(mp4FilenameForVideoIndex(1)))
const zip1Text = await zip1Archive.file('marketing-text.txt').async('string')
assert.equal(zip1Text, marketingTextForVideoIndex(1))

const zip2 = await downloadBuilder2Zip({ jobId: secondTwo.jobId })
const zip2Archive = await JSZip.loadAsync(zip2.blob)
assert.ok(zip2Archive.file(mp4FilenameForVideoIndex(2)))
const zip2Text = await zip2Archive.file('marketing-text.txt').async('string')
assert.equal(zip2Text, marketingTextForVideoIndex(2))
assert.equal(fetchCalls, 0)

// 18. Reset restores normal behavior
clearPreview2Builder2OfflineTest(session)
clearBuilder2OfflinePlaceholderFlag(session)
resetBuilder2OfflinePlaceholderRuntime()
clearPreview2OfflineTestCheckoutRecords(storages())
assert.equal(readPreview2Builder2OfflineTestArmed(session), false)
assert.equal(isPreview2Builder2OfflinePlaceholderActive({ hash: hashOne }, storages()), false)

globalThis.navigator.onLine = true
fetchCalls = 0
const afterReset = await generateVideo({
  productName: 'x',
  productDescription: 'y',
  targetVideoCount: 1
})
assert.notEqual(afterReset.error, 'preview2_test_armed_online')

// 19. Existing Builder2 offline helpers unchanged
enableBuilder2OfflinePlaceholderMode(1, session)
globalThis.navigator.onLine = false
resetBuilder2OfflinePlaceholderRuntime()
const legacyOne = await offlineGenerateVideo({ targetVideoCount: 1 })
assert.equal(legacyOne.consumed, true)

enableBuilder2OfflinePlaceholderMode(2, session)
resetBuilder2OfflinePlaceholderRuntime()
const legacyFirst = await offlineGenerateVideo({ targetVideoCount: 2 })
const legacySecond = await offlineGenerateVideoNext({ videoAllowanceId: legacyFirst.videoAllowanceId })
assert.equal(legacySecond.videoIndex, 2)

// 20. Preview1 unchanged
assert.doesNotMatch(preview1Source, /preview2Builder2OfflineTest/)
assert.doesNotMatch(preview1Source, /__preview2Builder2OfflineTest/)

// Builder2 wiring
assert.match(builder2PageSource, /resolvePreview2Builder2OfflineTestCheckout/)
assert.match(builder2PageSource, /PREVIEW2_BUILDER2_OFFLINE_TEST_ARMED_ONLINE_MESSAGE/)
assert.match(builder2PageSource, /syncPreview2Builder2OfflineTestConsoleState/)
assert.match(builder2PageSource, /preview2Checkout\.valid/)
assert.match(builder2PageSource, /preview2Checkout\.targetVideoCount/)
assert.match(apiSource, /isPreview2Builder2OfflineTestArmedWhileOnline/)
assert.match(apiSource, /preview2_test_armed_online/)
assert.match(apiSource, /isBuilder2OfflinePlaceholderTransportActive/)
assert.match(preview2TestSource, /\[Preview2→Builder2 test\] checkoutId=/)
assert.equal(PREVIEW2_BUILDER2_OFFLINE_TEST_SESSION_KEY, 'ace.preview2.builder2.offlineTest.v1')
assert.equal(PREVIEW2_BUILDER2_OFFLINE_TEST_STATE_EVENT, 'ace:preview2-builder2-offline-test-state')

clearBuilder2OfflinePlaceholderFlag(session)
clearPreview2Builder2OfflineTest(session)
resetBuilder2OfflinePlaceholderRuntime()
globalThis.fetch = originalFetch

console.log('test-preview2-builder2-offline-checkout.mjs: passed')
