/**
 * Builder1 production-revision tests.
 * Run: npm run test:builder1
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  preview1TierKeyToAdCount,
  saveBuilder1CampaignAdCount,
  readBuilder1CampaignAdCount,
  getBuilder1GenerateButtonLabel,
  BUILDER1_CAMPAIGN_AD_COUNT_KEY
} from '../src/utils/builder1CampaignCount.js'
import {
  buildInitialGeneratePayload,
  validateInitialCampaignResponse,
  validateNextAdResponse,
  createCampaignSessionFromInitial,
  appendAdToSession,
  getFormatRatioCss,
  getBuilder1FormatDimensions,
  BUILDER1_FORMAT_DIMENSIONS,
  resolveBuilder1CampaignFormat,
  resolveBuilder1AdDisplayFormat,
  normalizeAdFromResponse,
  toBuilder1ApiImageBase64,
  buildSingleAdZipRequest,
  sanitizeSingleAdZipFilename,
  countMarketingWords,
  parseRateLimitError,
  validateBuilder1InitialSubmitInputs,
  isBuilder1InitialSubmitBlocked,
  trimBuilder1ProductName,
  getBuilder1ProductNameGenerationFailedMessage,
  resolveBuilder1GenerationFormError,
  parseBuilder1ApiErrorCode,
  BUILDER1_PRODUCT_NAME_GENERATION_FAILED,
  BUILDER1_MISSING_PRODUCT_DESCRIPTION,
  BUILDER1_IMAGE_COMPLIANCE_FAILED,
  BUILDER1_IMAGE_COMPLIANCE_UNAVAILABLE,
  BUILDER1_RETRY_MODE,
  isBuilder1ImageComplianceError,
  getBuilder1ImageComplianceFailedMessage,
  getBuilder1ImageComplianceUnavailableMessage,
  getBuilder1ImageComplianceMessage,
  getBuilder1ComplianceRetryMismatchMessage,
  parseBuilder1ComplianceRetryBody,
  validateRetryableComplianceError,
  resolveBuilder1ComplianceRetryResponse,
  parseBuilder1RetryContext,
  validateBuilder1RetryContext,
  getBuilder1RetryModeProgressLabel,
  resolveBuilder1RetryErrorResponse,
  buildBuilder1GenerateNextPayload,
  buildBuilder1RepairPhysicalPayload,
  parseAuthoritativeCampaignFieldsFromResult,
  mergeAuthoritativeCampaignSessionFields,
  parseCampaignReadinessFromResult,
  getBuilder1RetryErrorMessage
} from '../src/utils/builder1Campaign.js'
import { getAgentDisplayName } from '../src/utils/agentDisplayName.js'
import {
  BUILDER1_INITIAL_ESTIMATED_DURATION_MS,
  BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS,
  BUILDER1_PROGRESS_COMPLETION_DURATION_MS,
  BUILDER1_PROGRESS_MAX_WHILE_RUNNING,
  BUILDER1_PROGRESS_OVERDUE_TEXT_HE,
  BUILDER1_PROGRESS_OPERATION,
  resolveBuilder1ProgressOperationType,
  getBuilder1EstimatedDurationForOperation,
  computeBuilder1LinearProgress,
  computeBuilder1InitialCampaignProgress,
  computeBuilder1CompletionProgress,
  resolveBuilder1ProgressFrame,
  normalizeBuilder1ProgressPercent,
  getBuilder1InitialRemainingTimeText,
  getBuilder1RemainingTimeText,
  formatBuilder1RemainingClock,
  formatBuilder1NextAdProgressStatusLine,
  resolveBuilder1JobStartTime,
  clearBuilder1JobStartTime,
  clearAllBuilder1JobStartTimes,
  formatBuilder1InitialProgressStatusLine,
  BUILDER1_INITIAL_PROGRESS_HEADLINE_HE,
  BUILDER1_INITIAL_PROGRESS_ESTIMATE_HE,
  BUILDER1_INITIAL_PROGRESS_SEPARATOR,
  BUILDER1_INITIAL_PROGRESS_MAX_WHILE_RUNNING
} from '../src/utils/builder1Progress.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function mockStorages() {
  const local = new Map()
  const session = new Map()
  global.localStorage = {
    getItem: (k) => (local.has(k) ? local.get(k) : null),
    setItem: (k, v) => local.set(k, String(v)),
    removeItem: (k) => local.delete(k),
    clear: () => local.clear()
  }
  global.sessionStorage = {
    getItem: (k) => (session.has(k) ? session.get(k) : null),
    setItem: (k, v) => session.set(k, String(v)),
    removeItem: (k) => session.delete(k),
    clear: () => session.clear()
  }
  return { local, session }
}

function makeInitialResult(adCount = 3) {
  return {
    ok: true,
    campaignId: 'camp-abc',
    campaign: {
      productNameResolved: 'Brand X',
      brandSlogan: 'Slogan here',
      detectedLanguage: 'he',
      format: 'portrait',
      adCount
    },
    ad: {
      index: 1,
      headline: 'Headline one',
      marketingText: 'word '.repeat(50).trim(),
      imageBase64: 'abc123',
      imageContainsFinalCopy: true
    },
    composition: { format: 'portrait', brandSlogan: 'Slogan here' },
    nextAdIndex: 2
  }
}

mockStorages()

// 1–4. Constant-speed progress
assert.equal(computeBuilder1LinearProgress(0, 1000), 0)
assert.equal(computeBuilder1LinearProgress(500, 1000), 50)
assert.equal(computeBuilder1LinearProgress(1000, 1000), BUILDER1_PROGRESS_MAX_WHILE_RUNNING)
assert.equal(computeBuilder1LinearProgress(2000, 1000), BUILDER1_PROGRESS_MAX_WHILE_RUNNING)
assert.equal(computeBuilder1LinearProgress(500, 1000, 40), 50)
assert.equal(computeBuilder1LinearProgress(100, 1000, 50), 50)

const stageJump = resolveBuilder1ProgressFrame({
  elapsedMs: 5000,
  estimatedDurationMs: 10000,
  previousPercent: resolveBuilder1ProgressFrame({
    elapsedMs: 4000,
    estimatedDurationMs: 10000,
    previousPercent: 0,
    operationType: BUILDER1_PROGRESS_OPERATION.NEXT_AD
  }),
  operationType: BUILDER1_PROGRESS_OPERATION.NEXT_AD
})
assert.equal(stageJump, 50)

// Initial campaign curve — never reaches 100% while running
assert.ok(computeBuilder1InitialCampaignProgress(600_000, 0) >= 78)
assert.ok(computeBuilder1InitialCampaignProgress(600_000, 0) <= 85)
assert.ok(computeBuilder1InitialCampaignProgress(720_000, 0) <= BUILDER1_PROGRESS_MAX_WHILE_RUNNING)
assert.ok(computeBuilder1InitialCampaignProgress(1_800_000, 0) <= BUILDER1_PROGRESS_MAX_WHILE_RUNNING)
assert.ok(
  resolveBuilder1ProgressFrame({
    elapsedMs: 999_999,
    operationType: BUILDER1_PROGRESS_OPERATION.INITIAL_CAMPAIGN,
    previousPercent: 0
  }) < 100
)

// Initial completion animates to 100%
assert.equal(
  resolveBuilder1ProgressFrame({
    elapsedMs: 1000,
    operationType: BUILDER1_PROGRESS_OPERATION.INITIAL_CAMPAIGN,
    previousPercent: 90,
    taskSucceeded: true,
    completionFromPercent: 90,
    completionElapsedMs: BUILDER1_PROGRESS_COMPLETION_DURATION_MS
  }),
  100
)

// Next-ad linear caps at 95% while running
assert.equal(
  computeBuilder1LinearProgress(BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS, BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS),
  BUILDER1_PROGRESS_MAX_WHILE_RUNNING
)

// 5–6. Early completion animation
const from60 = computeBuilder1CompletionProgress(60, 0)
assert.equal(from60, 60)
const from60Done = computeBuilder1CompletionProgress(60, BUILDER1_PROGRESS_COMPLETION_DURATION_MS)
assert.equal(from60Done, 100)
assert.ok(BUILDER1_PROGRESS_COMPLETION_DURATION_MS >= 300)
assert.ok(BUILDER1_PROGRESS_COMPLETION_DURATION_MS <= 700)

const builderPageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const productFormSource = readFileSync(join(root, 'src/components/Form/ProductForm.jsx'), 'utf8')
const progressBarSource = readFileSync(join(root, 'src/components/ProgressBar/Builder1ProgressBar.jsx'), 'utf8')
const progressCss = readFileSync(join(root, 'src/components/ProgressBar/builder1-progress.css'), 'utf8')

// Progress visibility and normalization
assert.equal(normalizeBuilder1ProgressPercent(undefined), 0)
assert.equal(normalizeBuilder1ProgressPercent(NaN), 0)
assert.equal(normalizeBuilder1ProgressPercent(Infinity), 0)
assert.equal(normalizeBuilder1ProgressPercent('50'), 50)
assert.equal(normalizeBuilder1ProgressPercent(150), 100)
assert.match(builderPageSource, /generationProgressVisible/)
assert.match(builderPageSource, /beginProgress/)
assert.match(builderPageSource, /showProgressBar && !progressTaskFailed/)
assert.match(productFormSource, /builder1-progress-wrap|Builder1ProgressBar/)
assert.match(productFormSource, /form-actions--builder1/)
assert.match(progressBarSource, /builder1-progress-track/)
assert.match(progressBarSource, /builder1-progress-fill/)
assert.match(progressBarSource, /normalizeBuilder1ProgressPercent/)
assert.match(progressBarSource, /if \(!visible\)/)
assert.doesNotMatch(progressBarSource, /progress-bar-track/)
assert.match(progressCss, /\.builder1-progress-track[\s\S]*min-height:\s*8px/)
assert.match(progressCss, /\.builder1-progress-fill[\s\S]*background-color:\s*#4caf50/)
assert.doesNotMatch(progressCss, /display:\s*none/)
assert.doesNotMatch(progressCss, /opacity:\s*0/)
assert.doesNotMatch(progressCss, /visibility:\s*hidden/)
assert.match(builderPageSource, /pollBuilder1Job/)
assert.match(builderPageSource, /onStage/)
assert.doesNotMatch(builderPageSource, /onProgress[\s\S]*progress:/)

assert.match(builderPageSource, /pendingRevealRef/)
assert.match(builderPageSource, /queueSuccessfulReveal/)
assert.match(builderPageSource, /applyPendingReveal/)
assert.doesNotMatch(builderPageSource, /setProgressPercent/)
assert.doesNotMatch(builderPageSource, /computeStageProgress/)

// 7. Error path stops progress without reveal
assert.match(builderPageSource, /stopProgressWithFailure/)
assert.match(builderPageSource, /progressTaskFailed/)

// 8–11. Button labels
assert.equal(getBuilder1GenerateButtonLabel({ hasGeneratedAds: false, canGenerateNext: false }), 'GENERATE')
assert.equal(
  getBuilder1GenerateButtonLabel({ hasGeneratedAds: true, canGenerateNext: true, campaignComplete: false }),
  'GENERATE AGAIN'
)
assert.equal(getBuilder1GenerateButtonLabel({ campaignComplete: true }), 'CONSUMED')
assert.match(builderPageSource, /campaignComplete/)
assert.match(builderPageSource, /generateButtonDisabled/)

// 12. 429 does not produce CONSUMED
assert.equal(getBuilder1GenerateButtonLabel({ campaignComplete: false, hasGeneratedAds: true, canGenerateNext: true }), 'GENERATE AGAIN')

// Endpoints — Builder1 API client (not raw fetch in page)
assert.match(builderPageSource, /builder1Generate/)
assert.match(builderPageSource, /builder1GenerateNext/)
assert.match(builderPageSource, /builder1DownloadZip/)
assert.doesNotMatch(builderPageSource, /builder1-download-zip/)
assert.doesNotMatch(builderPageSource, /buildCampaignServerZipRequest/)
assert.doesNotMatch(builderPageSource, /handleDownloadCampaignZip/)
assert.doesNotMatch(builderPageSource, /builder-campaign-complete-notice/)
assert.doesNotMatch(builderPageSource, /builder-campaign-not-ready/)
assert.doesNotMatch(builderPageSource, /הורד ZIP קמפיין/)

// 13–18. AdCard layout
const adCardSource = readFileSync(join(root, 'src/components/AdCard/AdCard.jsx'), 'utf8')
const adCardCss = readFileSync(join(root, 'src/components/AdCard/adcard.css'), 'utf8')
const builder1CampaignSource = readFileSync(join(root, 'src/utils/builder1Campaign.js'), 'utf8')
assert.match(adCardSource, /builder1-ad-canvas/)
assert.match(adCardSource, /builder1-marketing-text/)
assert.match(adCardSource, /builder1-ad-actions/)
assert.match(adCardSource, /DOWNLOAD ZIP/)
assert.match(adCardSource, /marketingText \?\s*\(/)
assert.doesNotMatch(adCardSource, /headline-overlay/)
assert.match(adCardCss, /\.builder1-marketing-text[\s\S]*margin-top: 16px/)
assert.doesNotMatch(adCardCss, /\.builder1-marketing-text[\s\S]*position:\s*absolute/)
assert.doesNotMatch(adCardCss, /\.builder1-ad-actions[\s\S]*position:\s*absolute/)
assert.equal(getFormatRatioCss('square'), '1080 / 1080')
assert.equal(getFormatRatioCss('portrait'), '1080 / 1536')
assert.equal(getFormatRatioCss('landscape'), '1536 / 1080')
assert.doesNotMatch(adCardCss, /builder1-ad-canvas[\s\S]*1024 \/ 1536/)
assert.doesNotMatch(builder1CampaignSource, /getFormatRatioCss[\s\S]*1024 \/ 1536/)

for (const [format, dims] of Object.entries(BUILDER1_FORMAT_DIMENSIONS)) {
  const ratio = getFormatRatioCss(format)
  const placeholderDims = getBuilder1FormatDimensions(format)
  assert.deepEqual(placeholderDims, dims)
  assert.equal(ratio, `${dims.width} / ${dims.height}`)
}
assert.match(adCardCss, /\.builder1-final-ad-image[\s\S]*object-fit:\s*contain/)
assert.doesNotMatch(adCardCss, /\.builder1-final-ad-image[\s\S]*object-fit:\s*cover/)

// Builder1 result display format resolution (landscape letterboxing regression)
assert.equal(
  resolveBuilder1CampaignFormat({
    campaign: { productNameResolved: 'Brand' },
    composition: { format: 'landscape' }
  }),
  'landscape'
)
assert.equal(
  resolveBuilder1CampaignFormat({
    campaign: { format: 'portrait' },
    composition: { format: 'landscape' }
  }),
  'portrait'
)
assert.equal(
  resolveBuilder1AdDisplayFormat({
    session: { composition: { format: 'portrait' } },
    ad: { index: 2, format: 'landscape' }
  }),
  'landscape'
)
assert.equal(
  getFormatRatioCss(
    resolveBuilder1AdDisplayFormat({
      session: { composition: { format: 'landscape' } },
      ad: { index: 1 }
    })
  ),
  '1536 / 1080'
)
assert.equal(
  getFormatRatioCss(
    resolveBuilder1AdDisplayFormat({
      session: { campaign: { format: 'portrait' }, composition: { format: 'portrait' } },
      ad: { index: 1 }
    })
  ),
  '1080 / 1536'
)
assert.equal(
  getFormatRatioCss(
    resolveBuilder1AdDisplayFormat({
      session: { campaign: {}, composition: { format: 'square' } },
      ad: { index: 1 }
    })
  ),
  '1080 / 1080'
)
const dimensionAd = normalizeAdFromResponse({
  index: 1,
  marketingText: 'copy',
  imageBase64: 'abc',
  imageWidth: 1536,
  imageHeight: 1080
})
assert.equal(dimensionAd.ok, true)
assert.equal(dimensionAd.ad.format, 'landscape')
assert.equal(
  getFormatRatioCss(resolveBuilder1AdDisplayFormat({ session: {}, ad: dimensionAd.ad })),
  '1536 / 1080'
)
assert.match(builderPageSource, /resolveBuilder1AdDisplayFormat/)
assert.doesNotMatch(builderPageSource, /format=\{campaignFormat\}/)
assert.match(adCardSource, /--builder1-ad-ratio/)
assert.match(adCardCss, /aspect-ratio:\s*var\(--builder1-ad-ratio/)

// 19–22. Per-ad ZIP
assert.equal(sanitizeSingleAdZipFilename(1), 'ad-01.zip')
assert.equal(sanitizeSingleAdZipFilename(4), 'ad-04.zip')
assert.equal(toBuilder1ApiImageBase64('abc123'), 'abc123')
const initial3 = validateInitialCampaignResponse(makeInitialResult(3), 3)
const session3 = createCampaignSessionFromInitial(initial3, 3)
const zipReq = buildSingleAdZipRequest(session3.session, session3.session.ads[0])
assert.equal(zipReq.scope, 'single_ad')
assert.equal(zipReq.ad.index, 1)
assert.equal(zipReq.ad.imageBase64, 'abc123')
assert.match(builderPageSource, /zipStateByAd/)
assert.match(builderPageSource, /handleDownloadAdZip/)

// 23–25. No redundant campaign-level completion/status banners or campaign ZIP control
assert.doesNotMatch(builderPageSource, /builder-campaign-heading/)
assert.doesNotMatch(builderPageSource, /builder-campaign-meta/)
assert.doesNotMatch(builderPageSource, /builder-campaign-complete/)
assert.doesNotMatch(builderPageSource, /קמפיין פרסומי/)
assert.doesNotMatch(builderPageSource, /BUILDER1_MSG_CAMPAIGN_COMPLETE/)
assert.doesNotMatch(builderPageSource, /BUILDER1_MSG_CAMPAIGN_NOT_READY/)
assert.doesNotMatch(builderPageSource, /builder-campaign-download[^-]/)
assert.match(builderPageSource, /ErrorPanel/)
assert.match(builderPageSource, /complianceRetryMessage/)

// Marketing word count helper
assert.equal(countMarketingWords('one two three'), 3)
assert.equal(countMarketingWords('word '.repeat(50).trim()), 50)

// Incremental campaign preserved
const next2 = validateNextAdResponse(
  {
    ok: true,
    campaignId: 'camp-abc',
    ad: { index: 2, marketingText: 't', imageBase64: 'x' },
    nextAdIndex: 3
  },
  { campaignId: 'camp-abc', expectedIndex: 2 }
)
const after2 = appendAdToSession(session3.session, next2)
assert.equal(after2.session.ads.length, 2)

// 429 preserves session
const rateInfo = parseRateLimitError({
  status: 429,
  body: { error: 'image_rate_limited', retryAfterSeconds: 30 }
})
assert.equal(rateInfo.rateLimited, true)
assert.equal(after2.session.nextAdIndex, 3)

// Builder2 unchanged
const builder2Source = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
assert.doesNotMatch(builder2Source, /builder1-zip/)
assert.doesNotMatch(builder2Source, /builder1Progress/)

// PREVIEW1 count still works
saveBuilder1CampaignAdCount(preview1TierKeyToAdCount('2'))
assert.equal(readBuilder1CampaignAdCount(), 3)
const payload3 = buildInitialGeneratePayload({
  productName: 'P',
  productDescription: 'D',
  format: 'landscape',
  adCount: 3
})
assert.equal(payload3.adCount, 3)

// Duration constants — next-ad substantially shorter than initial midpoint
assert.equal(BUILDER1_INITIAL_ESTIMATED_DURATION_MS, 720_000)
assert.equal(BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS, 60_000)
assert.ok(BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS < BUILDER1_INITIAL_ESTIMATED_DURATION_MS)
assert.ok(
  BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS <= BUILDER1_INITIAL_ESTIMATED_DURATION_MS * 0.3
)

// Operation type selection (before request starts)
assert.equal(
  resolveBuilder1ProgressOperationType({ campaignId: null, canGenerateNext: false }),
  BUILDER1_PROGRESS_OPERATION.INITIAL_CAMPAIGN
)
assert.equal(
  resolveBuilder1ProgressOperationType({ campaignId: 'camp-1', canGenerateNext: true }),
  BUILDER1_PROGRESS_OPERATION.NEXT_AD
)
assert.equal(
  getBuilder1EstimatedDurationForOperation(BUILDER1_PROGRESS_OPERATION.INITIAL_CAMPAIGN),
  BUILDER1_INITIAL_ESTIMATED_DURATION_MS
)
assert.equal(
  getBuilder1EstimatedDurationForOperation(BUILDER1_PROGRESS_OPERATION.NEXT_AD),
  BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS
)
assert.match(builderPageSource, /BUILDER1_PROGRESS_OPERATION\.INITIAL_CAMPAIGN/)
assert.match(builderPageSource, /BUILDER1_PROGRESS_OPERATION\.NEXT_AD/)
assert.match(builderPageSource, /getBuilder1EstimatedDurationForOperation/)

// Same elapsed time → next-ad bar advances faster than initial curve
const elapsed = 30_000
const initialPct = resolveBuilder1ProgressFrame({
  elapsedMs: elapsed,
  operationType: BUILDER1_PROGRESS_OPERATION.INITIAL_CAMPAIGN,
  previousPercent: 0
})
const nextPct = resolveBuilder1ProgressFrame({
  elapsedMs: elapsed,
  estimatedDurationMs: BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS,
  operationType: BUILDER1_PROGRESS_OPERATION.NEXT_AD,
  previousPercent: 0
})
assert.ok(nextPct > initialPct)
assert.equal(nextPct, 50)

// Next-ad stays linear; initial uses ease-out curve
assert.equal(
  resolveBuilder1ProgressFrame({
    elapsedMs: 10_000,
    estimatedDurationMs: 60_000,
    previousPercent: 0,
    operationType: BUILDER1_PROGRESS_OPERATION.NEXT_AD
  }),
  computeBuilder1LinearProgress(10_000, 60_000)
)

// Next-ad at estimate → capped while running; completion animation reaches 100%
assert.equal(
  computeBuilder1LinearProgress(60_000, BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS),
  BUILDER1_PROGRESS_MAX_WHILE_RUNNING
)
assert.equal(
  computeBuilder1LinearProgress(90_000, BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS),
  BUILDER1_PROGRESS_MAX_WHILE_RUNNING
)

// Early next-ad success → rapid completion to 100%
assert.equal(computeBuilder1CompletionProgress(40, BUILDER1_PROGRESS_COMPLETION_DURATION_MS), 100)

// Reveal only after completion (pending reveal pattern)
assert.match(builderPageSource, /queueSuccessfulReveal/)
assert.match(builderPageSource, /applyPendingReveal/)
assert.match(builderPageSource, /onProgressRevealReady/)

// Existing ads remain during GENERATE AGAIN (next-ad failure does not clear session)
assert.match(builderPageSource, /appendAdToSession/)
const nextAdCatch = builderPageSource.slice(
  builderPageSource.indexOf('const handleGenerateNextAd'),
  builderPageSource.indexOf('const handleFormSubmit')
)
assert.doesNotMatch(nextAdCatch, /setCampaignSession\(null\)/)

// 26–41. Empty product name + automatic naming + full-width ZIP
const emptyNameValidDesc = validateBuilder1InitialSubmitInputs({
  productName: '',
  productDescription: 'A detailed product description'
})
assert.equal(emptyNameValidDesc.ok, true)
assert.equal(emptyNameValidDesc.productName, '')

const whitespaceNameValidDesc = validateBuilder1InitialSubmitInputs({
  productName: '   ',
  productDescription: 'Description'
})
assert.equal(whitespaceNameValidDesc.ok, true)
assert.equal(whitespaceNameValidDesc.productName, '')

const bothEmpty = validateBuilder1InitialSubmitInputs({
  productName: '',
  productDescription: ''
})
assert.equal(bothEmpty.ok, false)
assert.equal(bothEmpty.error, BUILDER1_MISSING_PRODUCT_DESCRIPTION)
assert.equal(isBuilder1InitialSubmitBlocked({ productName: '', productDescription: '' }), true)
assert.equal(isBuilder1InitialSubmitBlocked({ productName: '', productDescription: 'x' }), false)

const emptyNamePayload = buildInitialGeneratePayload({
  productName: '',
  productDescription: 'D',
  format: 'portrait',
  adCount: 2
})
assert.equal(emptyNamePayload.productName, '')

const trimmedManualPayload = buildInitialGeneratePayload({
  productName: '  Manual  ',
  productDescription: 'D',
  format: 'portrait',
  adCount: 2
})
assert.equal(trimmedManualPayload.productName, 'Manual')
assert.equal(trimBuilder1ProductName('  x  '), 'x')

const initialSubmitBlock = builderPageSource.slice(
  builderPageSource.indexOf('const handleInitialSubmit'),
  builderPageSource.indexOf('const handleGenerateNextAd')
)
assert.match(initialSubmitBlock, /userLeftProductNameEmpty/)
assert.match(initialSubmitBlock, /autoName/)
assert.doesNotMatch(initialSubmitBlock, /validateBuilder1ProductName/)
assert.doesNotMatch(initialSubmitBlock, /requireProductName/)
assert.doesNotMatch(initialSubmitBlock, /missing_product_name/)
assert.doesNotMatch(initialSubmitBlock, /setProductNameFieldError/)
assert.doesNotMatch(initialSubmitBlock, /getBuilder1ProductNameFieldMessage/)

const generateButtonBlock = builderPageSource.slice(
  builderPageSource.indexOf('const generateButtonDisabled'),
  builderPageSource.indexOf('const generationProgressVisible')
)
assert.doesNotMatch(generateButtonBlock, /productName/)

assert.match(productFormSource, /isProductNameAuto/)
assert.match(productFormSource, /fontWeight: '700'/)
assert.match(builderPageSource, /pending\.autoName/)
assert.doesNotMatch(productFormSource, /requireProductName/)
assert.doesNotMatch(productFormSource, /getBuilder1ProductNameFieldMessage/)

assert.match(
  productFormSource,
  /Product Name \(leave blank and \{getAgentDisplayName\('en'\)\} will create one for you\)/
)
assert.match(
  productFormSource,
  /שם המוצר \(אפשר להשאיר ריק ו-\{getAgentDisplayName\('he'\)\} ייצור שם עבורך\)/
)
assert.equal(
  `Product Name (leave blank and ${getAgentDisplayName('en')} will create one for you)`,
  'Product Name (leave blank and URI LEV will create one for you)'
)
assert.equal(
  `שם המוצר (אפשר להשאיר ריק ו-${getAgentDisplayName('he')} ייצור שם עבורך)`,
  'שם המוצר (אפשר להשאיר ריק ו-אורי לב ייצור שם עבורך)'
)
assert.match(productFormSource, /placeholder="Enter product name"/)

assert.match(builderPageSource, /campaignSession\.campaign\.productNameResolved/)
assert.match(builderPageSource, /onProductNameEdited/)
assert.match(builderPageSource, /setIsProductNameAuto\(false\)/)
assert.match(builderPageSource, /BUILDER1_PRODUCT_NAME_GENERATION_FAILED/)
assert.match(builderPageSource, /getBuilder1ProductNameGenerationFailedMessage/)
const mapErrorFn = builderPageSource.slice(
  builderPageSource.indexOf('function mapUserFacingError'),
  builderPageSource.indexOf('function BuilderPage')
)
assert.match(mapErrorFn, /BUILDER1_PRODUCT_NAME_GENERATION_FAILED[\s\S]*getBuilder1ProductNameGenerationFailedMessage/)
const nameGenFailedIdx = mapErrorFn.indexOf('BUILDER1_PRODUCT_NAME_GENERATION_FAILED')
const planningFailedIdx = mapErrorFn.indexOf('planning_failed')
assert.ok(nameGenFailedIdx > -1 && planningFailedIdx > -1 && nameGenFailedIdx < planningFailedIdx)
assert.doesNotMatch(mapErrorFn, /missing_product_name/)

assert.equal(
  resolveBuilder1GenerationFormError({ code: BUILDER1_PRODUCT_NAME_GENERATION_FAILED }, 'he')?.field,
  'productName'
)
assert.equal(parseBuilder1ApiErrorCode({ error: 'product_name_generation_failed' }), BUILDER1_PRODUCT_NAME_GENERATION_FAILED)

const appendBlock = readFileSync(join(root, 'src/utils/builder1Campaign.js'), 'utf8').slice(
  readFileSync(join(root, 'src/utils/builder1Campaign.js'), 'utf8').indexOf('export function appendAdToSession'),
  readFileSync(join(root, 'src/utils/builder1Campaign.js'), 'utf8').indexOf('export function createCampaignSessionFromInitial')
)
assert.match(appendBlock, /\.\.\.session/)
assert.doesNotMatch(appendBlock, /productNameResolved/)

assert.match(adCardCss, /\.builder1-ad-actions[\s\S]*width:\s*100%/)
assert.match(adCardCss, /\.builder1-ad-download-zip[\s\S]*display:\s*block/)
assert.match(adCardCss, /\.builder1-ad-download-zip[\s\S]*width:\s*100%/)
assert.match(adCardCss, /\.builder1-ad-download-zip[\s\S]*box-sizing:\s*border-box/)
assert.match(adCardCss, /\.builder1-ad-download-zip:disabled/)
assert.doesNotMatch(adCardCss, /\.builder1-ad-actions[\s\S]*align-items:\s*flex-end/)

const builder2Css = readFileSync(join(root, 'src/components/VideoAdCard/video-ad-card.css'), 'utf8')
assert.doesNotMatch(builder2Css, /builder1-ad-download-zip/)

// 42–61. Retryable image-compliance errors preserve active campaign
const complianceSession = {
  campaignId: 'camp-abc',
  targetAdCount: 4,
  generatedCount: 1,
  nextAdIndex: 2,
  canGenerateNext: true,
  campaign: { productNameResolved: 'Brand X', format: 'portrait' },
  ads: [{ index: 1, marketingText: 't', imageSrc: 'x' }]
}

const complianceFailedBody = {
  ok: false,
  error: 'image_compliance_failed',
  retryable: true,
  retryMode: BUILDER1_RETRY_MODE.IMAGE_ONLY,
  retryAdIndex: 2,
  campaignId: 'camp-abc',
  nextAdIndex: 2,
  generatedCount: 1,
  targetAdCount: 4,
  status: 'error',
  stage: 'compliance_review'
}

const complianceUnavailableBody = {
  ok: false,
  error: 'image_compliance_unavailable',
  retryable: true,
  retryMode: BUILDER1_RETRY_MODE.REVIEW_ONLY,
  retryAdIndex: 2,
  campaignId: 'camp-abc',
  nextAdIndex: 2,
  generatedCount: 1,
  targetAdCount: 4,
  status: 'error',
  complianceAvailable: false
}

assert.equal(parseBuilder1ComplianceRetryBody(complianceFailedBody)?.error, BUILDER1_IMAGE_COMPLIANCE_FAILED)
assert.equal(parseBuilder1ComplianceRetryBody(complianceUnavailableBody)?.error, BUILDER1_IMAGE_COMPLIANCE_UNAVAILABLE)
assert.equal(validateRetryableComplianceError(parseBuilder1ComplianceRetryBody(complianceFailedBody), complianceSession).ok, true)
assert.equal(validateRetryableComplianceError(parseBuilder1ComplianceRetryBody(complianceUnavailableBody), complianceSession).ok, true)

const failedOutcome = resolveBuilder1RetryErrorResponse(complianceFailedBody, complianceSession, 'he')
const unavailableOutcome = resolveBuilder1RetryErrorResponse(complianceUnavailableBody, complianceSession, 'he')
assert.equal(failedOutcome?.ok, true)
assert.equal(unavailableOutcome?.ok, true)
assert.equal(failedOutcome?.retryContext?.retryMode, BUILDER1_RETRY_MODE.IMAGE_ONLY)
assert.equal(unavailableOutcome?.retryContext?.retryMode, BUILDER1_RETRY_MODE.REVIEW_ONLY)
assert.equal(failedOutcome?.retryContext?.retryAdIndex, 2)
assert.equal(failedOutcome?.retryContext?.status, 'error')
assert.equal(failedOutcome?.retryContext?.stage, 'compliance_review')
assert.equal(failedOutcome?.message, getBuilder1ImageComplianceFailedMessage('he'))
assert.equal(unavailableOutcome?.message, getBuilder1ImageComplianceUnavailableMessage('he'))
assert.equal(
  getBuilder1ImageComplianceFailedMessage('en'),
  'The advertisement could not be approved. Please generate it again.'
)
assert.equal(
  getBuilder1ImageComplianceUnavailableMessage('en'),
  'Image verification is temporarily unavailable. Please try again.'
)

const mismatchCampaign = resolveBuilder1RetryErrorResponse(
  { ...complianceFailedBody, campaignId: 'other-camp' },
  complianceSession,
  'he'
)
assert.equal(mismatchCampaign?.ok, false)
assert.equal(mismatchCampaign?.retryContext, null)
assert.equal(mismatchCampaign?.message, getBuilder1ComplianceRetryMismatchMessage('he'))

const mismatchTarget = resolveBuilder1RetryErrorResponse(
  { ...complianceFailedBody, targetAdCount: 3 },
  complianceSession,
  'he'
)
assert.equal(mismatchTarget?.ok, false)
assert.equal(mismatchTarget?.retryContext, null)

assert.equal(isBuilder1ImageComplianceError(BUILDER1_IMAGE_COMPLIANCE_FAILED), true)
assert.equal(isBuilder1ImageComplianceError(BUILDER1_IMAGE_COMPLIANCE_UNAVAILABLE), true)
assert.equal(isBuilder1ImageComplianceError('planning_failed'), false)

const nextAdBlock = builderPageSource.slice(
  builderPageSource.indexOf('const handleGenerateNextAd'),
  builderPageSource.indexOf('const handleFormSubmit')
)
assert.match(nextAdBlock, /resolveBuilder1RetryErrorResponse/)
assert.match(nextAdBlock, /applyRetryErrorIfPresent/)
assert.match(nextAdBlock, /setBuilder1RetryContext/)
assert.match(nextAdBlock, /buildBuilder1GenerateNextPayload/)
assert.match(nextAdBlock, /expectedNextIndex: expectedIndex/)
assert.match(nextAdBlock, /builder1GenerateNext/)
assert.doesNotMatch(nextAdBlock, /builder1Generate[^N]/)
assert.match(builderPageSource, /builder-compliance-retry-panel/)
assert.match(nextAdBlock, /BUILDER1_PROGRESS_OPERATION\.NEXT_AD/)
assert.match(nextAdBlock, /getBuilder1RetryModeProgressLabel/)
assert.doesNotMatch(nextAdBlock, /setCampaignSession\(null\)/)
const retryHandler = nextAdBlock.slice(
  nextAdBlock.indexOf('const applyRetryErrorIfPresent'),
  nextAdBlock.indexOf('const progressCtx')
)
assert.doesNotMatch(retryHandler, /appendAdToSession/)
assert.doesNotMatch(retryHandler, /setCampaignSession/)

assert.equal(getBuilder1GenerateButtonLabel({ retryable: true }), 'RETRY')
assert.equal(
  getBuilder1GenerateButtonLabel({
    hasGeneratedAds: true,
    canGenerateNext: true,
    campaignComplete: false,
    retryable: true
  }),
  'RETRY'
)
assert.equal(getBuilder1GenerateButtonLabel({ campaignComplete: true }), 'CONSUMED')
const complianceIdx = mapErrorFn.indexOf('isBuilder1ImageComplianceError')
const planningIdx = mapErrorFn.indexOf('planning_failed')
assert.ok(complianceIdx > -1 && planningIdx > -1 && complianceIdx < planningIdx)
assert.match(mapErrorFn, /getBuilder1ImageComplianceMessage/)

const retrySuccess = appendAdToSession(complianceSession, next2)
assert.equal(retrySuccess.session.ads.length, 2)
assert.equal(retrySuccess.session.generatedCount, 2)
assert.equal(retrySuccess.session.campaign.productNameResolved, 'Brand X')
assert.equal(retrySuccess.session.nextAdIndex, 3)
assert.equal(
  getBuilder1GenerateButtonLabel({
    hasGeneratedAds: true,
    canGenerateNext: true,
    campaignComplete: false
  }),
  'GENERATE AGAIN'
)
assert.equal(
  getBuilder1GenerateButtonLabel({
    hasGeneratedAds: true,
    canGenerateNext: false,
    campaignComplete: true
  }),
  'CONSUMED'
)

assert.match(builderPageSource, /zipStateByAd/)
assert.doesNotMatch(nextAdBlock, /setZipStateByAd/)

// 62–72. Server-authoritative retry modes
const reviewOnlyBody = {
  ok: false,
  retryable: true,
  retryMode: BUILDER1_RETRY_MODE.REVIEW_ONLY,
  retryAdIndex: 2,
  campaignId: 'camp-abc',
  generatedCount: 1,
  targetAdCount: 4,
  status: 'error'
}
const imageOnlyBody = {
  ok: false,
  retryable: true,
  retryMode: BUILDER1_RETRY_MODE.IMAGE_ONLY,
  retryAdIndex: 2,
  campaignId: 'camp-abc',
  generatedCount: 1,
  targetAdCount: 4,
  status: 'error'
}
const repairBody = {
  ok: false,
  retryable: true,
  retryMode: BUILDER1_RETRY_MODE.REPAIR_FROM_PHYSICAL,
  retryAdIndex: 2,
  campaignId: 'camp-abc',
  generatedCount: 1,
  targetAdCount: 4,
  status: 'error',
  planningComplete: true
}

for (const body of [reviewOnlyBody, imageOnlyBody]) {
  const ctx = parseBuilder1RetryContext(body)
  assert.ok(ctx)
  assert.equal(validateBuilder1RetryContext(ctx, complianceSession).ok, true)
  const payload = buildBuilder1GenerateNextPayload({
    campaignId: ctx.campaignId,
    expectedNextIndex: ctx.retryAdIndex
  })
  assert.equal(payload.campaignId, 'camp-abc')
  assert.equal(payload.expectedNextIndex, 2)
}

const repairCtx = parseBuilder1RetryContext(repairBody)
assert.ok(repairCtx)
const repairPayload = buildBuilder1RepairPhysicalPayload({
  campaignId: repairCtx.campaignId,
  retryAdIndex: repairCtx.retryAdIndex,
  planRevision: repairCtx.planRevision
})
assert.equal(repairPayload.campaignId, 'camp-abc')
assert.equal(repairPayload.retryAdIndex, 2)

assert.equal(
  getBuilder1RetryModeProgressLabel(BUILDER1_RETRY_MODE.REVIEW_ONLY, 'he'),
  'מאמתים מחדש את התמונה…'
)
assert.equal(
  getBuilder1RetryModeProgressLabel(BUILDER1_RETRY_MODE.IMAGE_ONLY, 'he'),
  'יוצרים מחדש את המודעה…'
)
assert.equal(
  getBuilder1RetryModeProgressLabel(BUILDER1_RETRY_MODE.REPAIR_FROM_PHYSICAL, 'he'),
  'מתקנים את תוכנית המודעה…'
)

const handleFormSubmitBlock = builderPageSource.slice(
  builderPageSource.indexOf('const handleFormSubmit'),
  builderPageSource.indexOf('const handleRetryInitial')
)
assert.match(handleFormSubmitBlock, /builder1RetryContext\?\.retryable/)
assert.match(handleFormSubmitBlock, /handleGenerateNextAd/)
assert.match(handleFormSubmitBlock, /if \(campaignSession\?\.campaignId\)[\s\S]*return[\s\S]*\}\s*\n\s*handleInitialSubmit/)
const handleRetryInitialBlock = builderPageSource.slice(
  builderPageSource.indexOf('const handleRetryInitial'),
  builderPageSource.indexOf('const handleDownloadAdZip')
)
assert.match(handleRetryInitialBlock, /builder1RetryContext\?\.retryable/)
assert.match(handleRetryInitialBlock, /handleGenerateNextAd/)
assert.doesNotMatch(handleRetryInitialBlock, /handleInitialSubmit\(formData\)[\s\S]*builder1RetryContext/)

const initialCatchBlock = builderPageSource.slice(
  builderPageSource.indexOf('const handleInitialSubmit'),
  builderPageSource.indexOf('const handleGenerateNextAd')
)
assert.match(initialCatchBlock, /resolveBuilder1RetryErrorResponse\(err\?\.body/)
assert.match(initialCatchBlock, /setBuilder1RetryContext/)
assert.match(nextAdBlock, /generateRequestInFlightRef\.current = true/)

assert.doesNotMatch(builder2Source, /builder1RetryContext/)
assert.doesNotMatch(builder2Source, /buildBuilder1GenerateNextPayload/)

// Initial Builder1 progress copy + timing (12-minute estimate, single-line layout)
assert.equal(BUILDER1_INITIAL_PROGRESS_HEADLINE_HE, 'יוצרים עבורך קמפיין משובח')
assert.equal(BUILDER1_INITIAL_PROGRESS_ESTIMATE_HE, 'זמן משוער: 12 דקות')
assert.equal(BUILDER1_INITIAL_PROGRESS_SEPARATOR, ' · ')
assert.match(progressBarSource, /formatBuilder1InitialProgressStatusLine/)
assert.match(progressBarSource, /builder1-progress-status-line/)
assert.doesNotMatch(progressBarSource, /builder1-progress-estimate/)
assert.doesNotMatch(progressBarSource, /builder1-progress-remaining/)
assert.doesNotMatch(progressBarSource, /<br/i)
assert.match(progressCss, /builder1-progress-status-line[\s\S]*white-space:\s*nowrap/)
assert.match(progressCss, /builder1-progress-status-line[\s\S]*text-align:\s*center/)
assert.match(progressCss, /builder1-progress-status-line[\s\S]*direction:\s*rtl/)
assert.match(progressBarSource, /getBuilder1RemainingTimeText/)
assert.match(progressBarSource, /formatBuilder1NextAdProgressStatusLine/)
assert.match(progressBarSource, /BUILDER1_PROGRESS_OPERATION\.INITIAL_CAMPAIGN/)

const singleLine = formatBuilder1InitialProgressStatusLine('12:00')
assert.match(singleLine, /יוצרים עבורך קמפיין משובח · זמן משוער: 12 דקות · זמן שנותר: 12:00/)
assert.doesNotMatch(singleLine, /\n/)
const overdueLine = formatBuilder1InitialProgressStatusLine(BUILDER1_PROGRESS_OVERDUE_TEXT_HE)
assert.match(
  overdueLine,
  new RegExp(`יוצרים עבורך קמפיין משובח · זמן משוער: 12 דקות · זמן שנותר: ${BUILDER1_PROGRESS_OVERDUE_TEXT_HE}`)
)

const initialPollBlock = builderPageSource.slice(
  builderPageSource.indexOf('const handleInitialSubmit'),
  builderPageSource.indexOf('const handleGenerateNextAd')
)
assert.match(initialPollBlock, /writeBuilder1ActiveJob/)
assert.match(initialPollBlock, /pollBuilder1Job/)
assert.match(initialPollBlock, /onTransientError/)
assert.doesNotMatch(builderPageSource, /4 דק/)
assert.doesNotMatch(builderPageSource, /6–8/)
assert.doesNotMatch(progressBarSource, /4 דק/)
assert.doesNotMatch(progressBarSource, /6–8/)
assert.match(builderPageSource, /resolveBuilder1JobStartTime/)
assert.match(builderPageSource, /clearProgressJobTiming/)
assert.match(builderPageSource, /progressOperationType/)

// Remaining-time text — MM:SS countdown, monotonic, never negative
assert.equal(getBuilder1InitialRemainingTimeText(0), '12:00')
assert.equal(getBuilder1InitialRemainingTimeText(20_000), '11:40')
assert.equal(getBuilder1InitialRemainingTimeText(70_000), '10:50')
assert.equal(getBuilder1InitialRemainingTimeText(320_000), '06:40')
assert.equal(getBuilder1InitialRemainingTimeText(661_000), '00:59')
assert.equal(getBuilder1InitialRemainingTimeText(720_000), BUILDER1_PROGRESS_OVERDUE_TEXT_HE)
assert.equal(getBuilder1RemainingTimeText(0, BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS), '01:00')
assert.equal(getBuilder1RemainingTimeText(10_000, BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS), '00:50')
assert.equal(getBuilder1RemainingTimeText(30_000, BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS), '00:30')
assert.equal(getBuilder1RemainingTimeText(60_000, BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS), BUILDER1_PROGRESS_OVERDUE_TEXT_HE)
assert.equal(formatBuilder1RemainingClock(605_000), '10:05')
for (const sample of [0, 30_000, 600_000, 900_000]) {
  const text = getBuilder1InitialRemainingTimeText(sample)
  assert.doesNotMatch(text, /-/)
  if (sample < BUILDER1_INITIAL_ESTIMATED_DURATION_MS) {
    assert.match(text, /^\d{2}:\d{2}$/)
  }
}

// Job start timestamps isolated per job ID
clearAllBuilder1JobStartTimes()
const jobAStart = resolveBuilder1JobStartTime('job-a', 1000)
const jobBStart = resolveBuilder1JobStartTime('job-b', 2000)
assert.notEqual(jobAStart, jobBStart)
assert.equal(resolveBuilder1JobStartTime('job-a'), jobAStart)
clearBuilder1JobStartTime('job-a')
assert.equal(resolveBuilder1JobStartTime('job-a', 3000), 3000)
clearAllBuilder1JobStartTimes()

// beginProgress resets timing for a new campaign
assert.match(builderPageSource, /clearProgressJobTiming\(\)/)
assert.match(builderPageSource, /beginProgress\(BUILDER1_PROGRESS_OPERATION\.INITIAL_CAMPAIGN\)/)

// Builder1 progress bar fill — always LTR (planning, first ad, next ad, GENERATE AGAIN)
assert.match(progressCss, /\.builder1-progress[\s\S]*direction:\s*ltr/)
assert.match(progressCss, /\.builder1-progress-track[\s\S]*direction:\s*ltr/)
assert.match(progressCss, /\.builder1-progress-fill[\s\S]*left:\s*0/)
assert.match(progressCss, /\.builder1-progress-fill[\s\S]*right:\s*auto/)
assert.match(progressCss, /\.builder1-progress-fill[\s\S]*transform-origin:\s*left center/)
assert.doesNotMatch(progressCss, /inset-inline-start/)
assert.doesNotMatch(progressCss, /scaleX\(-1\)/)
assert.doesNotMatch(progressCss, /row-reverse/)
assert.match(progressBarSource, /className="builder1-progress"[\s\S]*dir="ltr"/)
assert.doesNotMatch(progressBarSource, /builder1-progress-wrap[\s\S]*dir=\{isInitialCampaign/)
assert.match(progressBarSource, /builder1-progress-status-line[\s\S]*dir="rtl"/)
assert.match(progressCss, /builder1-progress-status-line[\s\S]*direction:\s*rtl/)
assert.match(
  progressBarSource,
  /builder1-progress-stage[\s\S]*dir=\{progressLanguage === 'he' \? 'rtl' : undefined\}/
)
assert.match(productFormSource, /progressMode === 'builder1'/)
assert.match(builderPageSource, /BUILDER1_PROGRESS_OPERATION\.NEXT_AD/)
assert.doesNotMatch(builder2Source, /builder1-progress-fill/)
assert.doesNotMatch(progressBarSource, /builder2-progress/)
assert.doesNotMatch(builderPageSource, /Builder2ProgressBar/)
assert.match(progressCss, /@media \(max-width: 520px\)[\s\S]*builder1-progress-status-line/)

console.log('builder1 production-revision tests passed (retry modes + generate-next routing + initial progress)')
