/**
 * Builder2 pending initial-generate mutation + refresh safety tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER2_PENDING_MUTATION_SESSION_KEY,
  readBuilder2PendingMutation,
  writeBuilder2PendingMutation,
  clearBuilder2PendingMutation,
  isUnresolvedBuilder2PendingMutation,
  parseBuilder2PendingMutationRecord
} from '../src/utils/builder2PendingMutation.js'
import {
  createBuilder2RequestId,
  isValidBuilder2RequestId
} from '../src/utils/builder2RequestId.js'
import {
  isBuilder2IdempotencyConflict,
  isBuilder2IdempotencyInProgress,
  extractBuilder2InitialGenerateIds
} from '../src/utils/builder2Status.js'
import {
  buildBuilder2InitialGeneratePayload,
  buildBuilder2MutationHeaders
} from '../src/services/api.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const apiSource = readFileSync(join(root, 'src/services/api.js'), 'utf8')
const offlineSource = readFileSync(join(root, 'src/utils/builder2OfflinePlaceholders.js'), 'utf8')
const offlineTestSource = readFileSync(join(root, 'scripts/test-builder2-offline-placeholders.mjs'), 'utf8')

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

const mountEffect =
  builder2PageSource.match(
    /useEffect\(\(\) => \{\r?\n    ensureBuilder2OwnerContext\(\)[\s\S]*?\}, \[resetFreshGenerationUi\]\)/
  )?.[0] ?? ''

const initialGenerateBlock =
  builder2PageSource.match(
    /isProductionInitial[\s\S]{0,1200}?await generateVideo\(\{/
  )?.[0] ?? ''

assert.match(initialGenerateBlock, /writeBuilder2PendingMutation\(/)
const writeIdx = initialGenerateBlock.indexOf('writeBuilder2PendingMutation')
const generateIdx = initialGenerateBlock.indexOf('await generateVideo')
assert.ok(writeIdx >= 0 && generateIdx > writeIdx, 'pending mutation must precede generateVideo')

const requestId = createBuilder2RequestId()
assert.ok(isValidBuilder2RequestId(requestId))

const handleSubmitBlock = builder2PageSource

assert.match(apiSource, /X-ACE-Request-Id/)
assert.match(apiSource, /buildBuilder2MutationHeaders/)
const headers = buildBuilder2MutationHeaders(requestId)
assert.equal(headers['X-ACE-Request-Id'], requestId)

assert.match(apiSource, /replayBuilder2PendingMutation/)
assert.match(apiSource, /requestId: pending\.requestId/)

const clearPendingIdx = builder2PageSource.indexOf('clearBuilder2PendingMutation()')
const activeJobBeforeClear =
  builder2PageSource.indexOf('writeBuilder2ActiveJob({ jobId })') <
  builder2PageSource.lastIndexOf('clearBuilder2PendingMutation()')
assert.ok(activeJobBeforeClear)

writeBuilder2PendingMutation(
  {
    requestId,
    operation: 'initial_generate',
    requestPayload: {
      productName: 'Test',
      productDescription: 'Desc',
      targetVideoCount: 1
    },
    createdAtMs: Date.now()
  },
  sessionStorage
)
const stored = readBuilder2PendingMutation(sessionStorage)
assert.equal(stored?.requestId, requestId)
assert.equal(BUILDER2_PENDING_MUTATION_SESSION_KEY, 'ace.builder2.pendingMutation.v1')
assert.match(mountEffect, /readBuilder2PendingMutation/)
assert.match(mountEffect, /replayBuilder2PendingMutation/)
assert.match(mountEffect, /isUnresolvedBuilder2PendingMutation/)

assert.deepEqual(extractBuilder2InitialGenerateIds({ jobId: 'job-a', videoAllowanceId: 'allow-1' }), {
  jobId: 'job-a',
  videoAllowanceId: 'allow-1'
})

assert.match(mountEffect, /cancelBuilder2Job/)
assert.match(mountEffect, /isBuilder2CancelAcknowledged/)
assert.doesNotMatch(mountEffect, /generateVideoNext/)

assert.match(builder2PageSource, /readBuilder2PendingMutation\(\)/)
assert.match(builder2PageSource, /hasPendingMutation/)
assert.match(mountEffect, /BUILDER2_MSG_RECOVERY_BLOCKED/)
assert.match(mountEffect, /setCancellationGate\('blocked'\)/)

assert.match(mountEffect, /readBuilder2ActiveJob/)
assert.match(mountEffect, /if \(!activeJob\?\.jobId\)/)

assert.ok(isBuilder2IdempotencyConflict({ error: 'builder2_idempotency_conflict' }, 409))
assert.ok(isBuilder2IdempotencyInProgress({ error: 'builder2_idempotency_in_progress' }, 409))

assert.match(handleSubmitBlock, /isIdempotencyConflict/)
assert.match(handleSubmitBlock, /BUILDER2_MSG_IDEMPOTENCY_CONFLICT/)

assert.match(handleSubmitBlock, /isProductionInitial/)
assert.match(handleSubmitBlock, /isBuilder2OfflinePlaceholderTransportActive/)
assert.match(handleSubmitBlock, /isPreview2Builder2OfflinePlaceholderActive/)
assert.doesNotMatch(offlineSource, /writeBuilder2PendingMutation/)
assert.doesNotMatch(offlineSource, /BUILDER2_PENDING_MUTATION/)

const payload = buildBuilder2InitialGeneratePayload({
  productName: 'A',
  productDescription: 'B',
  targetVideoCount: 2
})
assert.deepEqual(payload, {
  productName: 'A',
  productDescription: 'B',
  targetVideoCount: 2
})

const parsed = parseBuilder2PendingMutationRecord({
  v: 1,
  requestId,
  operation: 'initial_generate',
  createdAtMs: 1,
  requestPayload: { productName: 'x', productDescription: 'y', targetVideoCount: 2 }
})
assert.equal(parsed?.operation, 'initial_generate')
assert.equal(isUnresolvedBuilder2PendingMutation(parsed), true)

clearBuilder2PendingMutation(sessionStorage)
assert.equal(readBuilder2PendingMutation(sessionStorage), null)

assert.match(offlineTestSource, /test-builder2-offline-placeholders/)

assert.match(apiSource, /async function generateVideoNext/)
assert.doesNotMatch(
  apiSource.match(/async function generateVideoNext[\s\S]*?\n\}/)?.[0] ?? '',
  /X-ACE-Request-Id|requestId/
)

console.log('test-builder2-pending-mutation.mjs: passed')
