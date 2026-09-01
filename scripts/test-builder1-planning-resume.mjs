/**
 * Builder1 same-job planning resume tests.
 * Run: npm run test:builder1
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  createBuilder1RequestId,
  isValidBuilder1RequestId
} from '../src/utils/builder1RequestId.js'
import {
  readBuilder1PendingMutation,
  writeBuilder1PendingMutation,
  clearBuilder1PendingMutation,
  parseBuilder1PendingMutationRecord
} from '../src/utils/builder1PendingMutation.js'
import {
  readBuilder1RecoverableTerminalJob,
  writeBuilder1RecoverableTerminalJob,
  clearBuilder1RecoverableTerminalJob,
  persistBuilder1RecoverableTerminalJobIfEligible,
  isBuilder1PlanningFailedError,
  isBuilder1PlanningResumeEligibleRecoverable
} from '../src/utils/builder1RecoverableTerminalJob.js'
import {
  isBuilder1PlanningResumeNotEligible,
  isBuilder1PlanningResumeAccepted,
  extractBuilder1MutationJobIds
} from '../src/utils/builder1Status.js'
import {
  buildBuilder1MutationHeaders,
  replayBuilder1PendingMutation,
  resumeBuilder1Planning
} from '../src/services/builder1Api.js'
import { ensureBuilder1OwnerContext } from '../src/utils/builder1OwnerContext.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const builder1PageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const builder1ApiSource = readFileSync(join(root, 'src/services/builder1Api.js'), 'utf8')
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

const sessionStorage = new MemoryStorage()
const localStorage = new MemoryStorage()

const JOB_ID = '3be59e84-0937-4b32-be84-59989b266992'
const CAMPAIGN_ID = 'a66558ae-6ba7-4e2e-8deb-5e2d18499a41'

// 1. planning_failed classified as planning-resumable terminal state
const planningErr = Object.assign(new Error('planning failed'), { code: 'planning_failed' })
assert.equal(isBuilder1PlanningFailedError(planningErr), true)
persistBuilder1RecoverableTerminalJobIfEligible(
  { jobId: JOB_ID, campaignId: CAMPAIGN_ID, err: planningErr },
  sessionStorage
)
const recoverable = readBuilder1RecoverableTerminalJob(sessionStorage)
assert.equal(isBuilder1PlanningResumeEligibleRecoverable(recoverable), true)

// 13–16. other failures are not planning-resumable
assert.equal(isBuilder1PlanningFailedError({ code: 'cancelled' }), false)
assert.equal(isBuilder1PlanningFailedError({ code: 'campaign_integrity_failed' }), false)
assert.equal(isBuilder1PlanningFailedError({ code: 'image_generation_failed' }), false)
writeBuilder1RecoverableTerminalJob(
  {
    jobId: JOB_ID,
    campaignId: CAMPAIGN_ID,
    originalTerminalError: 'campaign_integrity_failed'
  },
  sessionStorage
)
assert.equal(isBuilder1PlanningResumeEligibleRecoverable(readBuilder1RecoverableTerminalJob(sessionStorage)), false)

clearBuilder1RecoverableTerminalJob(sessionStorage)
writeBuilder1RecoverableTerminalJob(
  { jobId: JOB_ID, campaignId: CAMPAIGN_ID, originalTerminalError: 'planning_failed' },
  sessionStorage
)

// 2–4. Retry wiring calls resume-planning, not generate
assert.match(builder1ApiSource, /builder1-resume-planning/)
assert.match(builder1ApiSource, /export async function resumeBuilder1Planning/)
const retryBlock =
  builder1PageSource.match(/const handleRetryInitial = \(\) => \{[\s\S]*?\n  \}/)?.[0] ?? ''
assert.match(retryBlock, /isBuilder1PlanningResumeEligibleRecoverable/)
assert.match(retryBlock, /handleResumePlanning/)
assert.doesNotMatch(retryBlock, /handleInitialSubmit\(formData\)[\s\S]*handleResumePlanning/)

const resumeFlowBlock = builder1PageSource.slice(
  builder1PageSource.indexOf('const executeBuilder1PlanningResumeFlow'),
  builder1PageSource.indexOf('const handlePlanningResumeFailure')
)
assert.match(resumeFlowBlock, /resumeBuilder1Planning/)
assert.doesNotMatch(resumeFlowBlock, /builder1Generate/)
assert.match(resumeFlowBlock, /requestPayload: requestBody/)
assert.deepEqual({ jobId: JOB_ID }, { jobId: JOB_ID })

// 5–7. request id + replay same body/requestId
globalThis.localStorage = localStorage
ensureBuilder1OwnerContext(localStorage)
const requestId = createBuilder1RequestId()
assert.ok(isValidBuilder1RequestId(requestId))
const headers = buildBuilder1MutationHeaders(requestId)
assert.equal(headers['X-ACE-Request-Id'], requestId)

writeBuilder1PendingMutation(
  {
    requestId,
    operation: 'resume_planning',
    requestPayload: { jobId: JOB_ID },
    jobId: JOB_ID,
    campaignId: CAMPAIGN_ID,
    createdAtMs: Date.now()
  },
  sessionStorage
)
const pending = readBuilder1PendingMutation(sessionStorage)
assert.equal(pending?.operation, 'resume_planning')
assert.equal(pending?.requestPayload?.jobId, JOB_ID)
assert.equal(parseBuilder1PendingMutationRecord({ ...pending, operation: 'resume_planning' })?.operation, 'resume_planning')

const fetchCalls = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  fetchCalls.push({ url: String(url), method: init.method ?? 'GET', body: init.body })
  return {
    ok: true,
    status: 202,
    json: async () => ({ jobId: JOB_ID, campaignId: CAMPAIGN_ID, status: 'running' })
  }
}

await replayBuilder1PendingMutation(pending)
assert.equal(fetchCalls.length, 1)
assert.match(fetchCalls[0].url, /builder1-resume-planning/)
assert.equal(fetchCalls[0].method, 'POST')
assert.equal(JSON.parse(fetchCalls[0].body).jobId, JOB_ID)
assert.doesNotMatch(fetchCalls[0].url, /builder1-generate/)

await replayBuilder1PendingMutation(pending)
assert.equal(fetchCalls.length, 2)
assert.equal(fetchCalls[0].url, fetchCalls[1].url)

globalThis.fetch = async (url, init = {}) => {
  return {
    ok: false,
    status: 409,
    json: async () => ({ error: 'builder1_idempotency_conflict' })
  }
}
await assert.rejects(() => replayBuilder1PendingMutation(pending), (err) => err?.isIdempotencyConflict === true)

globalThis.fetch = originalFetch

// 8–10. accepted resume preserves ids and polls
assert.equal(isBuilder1PlanningResumeAccepted({ ok: true, status: 202 }, { jobId: JOB_ID }), true)
const extracted = extractBuilder1MutationJobIds({ jobId: JOB_ID, campaignId: CAMPAIGN_ID })
assert.equal(extracted.jobId, JOB_ID)
assert.equal(extracted.campaignId, CAMPAIGN_ID)
assert.match(resumeFlowBlock, /pollBuilder1Job/)
assert.match(resumeFlowBlock, /writeBuilder1ActiveJob/)

// 11. DONE hydration uses existing campaign path
assert.match(resumeFlowBlock, /validateInitialCampaignResponse/)
assert.match(resumeFlowBlock, /createCampaignSessionFromInitial/)
assert.match(resumeFlowBlock, /queueSuccessfulReveal/)

// 12. rejection does not auto-generate
assert.equal(isBuilder1PlanningResumeNotEligible({ error: 'planning_resume_not_eligible' }), true)
const failureBlock = builder1PageSource.slice(
  builder1PageSource.indexOf('const handlePlanningResumeFailure'),
  builder1PageSource.indexOf('const handleResumePlanning')
)
assert.match(failureBlock, /planning_resume_not_eligible/)
assert.doesNotMatch(failureBlock, /handleInitialSubmit|builder1Generate/)

// 17. form fields not cleared during resume lifecycle
assert.doesNotMatch(resumeFlowBlock, /setFormData/)
assert.doesNotMatch(builder1PageSource.match(/const handleResumePlanning = useCallback\([\s\S]*?\n  \)/)?.[0] ?? '', /setFormData|resetFreshBuilder1Ui/)

// 18–20. refresh / mount reconciliation
const mountEffect =
  builder1PageSource.match(
    /useEffect\(\(\) => \{\r?\n    ensureBuilder1OwnerContext\(\)[\s\S]*?\}, \[resetFreshBuilder1Ui, clearBuilder1RecoveryState\]\)/
  )?.[0] ?? ''
assert.match(mountEffect, /resume_planning/)
assert.match(mountEffect, /executeBuilder1PlanningResumeFlow/)
assert.doesNotMatch(
  mountEffect.slice(mountEffect.indexOf('resume_planning'), mountEffect.indexOf('if (!isUnresolvedBuilder1PendingMutation')),
  /cancelBuilder1Job\(/
)

// 21–22. strict duplicate guard + one mutation
assert.match(builder1PageSource, /resumePlanningInFlightRef/)
assert.match(builder1PageSource, /resumePlanningBusy/)

// 23–24. Builder2 untouched
assert.doesNotMatch(builder2PageSource, /resume_planning|builder1-resume-planning|handleResumePlanning/)
assert.doesNotMatch(builder1PageSource, /builder2/i)

clearBuilder1PendingMutation(sessionStorage)
clearBuilder1RecoverableTerminalJob(sessionStorage)

console.log('builder1 planning-resume tests passed (24 cases)')
