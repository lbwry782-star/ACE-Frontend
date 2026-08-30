/**
 * Builder1 production-prep tests (ownership, cancel, poll resilience, campaignReady, ZIP).
 * Run: npm run test:builder1
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER1_OWNER_CONTEXT_STORAGE_KEY,
  readBuilder1OwnerContext,
  ensureBuilder1OwnerContext,
  getBuilder1OwnerBatchStateHeader,
  resetBuilder1OwnerContextSessionCacheForTests
} from '../src/utils/builder1OwnerContext.js'
import {
  BUILDER1_ACTIVE_JOB_SESSION_KEY,
  readBuilder1ActiveJob,
  writeBuilder1ActiveJob,
  clearBuilder1ActiveJob
} from '../src/utils/builder1ActiveJob.js'
import {
  BUILDER1_MSG_CANCEL_BLOCKED,
  isBuilder1CancelAcknowledged,
  isBuilder1CampaignAuthoritativelyReady,
  isBuilder1CampaignDeliveryPending,
  isBuilder1CampaignDeliverable,
  getBuilder1OwnershipErrorCode
} from '../src/utils/builder1Status.js'
import {
  buildBuilder1RequestHeaders,
  getBuilder1AuthorizationHeader
} from '../src/services/builder1Api.js'
import {
  buildCampaignServerZipRequest,
  buildSingleAdZipRequest,
  createCampaignSessionFromInitial,
  validateInitialCampaignResponse
} from '../src/utils/builder1Campaign.js'
import {
  BUILDER1_INITIAL_ESTIMATED_DURATION_MS,
  BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS,
  BUILDER1_PROGRESS_OVERDUE_TEXT_HE,
  getBuilder1RemainingTimeText
} from '../src/utils/builder1Progress.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const builder1PageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const builder1ApiSource = readFileSync(join(root, 'src/services/builder1Api.js'), 'utf8')
const adCardSource = readFileSync(join(root, 'src/components/AdCard/AdCard.jsx'), 'utf8')
const progressBarSource = readFileSync(
  join(root, 'src/components/ProgressBar/Builder1ProgressBar.jsx'),
  'utf8'
)
const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')

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

const localStorage = new MemoryStorage()
const sessionStorage = new MemoryStorage()

function makeInitialResult(adCount = 2, extra = {}) {
  const ads = Array.from({ length: adCount }, (_, i) => ({
    index: i + 1,
    headline: `Headline ${i + 1}`,
    marketingText: 'word '.repeat(50).trim(),
    imageBase64: 'abc123'
  }))
  return {
    ok: true,
    campaignId: 'camp-prod-1',
    campaign: {
      productNameResolved: 'Product',
      brandSlogan: 'Slogan',
      format: 'portrait',
      detectedLanguage: 'he',
      adCount,
      ...extra.campaign
    },
    ad: ads[0],
    composition: { format: 'portrait', brandSlogan: 'Slogan' },
    ads,
    generatedCount: adCount,
    targetAdCount: adCount,
    nextAdIndex: adCount + 1,
    canGenerateNext: false,
    campaignReady: extra.campaignReady ?? true,
    deliveryReconstructible: extra.deliveryReconstructible ?? true,
    ...extra
  }
}

resetBuilder1OwnerContextSessionCacheForTests()

// 1–2. Owner context reads existing / creates if missing
localStorage.setItem(
  BUILDER1_OWNER_CONTEXT_STORAGE_KEY,
  JSON.stringify({ v: 1, ownerId: 'existing-owner-uuid' })
)
const existingOwner = readBuilder1OwnerContext(localStorage)
assert.equal(existingOwner?.ownerId, 'existing-owner-uuid')
const ensured = ensureBuilder1OwnerContext(localStorage)
assert.equal(ensured.ownerId, 'existing-owner-uuid')

localStorage.removeItem(BUILDER1_OWNER_CONTEXT_STORAGE_KEY)
resetBuilder1OwnerContextSessionCacheForTests()
const created = ensureBuilder1OwnerContext(localStorage)
assert.ok(created.ownerId)
assert.equal(readBuilder1OwnerContext(localStorage)?.ownerId, created.ownerId)

// 3–4. Protected requests send X-ACE-Batch-State; Authorization when sid present
globalThis.window = { localStorage, sessionStorage }
localStorage.setItem('sid', 'test-session-token')
const headers = buildBuilder1RequestHeaders({ 'Content-Type': 'application/json' })
assert.ok(headers['X-ACE-Batch-State'])
const batchState = JSON.parse(headers['X-ACE-Batch-State'])
assert.equal(batchState.ownerId, created.ownerId)
assert.match(headers.Authorization, /Bearer test-session-token/)
assert.equal(getBuilder1AuthorizationHeader(), 'Bearer test-session-token')
localStorage.removeItem('sid')
delete globalThis.window

// 5. Active job persisted after jobId
writeBuilder1ActiveJob(
  { jobId: 'job-123', campaignId: 'camp-1', operation: 'initial', startedAtMs: 1000 },
  sessionStorage
)
const active = readBuilder1ActiveJob(sessionStorage)
assert.equal(active?.jobId, 'job-123')
assert.equal(BUILDER1_ACTIVE_JOB_SESSION_KEY, 'ace.builder1.activeJob.v1')

// 6–8. pagehide cancel with keepalive, correct jobId, frontend_refresh
const pagehideEffect =
  builder1PageSource.match(
    /useEffect\(\(\) => \{\r?\n    const onPageHide[\s\S]*?\}, \[\]\)/
  )?.[0] ?? ''
assert.match(pagehideEffect, /pagehide/)
assert.match(pagehideEffect, /readBuilder1ActiveJob/)
assert.match(pagehideEffect, /cancelBuilder1JobKeepalive/)
assert.match(pagehideEffect, /frontend_refresh/)
assert.doesNotMatch(pagehideEffect, /cancelBuilder2Job/)
assert.match(builder1ApiSource, /keepalive:\s*true/)
assert.match(builder1ApiSource, /\/api\/builder1\/jobs\/\$\{id\}\/cancel/)

// 9–11. Cancel acknowledgement releases gate; unresolved keeps blocked; 403 blocks
const mountEffect =
  builder1PageSource.match(
    /useEffect\(\(\) => \{\r?\n    ensureBuilder1OwnerContext\(\)[\s\S]*?\}, \[resetFreshBuilder1Ui, clearBuilder1RecoveryState\]\)/
  )?.[0] ?? ''
assert.match(mountEffect, /cancelBuilder1Job\(jobId/)
assert.match(mountEffect, /readBuilder1PendingMutation/)
assert.match(mountEffect, /replayBuilder1PendingMutation/)
assert.match(mountEffect, /isBuilder1CancelAcknowledged/)
assert.match(mountEffect, /setCancellationGate\('ready'\)/)
assert.match(mountEffect, /setCancellationGate\('blocked'\)/)
assert.match(mountEffect, /BUILDER1_MSG_CANCEL_BLOCKED/)
for (const status of ['cancelled', 'already_cancelled', 'already_completed', 'not_found']) {
  assert.ok(isBuilder1CancelAcknowledged({ ok: true, status }), `ack ${status}`)
}
assert.match(builder1PageSource, /cancellationGate !== 'ready'/)
assert.match(builder1PageSource, /getBuilder1OwnershipErrorCode|isOwnershipError|BUILDER1_MSG_OWNERSHIP/)

// 12. Active job prevents duplicate Generate
assert.match(builder1PageSource, /readBuilder1PendingMutation\(\)/)
assert.match(builder1PageSource, /writeBuilder1PendingMutation/)
assert.match(builder1PageSource, /generateRequestInFlightRef/)

// 13–16. Poll resilience — transient errors do not clear active job or restart generation
assert.match(builder1ApiSource, /onTransientError/)
assert.match(builder1ApiSource, /consecutiveTransientErrors/)
assert.match(builder1PageSource, /onTransientError/)
assert.match(builder1PageSource, /isPollDisconnected/)
assert.doesNotMatch(
  builder1PageSource.slice(builder1PageSource.indexOf('onTransientError'), builder1PageSource.indexOf('validateInitialCampaignResponse')),
  /clearBuilder1ActiveJob/
)

// 17–18. Date.now epoch for elapsed; RAF not mixed with epoch start
assert.match(progressBarSource, /Date\.now\(\) - jobStartTimeMsRef\.current/)
assert.match(progressBarSource, /completionStartRef\.current = now/)
assert.doesNotMatch(
  progressBarSource,
  /performance\.now\(\) - jobStartTimeMsRef/
)

// 19–20. Initial + next-ad countdown at start / overdue
assert.equal(getBuilder1RemainingTimeText(0, BUILDER1_INITIAL_ESTIMATED_DURATION_MS), '12:00')
assert.equal(getBuilder1RemainingTimeText(690_000, BUILDER1_INITIAL_ESTIMATED_DURATION_MS), '00:30')
assert.equal(getBuilder1RemainingTimeText(720_000, BUILDER1_INITIAL_ESTIMATED_DURATION_MS), BUILDER1_PROGRESS_OVERDUE_TEXT_HE)
assert.equal(getBuilder1RemainingTimeText(0, BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS), '01:00')
assert.equal(getBuilder1RemainingTimeText(30_000, BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS), '00:30')
assert.equal(getBuilder1RemainingTimeText(60_000, BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS), BUILDER1_PROGRESS_OVERDUE_TEXT_HE)

// 21. Full 50-word marketing text unchanged
assert.doesNotMatch(adCardSource, /line-clamp|substring|truncate|slice\(0/)
assert.match(adCardSource, /marketingText/)

// 22–23. campaignReady semantics + campaign ZIP gated
const notReadyValidated = validateInitialCampaignResponse(
  makeInitialResult(2, { campaignReady: false, canGenerateNext: false }),
  2
)
const notReadySession = createCampaignSessionFromInitial(notReadyValidated, 2)
assert.equal(isBuilder1CampaignAuthoritativelyReady(notReadySession.session), false)
const allAdsNotReady = {
  ...notReadySession.session,
  generatedCount: 2,
  targetAdCount: 2,
  campaignReady: false
}
assert.equal(isBuilder1CampaignDeliveryPending(allAdsNotReady), true)

const readyValidated = validateInitialCampaignResponse(makeInitialResult(2, { campaignReady: true }), 2)
const readySession = createCampaignSessionFromInitial(readyValidated, 2)
const fullReadySession = {
  ...readySession.session,
  generatedCount: 2,
  targetAdCount: 2,
  campaignReady: true,
  deliveryReconstructible: true,
  canGenerateNext: false
}
assert.equal(isBuilder1CampaignAuthoritativelyReady(fullReadySession), true)
assert.equal(isBuilder1CampaignDeliverable(fullReadySession), true)
assert.match(builder1PageSource, /campaignDeliverable/)
assert.match(builder1PageSource, /handleDownloadCampaignZip/)

// 24–26. Campaign ZIP scope + ownership; ZIP does not call generation
const zipReq = buildCampaignServerZipRequest(fullReadySession)
assert.equal(zipReq.scope, 'campaign_server')
assert.equal(zipReq.campaignId, 'camp-prod-1')
assert.match(builder1PageSource, /buildCampaignServerZipRequest/)
assert.match(builder1PageSource, /builder1DownloadZip/)
assert.doesNotMatch(
  builder1PageSource.slice(
    builder1PageSource.indexOf('handleDownloadCampaignZip'),
    builder1PageSource.indexOf('useEffect(() => {', builder1PageSource.indexOf('handleDownloadCampaignZip'))
  ),
  /builder1Generate|builder1GenerateNext/
)
const singleZip = buildSingleAdZipRequest(readySession.session, readySession.session.ads[0])
assert.equal(singleZip.scope, 'single_ad')

// 27. Storage key separation from Builder2
assert.doesNotMatch(builder1PageSource, /ace\.builder2|builder2ActiveJob|writeBuilder2ActiveJob/i)
assert.doesNotMatch(BUILDER1_ACTIVE_JOB_SESSION_KEY, /builder2/)

// 28. Refresh partial campaign — no generate-next resume on mount
assert.match(mountEffect, /resetFreshBuilder1Ui/)
assert.doesNotMatch(mountEffect, /pollBuilder1Job/)
assert.doesNotMatch(mountEffect, /handleGenerateNextAd/)
assert.doesNotMatch(builder1PageSource, /cancelBuilder2Job|builder2OwnerContext/i)
assert.doesNotMatch(builder2PageSource, /builder1ActiveJob|cancelBuilder1Job/i)

// Ownership error code detection
assert.equal(getBuilder1OwnershipErrorCode({ error: 'ownership_mismatch', httpStatus: 403 }), 'ownership_mismatch')

clearBuilder1ActiveJob(sessionStorage)
assert.equal(readBuilder1ActiveJob(sessionStorage), null)

console.log('builder1 production-prep tests passed (28 cases)')
