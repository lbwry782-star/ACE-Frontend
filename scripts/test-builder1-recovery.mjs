/**
 * Builder1 recoverable terminal job + read-only reattach tests.
 * Run: npm run test:builder1
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER1_RECOVERABLE_TERMINAL_JOB_SESSION_KEY,
  readBuilder1RecoverableTerminalJob,
  writeBuilder1RecoverableTerminalJob,
  clearBuilder1RecoverableTerminalJob,
  persistBuilder1RecoverableTerminalJobIfEligible,
  isBuilder1RecoverableTerminalError
} from '../src/utils/builder1RecoverableTerminalJob.js'
import {
  BUILDER1_ACTIVE_JOB_SESSION_KEY,
  readBuilder1ActiveJob,
  writeBuilder1ActiveJob,
  clearBuilder1ActiveJob
} from '../src/utils/builder1ActiveJob.js'
import {
  BUILDER1_PENDING_MUTATION_SESSION_KEY,
  readBuilder1PendingMutation,
  writeBuilder1PendingMutation,
  clearBuilder1PendingMutation
} from '../src/utils/builder1PendingMutation.js'
import {
  BUILDER1_RECOVER_JOB_QUERY_PARAM,
  isPlausibleBuilder1JobId,
  readBuilder1RecoverJobIdFromRoute,
  readBuilder1RecoverJobIdFromHash,
  stripBuilder1RecoverJobSearch,
  stripBuilder1RecoverJobIdFromHash,
  stripBuilder1RecoverJobFromRoute,
  hydrateBuilder1SessionFromStatusResult,
  reattachBuilder1Job
} from '../src/utils/builder1JobReattach.js'
import { createCampaignSessionFromInitial, validateInitialCampaignResponse } from '../src/utils/builder1Campaign.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const builder1PageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const builder1ApiSource = readFileSync(join(root, 'src/services/builder1Api.js'), 'utf8')
const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const reattachSource = readFileSync(join(root, 'src/utils/builder1JobReattach.js'), 'utf8')

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

const PRODUCTION_JOB_ID = '3be59e84-0937-4b32-be84-59989b266992'
const PRODUCTION_CAMPAIGN_ID = 'a66558ae-6ba7-4e2e-8deb-5e2d18499a41'

function makeRecoveredPartialResult() {
  return {
    ok: true,
    campaignId: PRODUCTION_CAMPAIGN_ID,
    campaign: {
      productNameResolved: 'Recovered Product',
      brandSlogan: 'Slogan',
      format: 'portrait',
      detectedLanguage: 'he',
      adCount: 2
    },
    ad: {
      index: 1,
      headline: 'Ad 1 Headline',
      marketingText: 'word '.repeat(50).trim(),
      imageBase64: 'recoveredImageBase64'
    },
    composition: { format: 'portrait', brandSlogan: 'Slogan' },
    ads: [
      {
        index: 1,
        headline: 'Ad 1 Headline',
        marketingText: 'word '.repeat(50).trim(),
        imageBase64: 'recoveredImageBase64'
      }
    ],
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

// 1. Terminal planning error stores recoverableTerminalJob
clearBuilder1RecoverableTerminalJob(sessionStorage)
clearBuilder1ActiveJob(sessionStorage)
const planningErr = Object.assign(new Error('planning failed'), { code: 'planning_failed' })
persistBuilder1RecoverableTerminalJobIfEligible(
  { jobId: PRODUCTION_JOB_ID, campaignId: PRODUCTION_CAMPAIGN_ID, err: planningErr },
  sessionStorage
)
const stored = readBuilder1RecoverableTerminalJob(sessionStorage)
assert.equal(stored?.jobId, PRODUCTION_JOB_ID)
assert.equal(stored?.campaignId, PRODUCTION_CAMPAIGN_ID)
assert.equal(BUILDER1_RECOVERABLE_TERMINAL_JOB_SESSION_KEY, 'ace.builder1.recoverableTerminalJob.v1')

// 2. Clears activeJob / pending mutation as before (recoverable is separate)
writeBuilder1ActiveJob({ jobId: 'active-job', operation: 'initial', startedAtMs: 1 }, sessionStorage)
writeBuilder1PendingMutation({ requestId: 'req-1', operation: 'initial', requestPayload: {} }, sessionStorage)
clearBuilder1ActiveJob(sessionStorage)
clearBuilder1PendingMutation(sessionStorage)
assert.equal(readBuilder1ActiveJob(sessionStorage), null)
assert.equal(readBuilder1PendingMutation(sessionStorage), null)
assert.ok(readBuilder1RecoverableTerminalJob(sessionStorage))

// 3. Recoverable terminal job is NOT cancelled on refresh/pagehide
const pagehideEffect =
  builder1PageSource.match(
    /useEffect\(\(\) => \{\r?\n    const onPageHide[\s\S]*?\}, \[\]\)/
  )?.[0] ?? ''
assert.match(pagehideEffect, /readBuilder1ActiveJob/)
assert.doesNotMatch(pagehideEffect, /readBuilder1RecoverableTerminalJob/)
assert.doesNotMatch(pagehideEffect, /recoverableTerminalJob/)
const mountEffect =
  builder1PageSource.match(
    /useEffect\(\(\) => \{\r?\n    ensureBuilder1OwnerContext\(\)[\s\S]*?\}, \[resetFreshBuilder1Ui, clearBuilder1RecoveryState\]\)/
  )?.[0] ?? ''
assert.doesNotMatch(mountEffect, /readBuilder1RecoverableTerminalJob/)
assert.doesNotMatch(mountEffect, /cancelBuilder1Job\(.*recoverable/i)

// 4. HashRouter URL parsing — route search preferred; document search ignored
assert.equal(BUILDER1_RECOVER_JOB_QUERY_PARAM, 'builder1RecoverJobId')
assert.ok(isPlausibleBuilder1JobId(PRODUCTION_JOB_ID))
assert.equal(
  readBuilder1RecoverJobIdFromRoute(
    `?builder1RecoverJobId=${PRODUCTION_JOB_ID}`,
    '#/builder'
  ),
  PRODUCTION_JOB_ID
)
assert.equal(
  readBuilder1RecoverJobIdFromHash(`#/builder?builder1RecoverJobId=${PRODUCTION_JOB_ID}`),
  PRODUCTION_JOB_ID
)
assert.equal(
  readBuilder1RecoverJobIdFromRoute('', `#/builder?builder1RecoverJobId=${PRODUCTION_JOB_ID}`),
  PRODUCTION_JOB_ID
)
assert.equal(readBuilder1RecoverJobIdFromRoute('', '#/builder'), null)
assert.equal(readBuilder1RecoverJobIdFromRoute('?builder1RecoverJobId=not-a-uuid', '#/builder'), null)
assert.equal(
  stripBuilder1RecoverJobSearch(`?builder1RecoverJobId=${PRODUCTION_JOB_ID}`),
  ''
)
assert.equal(
  stripBuilder1RecoverJobIdFromHash(`#/builder?builder1RecoverJobId=${PRODUCTION_JOB_ID}`),
  '#/builder'
)
assert.deepEqual(stripBuilder1RecoverJobFromRoute(`?builder1RecoverJobId=${PRODUCTION_JOB_ID}`, '#/builder'), {
  kind: 'search',
  value: ''
})
assert.doesNotMatch(reattachSource, /window\.location\.search.*builder1RecoverJobId/)
assert.match(builder1PageSource, /readBuilder1RecoverJobIdFromRoute/)
assert.match(builder1PageSource, /useLocation/)
assert.match(builder1PageSource, /stripBuilder1RecoverJobFromRoute|stripRecoveryQueryParam/)
assert.match(builder1PageSource, /BUILDER1_REATTACH_BOOTSTRAP/)
assert.match(builder1PageSource, /runBuilder1Reattach/)
const recoverBootstrapEffect =
  builder1PageSource.match(
    /useEffect\(\(\) => \{\r?\n    if \(cancellationGate !== 'ready'[\s\S]*?runBuilder1Reattach\(jobId[\s\S]*?\}, \[[\s\S]*?stripRecoveryQueryParam[\s\S]*?\]\)/
  )?.[0] ?? ''
assert.ok(recoverBootstrapEffect.length > 0, 'recover bootstrap effect present')
assert.doesNotMatch(recoverBootstrapEffect, /writeBuilder1ActiveJob|builder1Generate|cancelBuilder1Job/)
assert.doesNotMatch(recoverBootstrapEffect, /recoverBootstrapRef/)

// 5–7. DONE recovered status hydrates campaign session with partial counts
const result = makeRecoveredPartialResult()
const hydrated = hydrateBuilder1SessionFromStatusResult(result, 2)
assert.equal(hydrated.ok, true)
const session = hydrated.session
assert.equal(session.campaignId, PRODUCTION_CAMPAIGN_ID)
assert.equal(session.generatedCount, 1)
assert.equal(session.targetAdCount, 2)
assert.equal(session.nextAdIndex, 2)
assert.equal(session.canGenerateNext, true)
assert.equal(session.campaignComplete, false)
assert.equal(session.ads.length, 1)
assert.equal(session.ads[0].index, 1)
assert.ok(session.ads[0].imageSrc?.includes('recoveredImageBase64') || session.ads[0].imageBase64)

// 8–10. Reattachment makes zero POST generation / retry-image / cancel calls
const fetchCalls = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  const method = String(init.method ?? 'GET').toUpperCase()
  const path = String(url)
  fetchCalls.push({ method, path })
  if (path.includes('/api/builder1-status') || path.includes('/api/builder1/status')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'done',
        result: makeRecoveredPartialResult()
      })
    }
  }
  throw new Error(`Unexpected fetch: ${method} ${path}`)
}

const reattachOutcome = await reattachBuilder1Job(PRODUCTION_JOB_ID, { targetAdCount: 2 })
assert.equal(reattachOutcome.ok, true)
assert.equal(reattachOutcome.kind, 'done')
assert.equal(reattachOutcome.session.generatedCount, 1)
const postMutations = fetchCalls.filter(
  (c) =>
    c.method === 'POST' &&
    (c.path.includes('builder1-generate') ||
      c.path.includes('builder1-generate-next') ||
      c.path.includes('builder1-retry-image') ||
      c.path.includes('/cancel'))
)
assert.equal(postMutations.length, 0)
assert.ok(fetchCalls.every((c) => c.method === 'GET'))

globalThis.fetch = originalFetch

// 11. RUNNING recovered job uses read-only status/poll
assert.match(reattachSource, /pollBuilder1Job/)
assert.match(reattachSource, /builder1FetchStatus/)
assert.doesNotMatch(
  reattachSource.slice(reattachSource.indexOf('export async function reattachBuilder1Job')),
  /builder1Generate|builder1GenerateNext|builder1RetryImage|cancelBuilder1Job/
)

// 12. ERROR recovered job does not start a new campaign (reattach returns error payload)
globalThis.fetch = async (url) => {
  if (String(url).includes('builder1-status') || String(url).includes('builder1/status')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'error', error: 'planning_failed', message: 'still failed' })
    }
  }
  throw new Error('unexpected')
}
const stillError = await reattachBuilder1Job(PRODUCTION_JOB_ID, { targetAdCount: 2, pollIfRunning: false })
assert.equal(stillError.ok, false)
assert.equal(stillError.kind, 'error')
assert.equal(stillError.errorCode, 'planning_failed')
globalThis.fetch = originalFetch

// 13. RETRY with recoverable terminal job does not call initial generate
assert.match(builder1PageSource, /readBuilder1RecoverableTerminalJob/)
assert.match(builder1PageSource, /handleRetryInitial[\s\S]*handleResumePlanning/)
assert.match(builder1PageSource, /handleRetryInitial[\s\S]*runBuilder1Reattach/)
const retryBlock =
  builder1PageSource.match(/const handleRetryInitial = \(\) => \{[\s\S]*?\n  \}/)?.[0] ?? ''
assert.match(retryBlock, /readBuilder1RecoverableTerminalJob/)
assert.match(retryBlock, /isBuilder1PlanningResumeEligibleRecoverable/)
assert.doesNotMatch(retryBlock, /handleInitialSubmit\(formData\)[\s\S]*readBuilder1RecoverableTerminalJob/)

// 14. Explicit new campaign flow remains available separately
assert.match(builder1PageSource, /handleInitialSubmit/)
assert.match(builder1PageSource, /handleFormSubmit/)

// 15. Normal active-job refresh cancellation remains unchanged
assert.match(mountEffect, /cancelBuilder1Job\(jobId/)
assert.match(mountEffect, /readBuilder1ActiveJob/)
assert.equal(BUILDER1_ACTIVE_JOB_SESSION_KEY, 'ace.builder1.activeJob.v1')

// 16. Existing pendingMutation recovery remains unchanged
assert.match(mountEffect, /readBuilder1PendingMutation/)
assert.match(mountEffect, /replayBuilder1PendingMutation/)

// 17. Mount smoke test remains wired
const pkg = readFileSync(join(root, 'package.json'), 'utf8')
assert.match(pkg, /test-builder1-mount\.mjs/)

// 18. Per-ad DOWNLOAD ZIP unchanged
assert.match(builder1PageSource, /handleDownloadAdZip/)
assert.match(builder1PageSource, /builder1DownloadZip/)

// 19. CONSUMED unchanged — no recovery-specific consumed bypass
assert.doesNotMatch(
  builder1PageSource.match(/runBuilder1Reattach[\s\S]{0,800}/)?.[0] ?? '',
  /CONSUMED|consumed/
)

// 20. Builder2 untouched
assert.doesNotMatch(builder2PageSource, /builder1RecoverJobId|recoverableTerminalJob|reattachBuilder1Job/)
assert.doesNotMatch(builder1PageSource, /writeBuilder2ActiveJob|builder2FetchStatus/)

// Eligibility guards
assert.equal(isBuilder1RecoverableTerminalError({ code: 'planning_failed' }), true)
assert.equal(isBuilder1RecoverableTerminalError({ code: 'campaign_integrity_failed' }), true)
assert.equal(isBuilder1RecoverableTerminalError({ isOwnershipError: true, code: 'planning_failed' }), false)
assert.equal(
  persistBuilder1RecoverableTerminalJobIfEligible({ jobId: '', err: planningErr }, sessionStorage),
  null
)
assert.equal(
  persistBuilder1RecoverableTerminalJobIfEligible(
    { jobId: PRODUCTION_JOB_ID, err: { code: 'cancelled' } },
    sessionStorage
  ),
  null
)

// BuilderPage persists recoverable before clearing recovery state
assert.match(builder1PageSource, /persistBuilder1RecoverableTerminalJobIfEligible/)
assert.match(builder1PageSource, /lastKnownJobId/)

// Reattach clears recoverable on success
assert.match(builder1PageSource, /clearBuilder1RecoverableTerminalJob/)

// No hard-coded production job id in runtime sources
for (const src of [builder1PageSource, reattachSource, builder1ApiSource]) {
  assert.doesNotMatch(src, /3be59e84-0937-4b32-be84-59989b266992/)
}

clearBuilder1RecoverableTerminalJob(sessionStorage)

console.log('builder1 recovery tests passed (HashRouter + reattach cases)')
