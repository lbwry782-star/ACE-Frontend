/**
 * Builder1 reattach → Generate Again → Ad 2 full lifecycle + state-parity tests.
 * Run: npm run test:builder1
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  validateInitialCampaignResponse,
  validateNextAdResponse,
  createCampaignSessionFromInitial,
  appendAdToSession,
  buildBuilder1GenerateNextPayload
} from '../src/utils/builder1Campaign.js'
import {
  mergeBuilder1FormWithHydratedSession,
  deriveBuilder1FormSyncFromHydratedSession,
  readBuilder1ProductDescriptionFromSession
} from '../src/utils/builder1HydratedCampaignUi.js'
import {
  readBuilder1PendingMutation,
  writeBuilder1PendingMutation,
  clearBuilder1PendingMutation,
  BUILDER1_PENDING_MUTATION_SESSION_KEY
} from '../src/utils/builder1PendingMutation.js'
import {
  readBuilder1ActiveJob,
  writeBuilder1ActiveJob,
  clearBuilder1ActiveJob,
  BUILDER1_ACTIVE_JOB_SESSION_KEY
} from '../src/utils/builder1ActiveJob.js'
import {
  hydrateBuilder1SessionFromStatusResult,
  reattachBuilder1Job
} from '../src/utils/builder1JobReattach.js'
import { createBuilder1RequestId } from '../src/utils/builder1RequestId.js'
import { replayBuilder1PendingMutation } from '../src/services/builder1Api.js'
import { ensureBuilder1OwnerContext } from '../src/utils/builder1OwnerContext.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const builderPageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const productFormSource = readFileSync(join(root, 'src/components/Form/ProductForm.jsx'), 'utf8')
const hydratedUiSource = readFileSync(join(root, 'src/utils/builder1HydratedCampaignUi.js'), 'utf8')
const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
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

const sessionStorage = new MemoryStorage()
const localStorage = new MemoryStorage()
globalThis.sessionStorage = sessionStorage
globalThis.localStorage = localStorage
ensureBuilder1OwnerContext(localStorage)

const JOB_ID = '11111111-1111-4111-8111-111111111111'
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222'
const NEXT_JOB_ID = '33333333-3333-4333-8333-333333333333'

function makeAd(index, suffix = '') {
  return {
    index,
    headline: `Headline ${index}${suffix}`,
    marketingText: 'word '.repeat(50).trim(),
    imageBase64: `imageBase64Ad${index}${suffix}`
  }
}

function makeReattachStatusResult({ includeDescription = false } = {}) {
  const campaign = {
    productNameResolved: 'Recovered Product',
    brandSlogan: 'Slogan',
    format: 'portrait',
    detectedLanguage: 'he',
    adCount: 2
  }
  if (includeDescription) {
    campaign.productDescription = 'Original product description from backend'
  }
  return {
    ok: true,
    campaignId: CAMPAIGN_ID,
    campaign,
    ad: makeAd(1),
    composition: { format: 'portrait', brandSlogan: 'Slogan' },
    ads: [makeAd(1)],
    generatedCount: 1,
    targetAdCount: 2,
    nextAdIndex: 2,
    canGenerateNext: true,
    campaignComplete: false,
    campaignReady: false,
    planRevision: 1,
    retryAdIndex: null
  }
}

function makeNextAdDoneResult() {
  return {
    ok: true,
    campaignId: CAMPAIGN_ID,
    ad: makeAd(2, 'Next'),
    generatedCount: 2,
    targetAdCount: 2,
    nextAdIndex: null,
    canGenerateNext: false,
    campaignComplete: true,
    campaignReady: true
  }
}

// --- Canonical hydration UI helper unit tests ---
const sessionFromInitial = (() => {
  const validated = validateInitialCampaignResponse(makeReattachStatusResult({ includeDescription: true }), 2)
  assert.equal(validated.ok, true)
  const created = createCampaignSessionFromInitial(validated, 2)
  assert.equal(created.ok, true)
  return created.session
})()

assert.equal(readBuilder1ProductDescriptionFromSession(sessionFromInitial), 'Original product description from backend')
assert.equal(readBuilder1ProductDescriptionFromSession(makeReattachStatusResult()), null)

const emptyForm = { productName: '', productDescription: '', imageSize: '' }
const syncedForm = mergeBuilder1FormWithHydratedSession(emptyForm, sessionFromInitial)
assert.equal(syncedForm.productName, 'Recovered Product')
assert.equal(syncedForm.imageSize, 'portrait')
assert.equal(syncedForm.productDescription, 'Original product description from backend')

const preservedDescForm = mergeBuilder1FormWithHydratedSession(
  { productName: '', productDescription: 'User typed description', imageSize: '' },
  makeReattachStatusResult()
)
assert.equal(preservedDescForm.productDescription, 'User typed description')
assert.equal(preservedDescForm.productName, 'Recovered Product')

const urlOnlyForm = mergeBuilder1FormWithHydratedSession(emptyForm, makeReattachStatusResult())
assert.equal(urlOnlyForm.productDescription, '')
assert.equal(urlOnlyForm.productName, 'Recovered Product')
assert.equal(urlOnlyForm.imageSize, 'portrait')

// --- Source: canonical post-hydration sync wired in BuilderPage ---
assert.match(builderPageSource, /mergeBuilder1FormWithHydratedSession/)
assert.match(builderPageSource, /syncFormFromHydratedSession/)
assert.match(builderPageSource, /applyReattachSuccess[\s\S]*syncFormFromHydratedSession/)
assert.match(builderPageSource, /applyPendingReveal[\s\S]*syncFormFromHydratedSession/)
assert.match(hydratedUiSource, /deriveBuilder1FormSyncFromHydratedSession/)
assert.doesNotMatch(hydratedUiSource, /productDescription:\s*''/)

// --- Source: programmatic sync guard vs intentional user edit ---
assert.match(builderPageSource, /hydrationFormSyncRef/)
assert.match(builderPageSource, /lastHydratedCampaignIdRef/)
const formInvalidationEffect =
  builderPageSource.match(
    /useEffect\(\(\) => \{\r?\n    if \(hydrationFormSyncRef\.current\)[\s\S]*?\}, \[formData\.productName, formData\.productDescription\]\)/
  )?.[0] ?? ''
assert.ok(formInvalidationEffect.length > 0, 'form invalidation effect with hydration guard not found')
assert.match(formInvalidationEffect, /hydrationFormSyncRef\.current = false/)
assert.match(formInvalidationEffect, /setCampaignSession\(null\)/)
assert.match(formInvalidationEffect, /lastHydratedCampaignIdRef\.current = null/)
assert.doesNotMatch(builderPageSource, /fillingResolvedNameRef/)

// --- Source: Generate Again bypasses ProductForm validation ---
assert.match(productFormSource, /skipSubmitValidation/)
assert.match(builderPageSource, /skipProductFormValidation/)
assert.match(builderPageSource, /skipSubmitValidation=\{skipProductFormValidation\}/)

const handleFormSubmitBlock = builderPageSource.slice(
  builderPageSource.indexOf('const handleFormSubmit'),
  builderPageSource.indexOf('const handleRetryInitial')
)
assert.match(handleFormSubmitBlock, /campaignSession\?\.campaignId/)
assert.match(handleFormSubmitBlock, /canGenerateAgain/)
assert.match(handleFormSubmitBlock, /handleGenerateNextAd/)
assert.match(handleFormSubmitBlock, /lastHydratedCampaignIdRef\.current/)

// Cost-safety: lost hydrated campaign shows error instead of silent initial generate
assert.match(handleFormSubmitBlock, /if \(lastHydratedCampaignIdRef\.current\)/)
assert.match(handleFormSubmitBlock, /Campaign state was lost/)
assert.match(handleFormSubmitBlock, /return[\s\S]*handleInitialSubmit\(data\)/)

const handleGenerateNextBlock = builderPageSource.slice(
  builderPageSource.indexOf('const handleGenerateNextAd'),
  builderPageSource.indexOf('const handleFormSubmit')
)
assert.doesNotMatch(handleGenerateNextBlock, /builder1-generate[^-]/)

// --- Full lifecycle simulation: REATTACH → AD1 → GENERATE AGAIN → AD2 ---
const fetchCalls = []
globalThis.fetch = async (url, init = {}) => {
  const method = String(init.method ?? 'GET').toUpperCase()
  const path = String(url)
  fetchCalls.push({ method, path, body: init.body ?? null, headers: init.headers ?? {} })

  if (path.includes('/api/builder1-status') || path.includes('/api/builder1/status')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'done',
        result: makeReattachStatusResult()
      })
    }
  }

  if (path.includes('/api/builder1-generate-next')) {
    return {
      ok: true,
      status: 202,
      json: async () => ({
        ok: true,
        jobId: NEXT_JOB_ID,
        campaignId: CAMPAIGN_ID,
        accepted: true
      })
    }
  }

  throw new Error(`Unexpected fetch: ${method} ${path}`)
}

const reattachOutcome = await reattachBuilder1Job(JOB_ID, { targetAdCount: 2 })
assert.equal(reattachOutcome.ok, true)
assert.equal(reattachOutcome.kind, 'done')

const session = reattachOutcome.session
assert.equal(session.campaignId, CAMPAIGN_ID)
assert.equal(session.generatedCount, 1)
assert.equal(session.canGenerateNext, true)
assert.equal(session.ads.length, 1)
assert.equal(session.ads[0].index, 1)

// Reattach: zero paid POSTs
const reattachPosts = fetchCalls.filter(
  (c) =>
    c.method === 'POST' &&
    (c.path.includes('builder1-generate') ||
      c.path.includes('builder1-generate-next') ||
      c.path.includes('builder1-retry-image'))
)
assert.equal(reattachPosts.length, 0)

// Simulate applyReattachSuccess form sync (URL-only, empty description)
let formData = mergeBuilder1FormWithHydratedSession(emptyForm, session)
assert.equal(formData.productName, 'Recovered Product')
assert.equal(formData.imageSize, 'portrait')
assert.equal(formData.productDescription, '')

// Programmatic sync must not invalidate campaign (guard semantics)
let hydrationFormSyncRef = { current: true }
let campaignSession = session
let lastHydratedCampaignIdRef = { current: CAMPAIGN_ID }
if (hydrationFormSyncRef.current) {
  hydrationFormSyncRef.current = false
} else {
  campaignSession = null
  lastHydratedCampaignIdRef.current = null
}
assert.equal(campaignSession.campaignId, CAMPAIGN_ID)
assert.equal(lastHydratedCampaignIdRef.current, CAMPAIGN_ID)

// Generate Again payload (authoritative session only)
const nextPayload = buildBuilder1GenerateNextPayload({
  campaignId: session.campaignId,
  expectedNextIndex: session.nextAdIndex ?? 2
})
assert.deepEqual(nextPayload, { campaignId: CAMPAIGN_ID, expectedNextIndex: 2 })
assert.equal('productDescription' in nextPayload, false)
assert.equal('productName' in nextPayload, false)

// Pending mutation + active job (generate-next safety)
clearBuilder1PendingMutation(sessionStorage)
clearBuilder1ActiveJob(sessionStorage)
const requestId = createBuilder1RequestId()
writeBuilder1PendingMutation(
  {
    requestId,
    operation: 'next',
    requestPayload: nextPayload,
    createdAtMs: Date.now(),
    jobId: null,
    campaignId: CAMPAIGN_ID
  },
  sessionStorage
)
const pending = readBuilder1PendingMutation(sessionStorage)
assert.equal(pending?.operation, 'next')
assert.equal(BUILDER1_PENDING_MUTATION_SESSION_KEY, 'ace.builder1.pendingMutation.v1')
assert.deepEqual(pending?.requestPayload, nextPayload)

writeBuilder1ActiveJob(
  { jobId: NEXT_JOB_ID, operation: 'next', startedAtMs: Date.now(), campaignId: CAMPAIGN_ID },
  sessionStorage
)
assert.equal(readBuilder1ActiveJob(sessionStorage)?.jobId, NEXT_JOB_ID)
assert.equal(BUILDER1_ACTIVE_JOB_SESSION_KEY, 'ace.builder1.activeJob.v1')

// Simulate generate-next acceptance (one POST, not initial)
fetchCalls.length = 0
globalThis.fetch = async (url, init = {}) => {
  const method = String(init.method ?? 'GET').toUpperCase()
  const path = String(url)
  fetchCalls.push({ method, path, body: init.body ?? null, headers: init.headers ?? {} })
  if (path.includes('/api/builder1-generate-next')) {
    const parsed = JSON.parse(String(init.body ?? '{}'))
    assert.equal(parsed.campaignId, CAMPAIGN_ID)
    assert.equal(parsed.expectedNextIndex, 2)
    assert.equal(init.headers['X-ACE-Request-Id'], requestId)
    return {
      ok: true,
      status: 202,
      json: async () => ({ ok: true, jobId: NEXT_JOB_ID, campaignId: CAMPAIGN_ID, accepted: true })
    }
  }
  if (path.includes('/api/builder1-status') || path.includes('/api/builder1/status')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'done', result: makeNextAdDoneResult() })
    }
  }
  throw new Error(`Unexpected fetch: ${method} ${path}`)
}

const replayOutcome = await replayBuilder1PendingMutation(pending)
assert.equal(replayOutcome.payload?.ok, true)
assert.equal(replayOutcome.payload?.jobId, NEXT_JOB_ID)

const generateNextPosts = fetchCalls.filter((c) => c.method === 'POST' && c.path.includes('builder1-generate-next'))
const initialGeneratePosts = fetchCalls.filter(
  (c) => c.method === 'POST' && c.path.includes('builder1-generate') && !c.path.includes('builder1-generate-next')
)
assert.equal(generateNextPosts.length, 1)
assert.equal(initialGeneratePosts.length, 0)

// Poll DONE → validateNextAdResponse → appendAdToSession → reveal session
const validatedNext = validateNextAdResponse(makeNextAdDoneResult(), {
  campaignId: CAMPAIGN_ID,
  expectedIndex: 2
})
assert.equal(validatedNext.ok, true)
assert.equal(validatedNext.ad.index, 2)

const appended = appendAdToSession(session, validatedNext)
assert.equal(appended.ok, true)
assert.equal(appended.session.ads.length, 2)
assert.equal(appended.session.ads[0].index, 1)
assert.equal(appended.session.ads[1].index, 2)
assert.equal(appended.session.generatedCount, 2)
assert.equal(appended.session.targetAdCount, 2)
assert.equal(appended.session.campaignComplete, true)
assert.equal(appended.session.canGenerateNext, false)

// Form preserved through Ad 2 reveal
const formAfterAd2 = mergeBuilder1FormWithHydratedSession(formData, appended.session)
assert.equal(formAfterAd2.productName, formData.productName)
assert.equal(formAfterAd2.imageSize, formData.imageSize)
assert.equal(formAfterAd2.productDescription, formData.productDescription)

// URL-only reattach: empty productDescription does not block generate-next path
assert.equal(formData.productDescription, '')
assert.ok(session.canGenerateNext)

// Intentional user edit invalidates campaign (simulated)
hydrationFormSyncRef = { current: false }
campaignSession = session
lastHydratedCampaignIdRef = { current: CAMPAIGN_ID }
if (hydrationFormSyncRef.current) {
  hydrationFormSyncRef.current = false
} else {
  campaignSession = null
  lastHydratedCampaignIdRef.current = null
}
assert.equal(campaignSession, null)
assert.equal(lastHydratedCampaignIdRef.current, null)

// Normal fresh campaign still uses ProductForm validation
assert.match(productFormSource, /if \(skipSubmitValidation\)/)
assert.match(productFormSource, /productDescription/)
assert.match(productFormSource, /imageSize/)
assert.match(builderPageSource, /handleInitialSubmit/)

// Planning resume → hydrated campaign uses same sync helper
assert.match(builderPageSource, /executeBuilder1PlanningResumeFlow[\s\S]*queueSuccessfulReveal/)
assert.match(builderPageSource, /resumePlanningInFlightRef/)
assert.doesNotMatch(
  builderPageSource.match(/executeBuilder1PlanningResumeFlow[\s\S]{0,1200}/)?.[0] ?? '',
  /handleInitialSubmit\(formData\)/
)

// Strict Mode double-submit guard
assert.match(handleGenerateNextBlock, /generateRequestInFlightRef\.current = true/)

// Uncertain replay uses same requestId/body
assert.match(builderPageSource, /replayBuilder1PendingMutation/)
assert.match(builderPageSource, /readBuilder1PendingMutation/)

// Builder2 untouched
assert.doesNotMatch(builder2PageSource, /builder1HydratedCampaignUi|skipSubmitValidation|hydrationFormSyncRef/)
assert.doesNotMatch(builderPageSource, /builder2Generate|Builder2Page/)

// Wired in test suite
assert.match(pkg, /test-builder1-reattach-generate-next\.mjs/)

// hydrateBuilder1SessionFromStatusResult produces same canonical shape as initial
const hydrated = hydrateBuilder1SessionFromStatusResult(makeReattachStatusResult(), 2)
assert.equal(hydrated.ok, true)
assert.equal(hydrated.session.campaignId, CAMPAIGN_ID)
assert.equal(hydrated.session.generatedCount, 1)

globalThis.fetch = undefined

console.log('test-builder1-reattach-generate-next.mjs: full reattach → generate-next lifecycle passed')
