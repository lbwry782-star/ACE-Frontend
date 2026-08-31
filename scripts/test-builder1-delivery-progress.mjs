/**
 * Builder1 delivery, progress cap, campaignReady, repair, and accidental-generate tests.
 * Run: npm run test:builder1
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER1_INITIAL_ESTIMATED_DURATION_MS,
  BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS,
  BUILDER1_PROGRESS_COMPLETION_DURATION_MS,
  BUILDER1_PROGRESS_MAX_WHILE_RUNNING,
  BUILDER1_PROGRESS_OVERDUE_TEXT_HE,
  BUILDER1_PROGRESS_OPERATION,
  computeBuilder1InitialCampaignProgress,
  computeBuilder1LinearProgress,
  resolveBuilder1ProgressFrame,
  getBuilder1RemainingTimeText
} from '../src/utils/builder1Progress.js'
import {
  appendAdToSession,
  buildBuilder1RepairPhysicalPayload,
  parseAuthoritativeCampaignFieldsFromResult,
  mergeAuthoritativeCampaignSessionFields,
  parseCampaignReadinessFromResult,
  parseBuilder1RetryContext,
  getBuilder1RetryErrorMessage,
  validateNextAdResponse,
  BUILDER1_RETRY_MODE,
  buildCampaignServerZipRequest
} from '../src/utils/builder1Campaign.js'
import {
  isBuilder1CampaignAuthoritativelyReady,
  isBuilder1CampaignDeliverable,
  isBuilder1CampaignDeliveryPending,
  parseBuilder1CampaignReadinessFields
} from '../src/utils/builder1Status.js'
import {
  BUILDER1_PENDING_MUTATION_SESSION_KEY,
  writeBuilder1PendingMutation,
  readBuilder1PendingMutation
} from '../src/utils/builder1PendingMutation.js'
import { createBuilder1RequestId } from '../src/utils/builder1RequestId.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const builder1PageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const builder1ApiSource = readFileSync(join(root, 'src/services/builder1Api.js'), 'utf8')
const adCardSource = readFileSync(join(root, 'src/components/AdCard/AdCard.jsx'), 'utf8')
const progressBarSource = readFileSync(
  join(root, 'src/components/ProgressBar/Builder1ProgressBar.jsx'),
  'utf8'
)

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

const sessionStorage = new MemoryStorage()

function makeTerminalResult(overrides = {}) {
  return {
    ok: true,
    campaignId: '598301ee-d784-480b-b6e8-42f1acf95810',
    campaign: {
      productNameResolved: 'Product',
      brandSlogan: 'Slogan',
      detectedLanguage: 'he',
      format: 'portrait',
      adCount: 2
    },
    composition: { format: 'portrait', brandSlogan: 'Slogan' },
    ad: {
      index: 2,
      headline: 'H2',
      marketingText: 'word '.repeat(50).trim(),
      imageBase64: 'img2'
    },
    generatedCount: 2,
    targetAdCount: 2,
    nextAdIndex: null,
    canGenerateNext: false,
    campaignComplete: true,
    campaignReady: true,
    deliveryReconstructible: true,
    ...overrides
  }
}

// --- PROGRESS (1–8) ---
assert.equal(BUILDER1_INITIAL_ESTIMATED_DURATION_MS, 720_000)
assert.equal(getBuilder1RemainingTimeText(0, BUILDER1_INITIAL_ESTIMATED_DURATION_MS), '12:00')

const tenMinProgress = computeBuilder1InitialCampaignProgress(600_000, 0)
assert.ok(tenMinProgress < 100)
assert.ok(tenMinProgress > 0)

const twelveMinProgress = computeBuilder1InitialCampaignProgress(720_000, 0)
assert.ok(twelveMinProgress <= BUILDER1_PROGRESS_MAX_WHILE_RUNNING)

const overdueProgress = computeBuilder1InitialCampaignProgress(900_000, 0)
assert.ok(overdueProgress <= BUILDER1_PROGRESS_MAX_WHILE_RUNNING)

assert.equal(
  getBuilder1RemainingTimeText(750_000, BUILDER1_INITIAL_ESTIMATED_DURATION_MS),
  BUILDER1_PROGRESS_OVERDUE_TEXT_HE
)

const earlyComplete = resolveBuilder1ProgressFrame({
  elapsedMs: 60_000,
  operationType: BUILDER1_PROGRESS_OPERATION.INITIAL_CAMPAIGN,
  previousPercent: 40,
  taskSucceeded: true,
  completionFromPercent: 40,
  completionElapsedMs: BUILDER1_PROGRESS_COMPLETION_DURATION_MS
})
assert.equal(earlyComplete, 100)

const nextRunning = computeBuilder1LinearProgress(60_000, BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS)
assert.ok(nextRunning < 100)
assert.equal(nextRunning, BUILDER1_PROGRESS_MAX_WHILE_RUNNING)

const nextTerminal = resolveBuilder1ProgressFrame({
  elapsedMs: 30_000,
  estimatedDurationMs: BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS,
  previousPercent: 50,
  operationType: BUILDER1_PROGRESS_OPERATION.NEXT_AD,
  taskSucceeded: true,
  completionFromPercent: 50,
  completionElapsedMs: BUILDER1_PROGRESS_COMPLETION_DURATION_MS
})
assert.equal(nextTerminal, 100)

// --- CAMPAIGN READY (9–17) ---
const nestedStatus = {
  status: 'done',
  result: {
    campaignReady: true,
    deliveryReconstructible: true,
    campaignComplete: true,
    generatedCount: 2,
    targetAdCount: 2,
    canGenerateNext: false
  }
}
assert.equal(parseCampaignReadinessFromResult(nestedStatus.result).campaignReady, true)
assert.equal(parseBuilder1CampaignReadinessFields(nestedStatus.result).campaignReady, true)

const prodBugResult = makeTerminalResult()
assert.equal(parseCampaignReadinessFromResult(prodBugResult).campaignReady, true)
assert.equal(parseAuthoritativeCampaignFieldsFromResult(prodBugResult).campaignReady, true)

const sessionStale = {
  campaignId: '598301ee-d784-480b-b6e8-42f1acf95810',
  generatedCount: 1,
  targetAdCount: 2,
  campaignReady: false,
  deliveryReconstructible: false,
  canGenerateNext: true,
  ads: [{ index: 1, marketingText: 'x', imageBase64: 'a' }]
}
const validatedFinal = validateNextAdResponse(
  { ok: true, ...makeTerminalResult() },
  { campaignId: sessionStale.campaignId, expectedIndex: 2 }
)
assert.equal(validatedFinal.campaignReady, true)
assert.equal(validatedFinal.deliveryReconstructible, true)
assert.equal(validatedFinal.canGenerateNext, false)

const appended = appendAdToSession(sessionStale, validatedFinal)
assert.equal(appended.ok, true)
assert.equal(appended.session.campaignReady, true)
assert.equal(appended.session.deliveryReconstructible, true)
assert.equal(appended.session.campaignComplete, true)
assert.equal(appended.session.canGenerateNext, false)
assert.equal(appended.session.generatedCount, 2)

const derivedOnly = mergeAuthoritativeCampaignSessionFields(
  { campaignReady: false, generatedCount: 2, targetAdCount: 2 },
  parseAuthoritativeCampaignFieldsFromResult({ generatedCount: 2, targetAdCount: 2 }),
  { generatedCount: 2 }
)
assert.equal(derivedOnly.campaignReady, false)

const mergedTrue = mergeAuthoritativeCampaignSessionFields(
  { campaignReady: false, deliveryReconstructible: false, generatedCount: 2, targetAdCount: 2 },
  parseAuthoritativeCampaignFieldsFromResult(makeTerminalResult()),
  { generatedCount: 2, canGenerateNext: false }
)
assert.equal(mergedTrue.campaignReady, true)
assert.equal(mergedTrue.deliveryReconstructible, true)
assert.equal(mergedTrue.campaignComplete, true)
assert.equal(mergedTrue.canGenerateNext, false)

const deliverableSession = {
  ...appended.session,
  generatedCount: 2,
  targetAdCount: 2,
  campaignReady: true,
  deliveryReconstructible: true,
  campaignComplete: true,
  canGenerateNext: false
}
assert.equal(isBuilder1CampaignDeliverable(deliverableSession), true)
assert.equal(isBuilder1CampaignDeliveryPending(deliverableSession), false)
assert.equal(isBuilder1CampaignAuthoritativelyReady(deliverableSession), true)
assert.ok(buildCampaignServerZipRequest(deliverableSession).campaignId)
assert.doesNotMatch(builder1PageSource, /BUILDER1_MSG_CAMPAIGN_COMPLETE/)
assert.doesNotMatch(builder1PageSource, /BUILDER1_MSG_CAMPAIGN_NOT_READY/)
assert.doesNotMatch(builder1PageSource, /builder-campaign-complete-notice/)
assert.doesNotMatch(builder1PageSource, /builder-campaign-not-ready/)
assert.doesNotMatch(builder1PageSource, /handleDownloadCampaignZip/)
assert.doesNotMatch(builder1PageSource, /הורד ZIP קמפיין/)
assert.match(builder1PageSource, /ErrorPanel/)
assert.match(builder1PageSource, /complianceRetryMessage/)

// --- ACCIDENTAL NEW CAMPAIGN (18–20) ---
const handleFormSubmitBlock = builder1PageSource.slice(
  builder1PageSource.indexOf('const handleFormSubmit'),
  builder1PageSource.indexOf('const handleRetryInitial')
)
assert.match(handleFormSubmitBlock, /campaignSession\?\.campaignId/)
assert.match(handleFormSubmitBlock, /if \(canGenerateAgain\)/)
assert.match(handleFormSubmitBlock, /if \(campaignSession\?\.campaignId\)[\s\S]*return[\s\S]*\}\s*\n\s*handleInitialSubmit/)
const handleRetryInitialBlock = builder1PageSource.slice(
  builder1PageSource.indexOf('const handleRetryInitial'),
  builder1PageSource.indexOf('const handleDownloadAdZip')
)
assert.match(handleRetryInitialBlock, /campaignSession\?\.campaignId[\s\S]*return/)

// --- REPAIR (21–29) ---
const repairError = {
  status: 'error',
  result: {
    retryable: true,
    retryMode: 'repair_from_physical',
    retryAdIndex: 2,
    campaignId: 'camp-repair',
    error: 'plan_product_visibility_conflict',
    userMessage: 'ניתן לתקן את המודעה בלי להתחיל קמפיין חדש.',
    planRevision: 3
  }
}
const repairCtx = parseBuilder1RetryContext(repairError)
assert.ok(repairCtx)
assert.equal(repairCtx.retryMode, BUILDER1_RETRY_MODE.REPAIR_FROM_PHYSICAL)
assert.equal(
  getBuilder1RetryErrorMessage(repairCtx, 'he'),
  'ניתן לתקן את המודעה בלי להתחיל קמפיין חדש.'
)
assert.notEqual(getBuilder1RetryErrorMessage(repairCtx, 'he'), 'plan_product_visibility_conflict')

const repairPayload = buildBuilder1RepairPhysicalPayload({
  campaignId: repairCtx.campaignId,
  retryAdIndex: repairCtx.retryAdIndex,
  planRevision: repairCtx.planRevision
})
assert.equal(repairPayload.campaignId, 'camp-repair')
assert.equal(repairPayload.retryAdIndex, 2)
assert.equal(repairPayload.planRevision, 3)

const nextAdBlock = builder1PageSource.slice(
  builder1PageSource.indexOf('const handleGenerateNextAd'),
  builder1PageSource.indexOf('const handleFormSubmit')
)
assert.match(builder1ApiSource, /builder1-repair-physical/)
assert.match(builder1PageSource, /builder1RepairPhysical/)
assert.match(builder1PageSource, /buildBuilder1RepairPhysicalPayload/)
assert.match(nextAdBlock, /nextOperation = isRepairMutation \? 'repair'/)
assert.match(nextAdBlock, /operation: nextOperation/)
assert.match(builder1ApiSource, /case 'repair':[\s\S]*builder1RepairPhysical/)

const requestIdA = createBuilder1RequestId()
const requestIdB = createBuilder1RequestId()
assert.notEqual(requestIdA, requestIdB)

writeBuilder1PendingMutation(
  {
    requestId: requestIdA,
    operation: 'repair',
    requestPayload: repairPayload,
    createdAtMs: Date.now(),
    jobId: null,
    campaignId: 'camp-repair'
  },
  sessionStorage
)
const pending = readBuilder1PendingMutation(sessionStorage)
assert.equal(pending.requestId, requestIdA)
assert.equal(pending.operation, 'repair')
assert.equal(BUILDER1_PENDING_MUTATION_SESSION_KEY, 'ace.builder1.pendingMutation.v1')

assert.doesNotMatch(
  builder1PageSource.slice(
    builder1PageSource.indexOf('const handleGenerateNextAd'),
    builder1PageSource.indexOf('const handleFormSubmit')
  ),
  /repair_from_physical[\s\S]*builder1Generate\(/
)

// --- REGRESSION (30–36) ---
assert.doesNotMatch(adCardSource, /line-clamp|substring|truncate|slice\(0/)
assert.match(builder1PageSource, /handleDownloadAdZip/)
assert.doesNotMatch(builder1PageSource, /handleDownloadCampaignZip/)
assert.match(builder1PageSource, /pagehide/)
assert.match(builder1PageSource, /frontend_refresh/)
assert.match(builder1ApiSource, /X-ACE-Batch-State/)
assert.match(builder1ApiSource, /X-ACE-Request-Id/)
assert.match(builder1PageSource, /readBuilder1PendingMutation/)
assert.match(builder1PageSource, /writeBuilder1ActiveJob/)
assert.match(progressBarSource, /Date\.now\(\) - jobStartTimeMsRef\.current/)

console.log('test-builder1-delivery-progress.mjs: all assertions passed')
