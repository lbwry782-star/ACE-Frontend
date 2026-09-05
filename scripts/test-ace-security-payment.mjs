/**
 * ACE security + iCount payment flow frontend tests.
 * Run: node scripts/test-ace-security-payment.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  loadSecurityConfig,
  resetSecurityConfigForTests,
  isSecurityEnabled,
  isSecurityExplicitlyDisabled,
  isSecurityConfigError,
  getSecurityConfigSnapshot
} from '../src/services/securityConfig.js'
import {
  SECURE_CHECKOUT_SESSION_KEY,
  buildSecureCheckoutRecordFromResponse,
  writeSecureCheckoutRecord,
  readSecureCheckoutRecord,
  clearSecureCheckoutRecord,
  secureCheckoutMatchesStatus
} from '../src/utils/secureCheckout.js'
import {
  PREVIEW1_TIER_TO_OFFER_CODE,
  PREVIEW2_TIER_TO_OFFER_CODE,
  offerCodeToBuilder,
  builderToRouteHash
} from '../src/utils/secureCheckoutOffers.js'
import { evaluateSecureBuilderEntry } from '../src/hooks/useSecureBuilderEntryGuard.js'
import {
  requireSecureCheckoutAuthHeaders,
  SecureCheckoutRequiredError
} from '../src/services/secureRequest.js'
import { buildBuilder1RequestHeaders, builder1DownloadZip } from '../src/services/builder1Api.js'
import { buildBuilder2RequestHeaders } from '../src/services/api.js'
import { isBackendProtectedMediaUrl } from '../src/utils/authenticatedMedia.js'
import { isSecureRefreshGuardInstalled } from '../src/utils/secureRefreshGuard.js'
import { resolveBuilder1PaidAdCount, resolveBuilder2PaidTargetVideoCount } from '../src/utils/secureBuilderQuantity.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const appSource = readFileSync(join(root, 'src/App.jsx'), 'utf8')
const preview1Source = readFileSync(join(root, 'src/pages/Preview/PreviewPage.jsx'), 'utf8')
const preview2Source = readFileSync(join(root, 'src/pages/Preview2/Preview2Page.jsx'), 'utf8')
const paymentReturnSource = readFileSync(join(root, 'src/pages/PaymentReturn/PaymentReturnPage.jsx'), 'utf8')
const builder1ApiSource = readFileSync(join(root, 'src/services/builder1Api.js'), 'utf8')
const apiSource = readFileSync(join(root, 'src/services/api.js'), 'utf8')
const builder1PageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const securityConfigSource = readFileSync(join(root, 'src/services/securityConfig.js'), 'utf8')
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
}

const session = new MemoryStorage()
const originalFetch = globalThis.fetch

function mockFetch(handler) {
  globalThis.fetch = handler
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

// SECURITY CONFIG
mockFetch(async (url, init) => {
  if (String(url).includes('/api/security/config')) {
    assert.equal(init?.cache, 'no-store', 'security config must use cache:no-store')
    return {
      ok: true,
      status: 200,
      json: async () => ({ securityEnabled: true })
    }
  }
  throw new Error(`unexpected fetch ${url}`)
})
await loadSecurityConfig()
assert.equal(isSecurityEnabled(), true)
restoreFetch()

mockFetch(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ securityEnabled: false })
}))
await loadSecurityConfig()
assert.equal(isSecurityExplicitlyDisabled(), true)
assert.equal(isSecurityEnabled(), false)
restoreFetch()

mockFetch(async () => ({ ok: false, status: 503, json: async () => null }))
await loadSecurityConfig()
assert.equal(isSecurityConfigError(), true)
assert.equal(isSecurityEnabled(), false, '503 must fail closed — not disabled mode')
restoreFetch()

mockFetch(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ securityEnabled: 'yes' })
}))
await loadSecurityConfig()
assert.equal(isSecurityConfigError(), true)
restoreFetch()

mockFetch(async () => {
  throw new Error('network down')
})
await loadSecurityConfig()
assert.equal(isSecurityConfigError(), true)
restoreFetch()

assert.match(securityConfigSource, /cache:\s*['"]no-store['"]/)
assert.doesNotMatch(pkg, /VITE_SECURITY_ENABLED/)
assert.doesNotMatch(appSource, /localStorage.*securityEnabled/)

resetSecurityConfigForTests({ status: 'enabled', securityEnabled: true, error: null })

// OFFER MAPPING
assert.equal(PREVIEW1_TIER_TO_OFFER_CODE['1'], 'b1-2')
assert.equal(PREVIEW1_TIER_TO_OFFER_CODE['2'], 'b1-3')
assert.equal(PREVIEW1_TIER_TO_OFFER_CODE['5'], 'b1-4')
assert.equal(PREVIEW2_TIER_TO_OFFER_CODE['1'], 'b2-1')
assert.equal(PREVIEW2_TIER_TO_OFFER_CODE['2'], 'b2-2')
assert.equal(offerCodeToBuilder('b1-3'), 'builder1')
assert.equal(offerCodeToBuilder('b2-2'), 'builder2')
assert.equal(builderToRouteHash('builder1'), '#/builder')

// CHECKOUT SESSION
const sampleCheckout = {
  checkoutId: 'a1b2c3d4-e5f6-4178-8abc-def012345678',
  browserToken: '0123456789abcdef0123456789abcdef',
  paymentUrl: 'https://app.icount.co.il/m/example',
  offer: { offerCode: 'b1-2', builder: 'builder1', quantity: 2, currency: 'ILS' }
}
const built = buildSecureCheckoutRecordFromResponse(sampleCheckout)
assert.equal(built.ok, true)
assert.equal(writeSecureCheckoutRecord(built.record, session), true)
const readBack = readSecureCheckoutRecord(session)
assert.equal(readBack.checkoutId, sampleCheckout.checkoutId)
assert.equal(readBack.browserToken, sampleCheckout.browserToken)
const local = new MemoryStorage()
assert.equal(local.getItem(SECURE_CHECKOUT_SESSION_KEY), null, 'browserToken must not be in localStorage')

clearSecureCheckoutRecord(session)

// Preview wiring
assert.match(preview1Source, /startSecurePreviewCheckout/)
assert.match(preview1Source, /PREVIEW1_TIER_TO_OFFER_CODE/)
assert.match(preview1Source, /PREVIEW1_PAYMENT_URLS/)
assert.match(preview2Source, /startSecurePreviewCheckout/)
assert.match(preview2Source, /PREVIEW2_TIER_TO_OFFER_CODE/)
assert.match(preview2Source, /PREVIEW2_PAYMENT_URLS/)
assert.doesNotMatch(preview2Source, /m__/)

// RETURN ROUTE
assert.match(appSource, /path="\/payment-return"/)
assert.match(paymentReturnSource, /fetchPaymentCheckoutStatus/)
assert.match(paymentReturnSource, /ace_checkout_id/)
assert.doesNotMatch(paymentReturnSource, /searchParams\.get\(['"]ace_checkout_id['"]\).*paid/s)

// DIRECT ACCESS
resetSecurityConfigForTests({ status: 'enabled', securityEnabled: true, error: null })
writeSecureCheckoutRecord(built.record, session)
globalThis.sessionStorage = session
let entry = evaluateSecureBuilderEntry('builder1')
assert.equal(entry.allowed, true)
entry = evaluateSecureBuilderEntry('builder2')
assert.equal(entry.allowed, false)
clearSecureCheckoutRecord(session)
entry = evaluateSecureBuilderEntry('builder1')
assert.equal(entry.allowed, false)

resetSecurityConfigForTests({ status: 'disabled', securityEnabled: false, error: null })
entry = evaluateSecureBuilderEntry('builder1')
assert.equal(entry.allowed, true)

const b2Record = buildSecureCheckoutRecordFromResponse({
  ...sampleCheckout,
  offer: { offerCode: 'b2-2', builder: 'builder2', quantity: 2 }
})

// AUTH HEADERS — fail closed
resetSecurityConfigForTests({ status: 'enabled', securityEnabled: true, error: null })
globalThis.sessionStorage = session
clearSecureCheckoutRecord(session)

let fetchCalls = 0
const originalFetchForFailClosed = globalThis.fetch
globalThis.fetch = () => {
  fetchCalls += 1
  throw new Error('fetch should not run')
}

assert.throws(
  () => buildBuilder1RequestHeaders(),
  SecureCheckoutRequiredError
)
assert.equal(fetchCalls, 0)

await assert.rejects(
  () =>
    builder1DownloadZip({
      scope: 'single_ad',
      campaignId: '00000000-0000-4000-8000-000000000001',
      campaign: { productNameResolved: 'x', brandSlogan: 'y' },
      ad: { index: 1, headline: null, marketingText: 'z', imageBase64: 'abc' }
    }),
  SecureCheckoutRequiredError
)
assert.equal(fetchCalls, 0)

assert.throws(() => buildBuilder2RequestHeaders(), SecureCheckoutRequiredError)
assert.equal(fetchCalls, 0)

writeSecureCheckoutRecord(b2Record.record, session)
assert.throws(
  () => buildBuilder1RequestHeaders(),
  (err) => err instanceof SecureCheckoutRequiredError && err.code === 'secure_checkout_wrong_builder'
)
assert.equal(fetchCalls, 0)

clearSecureCheckoutRecord(session)
writeSecureCheckoutRecord(built.record, session)
const headers = requireSecureCheckoutAuthHeaders({ expectedBuilder: 'builder1' })
assert.match(headers.Authorization, /^Bearer /)
assert.equal(headers['X-ACE-Checkout-Id'], built.record.checkoutId)
assert.doesNotMatch(JSON.stringify(headers), /browserToken/)
const headerBuild = buildBuilder1RequestHeaders()
assert.equal(headerBuild.Authorization, headers.Authorization)
assert.equal(headerBuild['X-ACE-Checkout-Id'], headers['X-ACE-Checkout-Id'])
assert.equal(fetchCalls, 0)

globalThis.fetch = originalFetchForFailClosed

resetSecurityConfigForTests({ status: 'disabled', securityEnabled: false, error: null })
assert.deepEqual(requireSecureCheckoutAuthHeaders({ expectedBuilder: 'builder1' }), {})
fetchCalls = 0
globalThis.fetch = () => {
  fetchCalls += 1
  return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
}
buildBuilder1RequestHeaders()
assert.equal(fetchCalls, 0, 'legacy header build must not fetch')

globalThis.fetch = originalFetchForFailClosed

assert.match(builder1ApiSource, /requireSecureCheckoutAuthHeaders/)
assert.match(builder1ApiSource, /isSecurityEnabled/)
assert.match(apiSource, /requireSecureCheckoutAuthHeaders/)

// QUANTITY
resetSecurityConfigForTests({ status: 'enabled', securityEnabled: true, error: null })
writeSecureCheckoutRecord(built.record, session)
globalThis.sessionStorage = session
assert.equal(resolveBuilder1PaidAdCount({}, { sessionStorage: session }).adCount, 2)
clearSecureCheckoutRecord(session)
writeSecureCheckoutRecord(b2Record.record, session)
assert.equal(resolveBuilder2PaidTargetVideoCount({}, { sessionStorage: session }).targetVideoCount, 2)
clearSecureCheckoutRecord(session)

// REFRESH / PAGEHIDE
assert.match(builder1PageSource, /if \(isSecurityEnabled\(\)\) return/)
assert.match(builder2PageSource, /if \(isSecurityEnabled\(\)\) return/)
assert.match(builder1PageSource, /recoverBootstrapJobIdRef/)
assert.match(builder2PageSource, /startPolling\(jobId\)/)

// STATUS MATCH
assert.equal(
  secureCheckoutMatchesStatus(built.record, {
    checkoutId: built.record.checkoutId,
    offer: { offerCode: 'b1-2', builder: 'builder1', quantity: 2 }
  }),
  true
)
assert.equal(
  secureCheckoutMatchesStatus(built.record, {
    checkoutId: built.record.checkoutId,
    offer: { offerCode: 'b1-4', builder: 'builder1', quantity: 4 }
  }),
  false
)

// MEDIA
assert.equal(isBackendProtectedMediaUrl('https://ace-backend-k1p6.onrender.com/api/foo'), true)
assert.equal(isBackendProtectedMediaUrl('https://cdn.example.com/v.mp4'), false)

console.log('test-ace-security-payment: all assertions passed')
