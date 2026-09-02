/**
 * Builder2 Preview2 checkout + multi-tab isolation tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER2_ACTIVE_VIDEO_CHECKOUT_SESSION_KEY,
  BUILDER2_VIDEO_CHECKOUT_RECORD_KEY_PREFIX,
  PREVIEW2_TIER_TARGET_VIDEO_COUNTS,
  startBuilder2Preview2Checkout,
  readBuilder2VideoCheckoutRecord,
  resolveBuilder2CheckoutTargetVideoCount,
  buildBuilder2PaymentReturnHash,
  preview2TierKeyToTargetVideoCount,
  isValidBuilder2VideoCheckoutId
} from '../src/utils/builder2VideoCheckout.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const preview2Source = readFileSync(join(root, 'src/pages/Preview2/Preview2Page.jsx'), 'utf8')
const appSource = readFileSync(join(root, 'src/App.jsx'), 'utf8')
const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')

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

const sharedLocal = new MemoryStorage()
const tabASession = new MemoryStorage()
const tabBSession = new MemoryStorage()

function tabStorages(session) {
  return { localStorage: sharedLocal, sessionStorage: session }
}

assert.equal(preview2TierKeyToTargetVideoCount('1'), 1)
assert.equal(preview2TierKeyToTargetVideoCount('2'), 2)
assert.equal(PREVIEW2_TIER_TARGET_VIDEO_COUNTS['1'], 1)
assert.equal(PREVIEW2_TIER_TARGET_VIDEO_COUNTS['2'], 2)

assert.match(preview2Source, new RegExp(`'2': '${PAYMENT_URL_2.replace(/\?/g, '\\?')}'`))
assert.match(preview2Source, new RegExp(`'1': '${PAYMENT_URL_1.replace(/\?/g, '\\?')}'`))

assert.match(preview2Source, /startBuilder2Preview2Checkout/)
assert.match(preview2Source, /preview2TierKeyToTargetVideoCount/)

sharedLocal.map.clear()
tabASession.map.clear()
tabBSession.map.clear()

const checkoutOne = startBuilder2Preview2Checkout(1, tabStorages(tabASession))
const checkoutTwo = startBuilder2Preview2Checkout(2, tabStorages(tabBSession))
assert.equal(readBuilder2VideoCheckoutRecord(checkoutOne.checkoutId, sharedLocal)?.targetVideoCount, 1)
assert.equal(readBuilder2VideoCheckoutRecord(checkoutTwo.checkoutId, sharedLocal)?.targetVideoCount, 2)

const resolvedTabA = resolveBuilder2CheckoutTargetVideoCount(
  { checkoutId: checkoutOne.checkoutId },
  tabStorages(tabASession)
)
const resolvedTabB = resolveBuilder2CheckoutTargetVideoCount(
  { checkoutId: checkoutTwo.checkoutId },
  tabStorages(tabBSession)
)
assert.equal(resolvedTabA.targetVideoCount, 1)
assert.equal(resolvedTabB.targetVideoCount, 2)

tabBSession.removeItem(BUILDER2_ACTIVE_VIDEO_CHECKOUT_SESSION_KEY)
const tabBWithoutActive = resolveBuilder2CheckoutTargetVideoCount({}, tabStorages(tabBSession))
assert.equal(tabBWithoutActive.targetVideoCount, 1)
assert.equal(tabBWithoutActive.source, 'default')

const missingId = '00000000-0000-4000-8000-000000000000'
const invalid = resolveBuilder2CheckoutTargetVideoCount({ checkoutId: missingId }, tabStorages(tabASession))
assert.equal(invalid.targetVideoCount, 1)
assert.equal(invalid.source, 'missing-checkout-record')

sharedLocal.setItem(
  `${BUILDER2_VIDEO_CHECKOUT_RECORD_KEY_PREFIX}${missingId}`,
  JSON.stringify({ version: 1, checkoutId: missingId, targetVideoCount: 99, createdAt: Date.now() })
)
assert.equal(readBuilder2VideoCheckoutRecord(missingId, sharedLocal), null)

assert.equal(resolveBuilder2CheckoutTargetVideoCount({}).targetVideoCount, 1)

tabASession.setItem(BUILDER2_ACTIVE_VIDEO_CHECKOUT_SESSION_KEY, checkoutOne.checkoutId)
assert.match(buildBuilder2PaymentReturnHash(tabASession), /#\/builder2\?fromPayment=1&checkoutId=/)
assert.match(appSource, /buildBuilder2PaymentReturnHash/)
assert.match(appSource, /readActiveBuilder2VideoCheckoutId/)
assert.match(builder2PageSource, /resolveBuilder2CheckoutTargetVideoCount/)
assert.ok(isValidBuilder2VideoCheckoutId(checkoutOne.checkoutId))

console.log('test-builder2-video-checkout.mjs: passed')
