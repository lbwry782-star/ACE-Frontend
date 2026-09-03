/**
 * Preview1 → Builder1 explicit offline checkout handoff tests.
 * Run: npm run test:builder1
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { createBuilder1RequestId } from '../src/utils/builder1RequestId.js'
import {
  PREVIEW1_TIER_AD_COUNTS,
  preview1TierKeyToAdCount,
  getBuilder1GenerateButtonLabel
} from '../src/utils/builder1CampaignCount.js'
import {
  startBuilder1Preview1Checkout,
  readBuilder1CheckoutRecord,
  resolveBuilder1CheckoutAdCount
} from '../src/utils/builder1Checkout.js'
import {
  validateInitialCampaignResponse,
  validateNextAdResponse,
  createCampaignSessionFromInitial,
  appendAdToSession
} from '../src/utils/builder1Campaign.js'
import { isBuilder1CampaignAuthoritativelyReady } from '../src/utils/builder1Status.js'
import {
  BUILDER1_OFFLINE_PLACEHOLDER_PROGRESS_MS,
  isBuilder1OfflinePlaceholderTransportActive,
  resetBuilder1OfflinePlaceholderRuntime,
  offlineBuilder1Generate,
  offlineBuilder1GenerateNext,
  offlineBuilder1FetchStatus,
  offlineBuilder1DownloadZip,
  assertBuilder1PlaceholderMarketingTexts
} from '../src/utils/builder1OfflinePlaceholders.js'
import {
  PREVIEW1_BUILDER1_OFFLINE_TEST_SESSION_KEY,
  PREVIEW1_BUILDER1_OFFLINE_TEST_ARMED_ONLINE_MESSAGE,
  PREVIEW1_BUILDER1_OFFLINE_TEST_STATE_EVENT,
  armPreview1Builder1OfflineTest,
  clearPreview1Builder1OfflineTest,
  readPreview1Builder1OfflineTestArmed,
  buildPreview1Builder1OfflineTestBuilderHash,
  markBuilder1CheckoutPreview1OfflineTest,
  resolvePreview1Builder1OfflineTestCheckout,
  isPreview1Builder1OfflinePlaceholderActive,
  isPreview1Builder1OfflineTestArmedWhileOnline,
  clearPreview1OfflineTestCheckoutRecords
} from '../src/utils/preview1Builder1OfflineTest.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const previewSource = readFileSync(join(root, 'src/pages/Preview/PreviewPage.jsx'), 'utf8')
const builderPageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const builder1ApiSource = readFileSync(join(root, 'src/services/builder1Api.js'), 'utf8')
const preview1TestSource = readFileSync(join(root, 'src/utils/preview1Builder1OfflineTest.js'), 'utf8')
const preview2Source = readFileSync(join(root, 'src/pages/Preview2/Preview2Page.jsx'), 'utf8')
const builder2TestSource = readFileSync(join(root, 'src/utils/preview2Builder2OfflineTest.js'), 'utf8')

const PAYMENT_URLS = {
  '1': 'https://app.icount.co.il/m/78df1',
  '2': 'https://app.icount.co.il/m/477e6',
  '5': 'https://app.icount.co.il/m/f7c25'
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function routeCtx(hash, search = '') {
  return { hash, search }
}

clearPreview1Builder1OfflineTest(session)
resetBuilder1OfflinePlaceholderRuntime()
local.map.clear()
session.map.clear()

// 1–2. Helper only arms — does not choose adCount
assert.match(preview1TestSource, /window\.__preview1Builder1OfflineTest/)
assert.match(preview1TestSource, /window\.__resetPreview1Builder1OfflineTest/)
assert.doesNotMatch(preview1TestSource, /startBuilder1Preview1Checkout\(/)
assert.doesNotMatch(preview1TestSource, /adCount:\s*[234]/)
armPreview1Builder1OfflineTest(session)
assert.equal(readPreview1Builder1OfflineTestArmed(session), true)
assert.equal(resolvePreview1Builder1OfflineTestCheckout({}, storages()).valid, false)

// 3–4. Each real Preview1 tier uses production mapping + checkout persistence
assert.deepEqual(PREVIEW1_TIER_AD_COUNTS, { '1': 2, '2': 3, '5': 4 })
for (const [tierKey, expectedAdCount] of Object.entries(PREVIEW1_TIER_AD_COUNTS)) {
  assert.equal(preview1TierKeyToAdCount(tierKey), expectedAdCount)
  armPreview1Builder1OfflineTest(session)
  const checkout = startBuilder1Preview1Checkout(preview1TierKeyToAdCount(tierKey), storages())
  markBuilder1CheckoutPreview1OfflineTest(checkout.checkoutId, local)
  assert.equal(readBuilder1CheckoutRecord(checkout.checkoutId, local)?.adCount, expectedAdCount)
  assert.notEqual(checkout.checkoutId, '')
}

// 5–6. checkoutId unique + immutable adCount
const ids = new Set()
for (const tierKey of Object.keys(PREVIEW1_TIER_AD_COUNTS)) {
  const c = startBuilder1Preview1Checkout(preview1TierKeyToAdCount(tierKey), storages())
  assert.ok(!ids.has(c.checkoutId))
  ids.add(c.checkoutId)
  const record = readBuilder1CheckoutRecord(c.checkoutId, local)
  assert.equal(record.adCount, preview1TierKeyToAdCount(tierKey))
}

// 7–8. Builder1 reads adCount from persisted checkout — no test-only offer mapping
const checkoutTwo = startBuilder1Preview1Checkout(2, storages())
const hashTwo = buildPreview1Builder1OfflineTestBuilderHash(checkoutTwo.checkoutId)
armPreview1Builder1OfflineTest(session)
session.setItem('ace.builder1.activeCheckout.v1', checkoutTwo.checkoutId)
const resolvedTwo = resolvePreview1Builder1OfflineTestCheckout({ hash: hashTwo }, storages())
assert.equal(resolvedTwo.valid, true)
assert.equal(resolvedTwo.adCount, 2)
assert.doesNotMatch(preview1TestSource, /if \(tierKey === '1'\)/)
assert.doesNotMatch(preview1TestSource, /PREVIEW1_TIER_AD_COUNTS\['1'\].*startBuilder1Preview1Checkout/s)

// 9–10. Test skips iCount after checkout; normal mode keeps exact URLs
assert.match(
  previewSource,
  /readPreview1Builder1OfflineTestArmed\(\)[\s\S]*?buildPreview1Builder1OfflineTestBuilderHash[\s\S]*?return[\s\S]*?const url = PREVIEW1_PAYMENT_URLS/
)
assert.match(previewSource, /startBuilder1Preview1Checkout/)
for (const [key, url] of Object.entries(PAYMENT_URLS)) {
  assert.match(previewSource, new RegExp(`'${key}': '${url.replace(/\//g, '\\/')}'`))
}
assert.match(previewSource, /window\.location\.href = url/)

// 11. Armed-online blocks real generation
let fetchCalls = 0
const originalFetch = globalThis.fetch
globalThis.fetch = (...args) => {
  fetchCalls += 1
  return originalFetch(...args)
}

const { builder1Generate, builder1GenerateNext, builder1FetchStatus, builder1DownloadZip } =
  await import('../src/services/builder1Api.js')

armPreview1Builder1OfflineTest(session)
session.setItem('ace.builder1.activeCheckout.v1', checkoutTwo.checkoutId)
globalThis.navigator.onLine = true
const blocked = await builder1Generate(
  { adCount: 2, format: 'portrait', productName: 'x', productDescription: 'y' },
  { requestId: createBuilder1RequestId() }
)
assert.equal(blocked.payload.error, 'preview1_test_armed_online')
assert.equal(blocked.payload.message, PREVIEW1_BUILDER1_OFFLINE_TEST_ARMED_ONLINE_MESSAGE)
assert.equal(fetchCalls, 0)

// 12. Online → Offline activates placeholder without reload
globalThis.navigator.onLine = false
assert.equal(isPreview1Builder1OfflinePlaceholderActive({ hash: hashTwo }, storages()), true)
assert.equal(isBuilder1OfflinePlaceholderTransportActive({ hash: hashTwo }), true)

// 13. Ordinary offline without explicit test does NOT fake success
clearPreview1Builder1OfflineTest(session)
globalThis.navigator.onLine = false
assert.equal(isBuilder1OfflinePlaceholderTransportActive(), false)

armPreview1Builder1OfflineTest(session)
session.setItem('ace.builder1.activeCheckout.v1', checkoutTwo.checkoutId)

assertBuilder1PlaceholderMarketingTexts()

async function runOfflineCampaignLifecycle(adCount) {
  resetBuilder1OfflinePlaceholderRuntime()
  globalThis.navigator.onLine = false
  armPreview1Builder1OfflineTest(session)
  const checkout = startBuilder1Preview1Checkout(adCount, storages())
  markBuilder1CheckoutPreview1OfflineTest(checkout.checkoutId, local)
  session.setItem('ace.builder1.activeCheckout.v1', checkout.checkoutId)

  const initialMutation = await builder1Generate(
    {
      adCount,
      format: 'portrait',
      productName: 'Placeholder Product',
      productDescription: 'Placeholder description for offline test.'
    },
    { requestId: createBuilder1RequestId() }
  )
  assert.equal(initialMutation.response.status, 202)
  assert.ok(initialMutation.payload.jobId)

  await sleep(BUILDER1_OFFLINE_PLACEHOLDER_PROGRESS_MS + 50)
  const initialStatus = await builder1FetchStatus(initialMutation.payload.jobId)
  assert.equal(initialStatus.payload.status, 'done')
  const validatedInitial = validateInitialCampaignResponse(initialStatus.payload.result, adCount)
  assert.equal(validatedInitial.ok, true)
  assert.equal(validatedInitial.ad.index, 1)
  assert.equal(validatedInitial.ad.headline, 'PLACEHOLDER AD 1')

  let sessionState = createCampaignSessionFromInitial(validatedInitial, adCount).session
  assert.equal(sessionState.targetAdCount, adCount)
  assert.equal(validatedInitial.campaign.adCount, adCount)
  assert.equal(sessionState.canGenerateNext, adCount > 1)
  assert.equal(isBuilder1CampaignAuthoritativelyReady(sessionState), adCount === 1)

  for (let nextIndex = 2; nextIndex <= adCount; nextIndex += 1) {
    assert.equal(getBuilder1GenerateButtonLabel({
      hasGeneratedAds: true,
      canGenerateNext: sessionState.canGenerateNext,
      campaignComplete: isBuilder1CampaignAuthoritativelyReady(sessionState)
    }), nextIndex < adCount || adCount === 1 ? 'GENERATE AGAIN' : 'GENERATE AGAIN')

    const nextMutation = await builder1GenerateNext(
      { campaignId: sessionState.campaignId, expectedNextIndex: nextIndex },
      { requestId: createBuilder1RequestId() }
    )
    assert.equal(nextMutation.response.status, 202)
    await sleep(BUILDER1_OFFLINE_PLACEHOLDER_PROGRESS_MS + 50)
    const nextStatus = await builder1FetchStatus(nextMutation.payload.jobId)
    const validatedNext = validateNextAdResponse(nextStatus.payload.result, {
      campaignId: sessionState.campaignId,
      expectedIndex: nextIndex
    })
    assert.equal(validatedNext.ok, true)
    assert.equal(validatedNext.ad.headline, `PLACEHOLDER AD ${nextIndex}`)
    const appended = appendAdToSession(sessionState, validatedNext)
    if (!appended.ok) {
      throw new Error(
        `appendAdToSession failed for ad ${nextIndex}: ${appended.message || appended.error || 'unknown'}`
      )
    }
    sessionState = appended.session
    assert.equal(sessionState.ads.length, nextIndex)
  }

  assert.equal(isBuilder1CampaignAuthoritativelyReady(sessionState), true)
  assert.equal(sessionState.canGenerateNext, false)
  assert.equal(getBuilder1GenerateButtonLabel({
    hasGeneratedAds: true,
    canGenerateNext: false,
    campaignComplete: true
  }), 'CONSUMED')

  return sessionState
}

// 14–17. target N lifecycle for 2, 3, 4 ads
fetchCalls = 0
const sessionTwo = await runOfflineCampaignLifecycle(2)
assert.equal(sessionTwo.ads.length, 2)
assert.equal(sessionTwo.ads[0].index, 1)
assert.equal(sessionTwo.ads[1].index, 2)

resetBuilder1OfflinePlaceholderRuntime()
fetchCalls = 0
armPreview1Builder1OfflineTest(session)
const sessionThree = await runOfflineCampaignLifecycle(3)
assert.equal(sessionThree.ads.length, 3)

resetBuilder1OfflinePlaceholderRuntime()
fetchCalls = 0
armPreview1Builder1OfflineTest(session)
const sessionFour = await runOfflineCampaignLifecycle(4)
assert.equal(sessionFour.ads.length, 4)

// 18. Prior ads remain visible (stacked session.ads)
assert.equal(sessionFour.ads.map((ad) => ad.index).join(','), '1,2,3,4')

// 19–20. Zero API + iCount
assert.equal(fetchCalls, 0)
assert.match(previewSource, /window\.location\.hash = buildPreview1Builder1OfflineTestBuilderHash/)

// 21. Placeholder ZIP works locally
armPreview1Builder1OfflineTest(session)
globalThis.navigator.onLine = false
session.setItem('ace.builder1.activeCheckout.v1', checkoutTwo.checkoutId)
const zipResponse = await builder1DownloadZip({
  scope: 'single_ad',
  campaignId: checkoutTwo.checkoutId,
  ad: { index: 1, headline: 'PLACEHOLDER AD 1', marketingText: 'x' }
})
const zipBytes = Buffer.from(await zipResponse.arrayBuffer())
const zipArchive = await JSZip.loadAsync(zipBytes)
assert.ok(zipArchive.file('placeholder-ad-1.png'))
assert.ok(zipArchive.file('marketing-text.txt'))

// 22. Reset restores normal behavior
clearPreview1Builder1OfflineTest(session)
resetBuilder1OfflinePlaceholderRuntime()
clearPreview1OfflineTestCheckoutRecords(storages())
assert.equal(readPreview1Builder1OfflineTestArmed(session), false)
assert.equal(isPreview1Builder1OfflinePlaceholderActive({ hash: hashTwo }, storages()), false)

// 23. Multi-tab isolation script still in test suite (package.json)
assert.match(readFileSync(join(root, 'package.json'), 'utf8'), /test-builder1-checkout-isolation/)

// 24. Builder2 / Preview2 untouched
assert.doesNotMatch(preview2Source, /preview1Builder1OfflineTest/)
assert.doesNotMatch(builder2TestSource, /preview1Builder1OfflineTest/)

// Wiring assertions
assert.match(builderPageSource, /resolvePreview1Builder1OfflineTestCheckout/)
assert.match(builderPageSource, /PREVIEW1_BUILDER1_OFFLINE_TEST_ARMED_ONLINE_MESSAGE/)
assert.match(builder1ApiSource, /isPreview1Builder1OfflineTestArmedWhileOnline/)
assert.match(builder1ApiSource, /offlineBuilder1Generate/)
assert.match(preview1TestSource, /\[Preview1→Builder1 test\] checkoutId=/)
assert.equal(PREVIEW1_BUILDER1_OFFLINE_TEST_SESSION_KEY, 'ace.preview1.builder1.offlineTest.v1')
assert.equal(PREVIEW1_BUILDER1_OFFLINE_TEST_STATE_EVENT, 'ace:preview1-builder1-offline-test-state')

globalThis.fetch = originalFetch

console.log('test-preview1-builder1-offline-checkout.mjs: passed')
