/**
 * Builder1 X-ACE-Request-Id idempotency tests.
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
  BUILDER1_PENDING_MUTATION_SESSION_KEY,
  readBuilder1PendingMutation,
  writeBuilder1PendingMutation,
  clearBuilder1PendingMutation,
  isUnresolvedBuilder1PendingMutation
} from '../src/utils/builder1PendingMutation.js'
import {
  BUILDER1_ACTIVE_JOB_SESSION_KEY,
  clearBuilder1ActiveJob
} from '../src/utils/builder1ActiveJob.js'
import {
  isBuilder1IdempotencyConflict,
  isBuilder1IdempotentReplay,
  extractBuilder1MutationJobIds,
  isBuilder1CampaignAuthoritativelyReady
} from '../src/utils/builder1Status.js'
import {
  buildBuilder1MutationHeaders,
  callBuilder1MutationWithRetry,
  BUILDER1_MUTATION_RETRY_MAX_ATTEMPTS
} from '../src/services/builder1Api.js'
import { ensureBuilder1OwnerContext } from '../src/utils/builder1OwnerContext.js'
import {
  BUILDER1_INITIAL_ESTIMATED_DURATION_MS,
  BUILDER1_PROGRESS_OVERDUE_TEXT_HE,
  getBuilder1RemainingTimeText
} from '../src/utils/builder1Progress.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const builder1PageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const builder1ApiSource = readFileSync(join(root, 'src/services/builder1Api.js'), 'utf8')
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

const sessionStorage = new MemoryStorage()
const localStorage = new MemoryStorage()

// 1–2. requestId is UUID and sent as header
const requestId = createBuilder1RequestId()
assert.ok(isValidBuilder1RequestId(requestId))
globalThis.localStorage = localStorage
ensureBuilder1OwnerContext(localStorage)
const mutationHeaders = buildBuilder1MutationHeaders(requestId, { 'Content-Type': 'application/json' })
assert.equal(mutationHeaders['X-ACE-Request-Id'], requestId)
assert.ok(mutationHeaders['X-ACE-Batch-State'])

// 3–5. pending mutation persisted before fetch; same replay identity
const payload = { productName: 'Test', adCount: 2, format: 'portrait' }
writeBuilder1PendingMutation(
  {
    requestId,
    operation: 'initial',
    requestPayload: payload,
    createdAtMs: 1000,
    jobId: null,
    campaignId: null
  },
  sessionStorage
)
const stored = readBuilder1PendingMutation(sessionStorage)
assert.equal(stored?.requestId, requestId)
assert.deepEqual(stored?.requestPayload, payload)
assert.equal(BUILDER1_PENDING_MUTATION_SESSION_KEY, 'ace.builder1.pendingMutation.v1')

const initialSubmitBlock = builder1PageSource.slice(
  builder1PageSource.indexOf('const handleInitialSubmit'),
  builder1PageSource.indexOf('const handleGenerateNextAd')
)
const writeIdx = initialSubmitBlock.indexOf('writeBuilder1PendingMutation')
const fetchIdx = initialSubmitBlock.indexOf('callBuilder1MutationWithRetry')
assert.ok(writeIdx >= 0 && fetchIdx >= 0 && writeIdx < fetchIdx, 'pending mutation before POST')

// 6–7. response loss does not mint second requestId
assert.match(initialSubmitBlock, /callBuilder1MutationWithRetry/)
assert.match(initialSubmitBlock, /builder1Generate\(requestBody, \{ requestId \}\)/)
assert.doesNotMatch(
  initialSubmitBlock.slice(initialSubmitBlock.indexOf('writeBuilder1PendingMutation')),
  /createBuilder1RequestId\(\)[\s\S]*createBuilder1RequestId\(\)/
)

// 8–13. refresh-before-jobId mount recovery
const mountEffect =
  builder1PageSource.match(
    /useEffect\(\(\) => \{\r?\n    ensureBuilder1OwnerContext\(\)[\s\S]*?\}, \[resetFreshBuilder1Ui, clearBuilder1RecoveryState\]\)/
  )?.[0] ?? ''
assert.match(mountEffect, /readBuilder1PendingMutation/)
assert.match(mountEffect, /replayBuilder1PendingMutation/)
assert.match(mountEffect, /cancelBuilder1Job\(jobId, \{ reason: 'frontend_refresh' \}/)
assert.match(mountEffect, /clearBuilder1RecoveryState/)
assert.doesNotMatch(mountEffect, /pollBuilder1Job/)

// 14. Generate blocked during pending recovery
assert.match(builder1PageSource, /readBuilder1PendingMutation\(\)/)
assert.match(builder1PageSource, /Boolean\(readBuilder1PendingMutation\(\)\)/)

// 15–16. pagehide behavior
const pagehideEffect =
  builder1PageSource.match(
    /useEffect\(\(\) => \{\r?\n    const onPageHide[\s\S]*?\}, \[\]\)/
  )?.[0] ?? ''
assert.match(pagehideEffect, /readBuilder1ActiveJob/)
assert.match(pagehideEffect, /cancelBuilder1JobKeepalive/)
assert.doesNotMatch(pagehideEffect, /readBuilder1PendingMutation/)

// 17–18. generate-next request id + recovery
const nextAdBlock = builder1PageSource.slice(
  builder1PageSource.indexOf('const handleGenerateNextAd'),
  builder1PageSource.indexOf('const handleFormSubmit')
)
assert.match(nextAdBlock, /createBuilder1RequestId\(\)/)
assert.match(nextAdBlock, /writeBuilder1PendingMutation/)
assert.match(nextAdBlock, /builder1GenerateNext\(mutationPayload, \{ requestId \}\)/)
assert.match(nextAdBlock, /builder1RepairPhysical\(mutationPayload, \{ requestId \}\)/)
assert.match(nextAdBlock, /callBuilder1MutationWithRetry\(invokeMutation\)/)

// 19–20. 409 conflict + idempotentReplay
assert.ok(isBuilder1IdempotencyConflict({ error: 'builder1_idempotency_conflict' }, 409))
assert.ok(!isBuilder1IdempotencyConflict({ error: 'other' }, 409))
assert.match(builder1PageSource, /handleBuilder1IdempotencyConflict/)
assert.match(builder1PageSource, /BUILDER1_MSG_IDEMPOTENCY_CONFLICT/)
assert.ok(isBuilder1IdempotentReplay({ idempotentReplay: true, jobId: 'J1' }))
const extracted = extractBuilder1MutationJobIds({
  idempotentReplay: true,
  jobId: 'job-replay-1',
  campaignId: 'camp-1'
})
assert.equal(extracted.jobId, 'job-replay-1')
assert.equal(extracted.idempotentReplay, true)

// 21. polling does not alter mutation requestId
assert.doesNotMatch(
  builder1ApiSource.slice(builder1ApiSource.indexOf('export async function pollBuilder1Job')),
  /X-ACE-Request-Id|createBuilder1RequestId/
)

// 22. terminal success clears pending + active
assert.match(builder1PageSource, /clearBuilder1PendingMutation\(\)/)
assert.match(builder1PageSource, /clearBuilder1RecoveryState/)

// 23. ownership headers on mutations
assert.match(builder1ApiSource, /buildBuilder1MutationHeaders/)
assert.match(builder1ApiSource, /X-ACE-Batch-State/)

// 24–25. progress/countdown unchanged
assert.match(progressBarSource, /Date\.now\(\) - jobStartTimeMsRef\.current/)
assert.equal(getBuilder1RemainingTimeText(0, BUILDER1_INITIAL_ESTIMATED_DURATION_MS), '12:00')

// 26. campaignReady helper unchanged
assert.equal(isBuilder1CampaignAuthoritativelyReady({ generatedCount: 2, targetAdCount: 2, campaignReady: false }), false)

// 27. ZIP unchanged — no request id on zip
assert.match(builder1ApiSource, /builder1DownloadZip/)
assert.doesNotMatch(
  builder1ApiSource.slice(
    builder1ApiSource.indexOf('export async function builder1DownloadZip'),
    builder1ApiSource.indexOf('export async function pollBuilder1Job')
  ),
  /X-ACE-Request-Id/
)

// 28. Builder2 isolation
assert.doesNotMatch(builder2PageSource, /builder1PendingMutation|builder1RequestId|X-ACE-Request-Id/i)
assert.doesNotMatch(builder1PageSource, /builder2RequestId|writeBuilder2ActiveJob/i)
assert.notEqual(BUILDER1_PENDING_MUTATION_SESSION_KEY, BUILDER1_ACTIVE_JOB_SESSION_KEY)

// API exposes retry/repair with requestId
assert.match(builder1ApiSource, /builder1RetryImage/)
assert.match(builder1ApiSource, /builder1RepairPhysical/)

// Mutation retry bounded
assert.equal(BUILDER1_MUTATION_RETRY_MAX_ATTEMPTS, 4)
let attempts = 0
await assert.rejects(
  () =>
    callBuilder1MutationWithRetry(async () => {
      attempts += 1
      throw new (await import('../src/services/api.js')).NetworkError('fail')
    }, { maxAttempts: 3, baseDelayMs: 1 }),
  (err) => err instanceof Error && err.message === 'fail'
)
assert.equal(attempts, 3)

clearBuilder1PendingMutation(sessionStorage)
clearBuilder1ActiveJob(sessionStorage)
assert.equal(readBuilder1PendingMutation(sessionStorage), null)
assert.equal(isUnresolvedBuilder1PendingMutation(null), false)

console.log('builder1 request-id idempotency tests passed (28 cases)')
