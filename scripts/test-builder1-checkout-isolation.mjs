/**
 * Builder1 checkout-scoped ad-count multi-tab isolation tests.
 * Run: npm run test:builder1
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER1_ACTIVE_CHECKOUT_SESSION_KEY,
  BUILDER1_CHECKOUT_QUERY_PARAM,
  BUILDER1_CHECKOUT_RECORD_KEY_PREFIX,
  startBuilder1Preview1Checkout,
  readActiveBuilder1CheckoutId,
  readBuilder1CheckoutRecord,
  readBuilder1CheckoutIdFromRoute,
  resolveBuilder1CheckoutAdCount,
  buildBuilder1PaymentReturnHash,
  isValidBuilder1CheckoutId
} from '../src/utils/builder1Checkout.js'
import { resolveBuilder1InitialAdCount } from '../src/utils/builder1CampaignCount.js'
import { BUILDER1_CAMPAIGN_AD_COUNT_KEY } from '../src/utils/builder1CampaignCount.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const previewSource = readFileSync(join(root, 'src/pages/Preview/PreviewPage.jsx'), 'utf8')
const appSource = readFileSync(join(root, 'src/App.jsx'), 'utf8')
const builderPageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const builder2PreviewSource = readFileSync(join(root, 'src/pages/Preview2/Preview2Page.jsx'), 'utf8')
const pkg = readFileSync(join(root, 'package.json'), 'utf8')

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

const sharedLocal = new MemoryStorage()
const tabASession = new MemoryStorage()
const tabBSession = new MemoryStorage()

function tabStorages(session) {
  return { localStorage: sharedLocal, sessionStorage: session }
}

// 1–2. checkout A=2, checkout B=4 isolated (A then B order)
sharedLocal.map.clear()
tabASession.map.clear()
tabBSession.map.clear()

const checkoutA = startBuilder1Preview1Checkout(2, tabStorages(tabASession))
const checkoutB = startBuilder1Preview1Checkout(4, tabStorages(tabBSession))
assert.notEqual(checkoutA.checkoutId, checkoutB.checkoutId)

const resolvedBFirst = resolveBuilder1CheckoutAdCount(
  { checkoutId: checkoutB.checkoutId },
  tabStorages(tabBSession)
)
const resolvedAFirst = resolveBuilder1CheckoutAdCount(
  { checkoutId: checkoutA.checkoutId },
  tabStorages(tabASession)
)
assert.equal(resolvedBFirst.adCount, 4)
assert.equal(resolvedAFirst.adCount, 2)

// 3. same localStorage, different sessionStorage tabs
assert.equal(readBuilder1CheckoutRecord(checkoutA.checkoutId, sharedLocal)?.adCount, 2)
assert.equal(readBuilder1CheckoutRecord(checkoutB.checkoutId, sharedLocal)?.adCount, 4)

// 4. later global legacy write cannot alter active checkout tab resolution
sharedLocal.setItem(BUILDER1_CAMPAIGN_AD_COUNT_KEY, '4')
const stillA = resolveBuilder1CheckoutAdCount(
  { checkoutId: checkoutA.checkoutId },
  tabStorages(tabASession)
)
assert.equal(stillA.adCount, 2)
assert.equal(stillA.source, 'url-checkout')

// 5. payment return hash carries checkoutId
tabASession.setItem(BUILDER1_ACTIVE_CHECKOUT_SESSION_KEY, checkoutA.checkoutId)
assert.match(buildBuilder1PaymentReturnHash(tabASession), new RegExp(`checkoutId=${checkoutA.checkoutId}`))

// 6. URL checkoutId precedence over unrelated global legacy value
sharedLocal.setItem(BUILDER1_CAMPAIGN_AD_COUNT_KEY, '4')
const fromUrl = resolveBuilder1CheckoutAdCount(
  {
    hash: `#/builder?fromPayment=1&checkoutId=${checkoutA.checkoutId}`
  },
  tabStorages(tabBSession)
)
assert.equal(fromUrl.adCount, 2)
assert.equal(fromUrl.source, 'url-checkout')

// 7. invalid checkoutId does not silently select another checkout
const missingId = '00000000-0000-4000-8000-000000000000'
const invalid = resolveBuilder1CheckoutAdCount({ checkoutId: missingId }, tabStorages(tabASession))
assert.equal(invalid.adCount, 2)
assert.equal(invalid.source, 'missing-checkout-record')
assert.equal(invalid.checkoutId, missingId)

// 8–9. invalid stored adCount in record fails read; allowed values remain 2/3/4
sharedLocal.setItem(
  `${BUILDER1_CHECKOUT_RECORD_KEY_PREFIX}${missingId}`,
  JSON.stringify({ version: 1, checkoutId: missingId, adCount: 99, createdAt: Date.now() })
)
assert.equal(readBuilder1CheckoutRecord(missingId, sharedLocal), null)

for (const count of [2, 3, 4]) {
  const { checkoutId } = startBuilder1Preview1Checkout(count, tabStorages(tabASession))
  assert.equal(readBuilder1CheckoutRecord(checkoutId, sharedLocal)?.adCount, count)
}

// Reverse-order test: B=3, A=2, A returns first, B later
sharedLocal.map.clear()
tabASession.map.clear()
tabBSession.map.clear()

const reverseA = startBuilder1Preview1Checkout(2, tabStorages(tabASession))
const reverseB = startBuilder1Preview1Checkout(3, tabStorages(tabBSession))

const reverseResolvedA = resolveBuilder1CheckoutAdCount(
  { checkoutId: reverseA.checkoutId },
  tabStorages(tabASession)
)
const reverseResolvedB = resolveBuilder1CheckoutAdCount(
  { checkoutId: reverseB.checkoutId },
  tabStorages(tabBSession)
)
assert.equal(reverseResolvedA.adCount, 2)
assert.equal(reverseResolvedB.adCount, 3)

// 10. locked campaign targetAdCount wins over checkout re-read
assert.equal(resolveBuilder1InitialAdCount({ targetAdCount: 3, checkoutId: reverseB.checkoutId }), 3)

// Source wiring
assert.match(previewSource, /startBuilder1Preview1Checkout/)
assert.doesNotMatch(previewSource, /saveBuilder1CampaignAdCount/)
assert.match(appSource, /loadSecurityConfig/)
assert.match(appSource, /from '\.\/services\/securityConfig'/)
assert.match(appSource, /buildBuilder1PaymentReturnHash/)
assert.match(appSource, /path="\/payment-return"/)
assert.match(builderPageSource, /resolveBuilder1CheckoutAdCount/)
assert.match(builderPageSource, /readBuilder1CheckoutIdFromRoute/)
assert.match(builderPageSource, /resolveBuilder1InitialAdCount/)
assert.doesNotMatch(builderPageSource, /readBuilder1CampaignAdCount\(/)
assert.doesNotMatch(builder2PreviewSource, /builder1Checkout|startBuilder1Preview1Checkout/)

// 11–13. recovery flows still use locked/session targetAdCount — not PREVIEW1 checkout reread
const generateNextBlock = builderPageSource.slice(
  builderPageSource.indexOf('const handleGenerateNextAd'),
  builderPageSource.indexOf('const handleFormSubmit')
)
assert.doesNotMatch(generateNextBlock, /resolveBuilder1CheckoutAdCount|readBuilder1CampaignAdCount/)
assert.match(builderPageSource, /runBuilder1Reattach/)
assert.match(builderPageSource, /executeBuilder1PlanningResumeFlow/)

// 14. route parser HashRouter-safe
assert.equal(BUILDER1_CHECKOUT_QUERY_PARAM, 'checkoutId')
assert.equal(
  readBuilder1CheckoutIdFromRoute('', `#/builder?fromPayment=1&checkoutId=${checkoutA.checkoutId}`),
  checkoutA.checkoutId
)

// checkout ids are UUID v4
assert.ok(isValidBuilder1CheckoutId(checkoutA.checkoutId))

// wired in suite
assert.match(pkg, /test-builder1-checkout-isolation\.mjs/)

console.log('test-builder1-checkout-isolation.mjs: multi-tab checkout ad-count isolation passed')
