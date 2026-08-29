/**
 * Builder2 ownership propagation in video-status polling tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER2_OWNER_CONTEXT_STORAGE_KEY,
  ensureBuilder2OwnerContext,
  readBuilder2OwnerContext,
  getBuilder2OwnerBatchStateHeader
} from '../src/utils/builder2OwnerContext.js'
import {
  getBuilder2OwnershipErrorCode,
  isBuilder2OwnershipPollFailure,
  isTransientBuilder2PollFailure
} from '../src/utils/builder2Status.js'
import { buildBuilder2RequestHeaders } from '../src/services/api.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const apiSource = readFileSync(join(root, 'src/services/api.js'), 'utf8')
const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const builder1PageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')

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

const storage = new MemoryStorage()

// A. Builder2 generate uses owner context
assert.match(apiSource, /generateVideo[\s\S]*buildBuilder2RequestHeaders/)

// B. Builder2 video-status uses SAME owner context helper
const fetchBlock =
  apiSource.match(/async function fetchVideoStatus[\s\S]*?\n\}/)?.[0] ?? ''
assert.match(fetchBlock, /buildBuilder2RequestHeaders\(\)/)
assert.match(fetchBlock, /video-status/)
assert.doesNotMatch(fetchBlock, /Authorization/)

const owner = ensureBuilder2OwnerContext(storage)
const generateHeaders = buildBuilder2RequestHeaders({ 'Content-Type': 'application/json' })
const pollHeaders = buildBuilder2RequestHeaders()
assert.equal(generateHeaders['X-ACE-Batch-State'], pollHeaders['X-ACE-Batch-State'])
assert.match(generateHeaders['X-ACE-Batch-State'], /"ownerId"/)

const persistedHeader = getBuilder2OwnerBatchStateHeader(storage)
assert.match(persistedHeader, new RegExp(owner.ownerId))
assert.equal(persistedHeader, getBuilder2OwnerBatchStateHeader(storage))

// C. Stable across repeated polls
const pollA = getBuilder2OwnerBatchStateHeader(storage)
const pollB = getBuilder2OwnerBatchStateHeader(storage)
const pollC = getBuilder2OwnerBatchStateHeader(storage)
assert.equal(pollA, pollB)
assert.equal(pollB, pollC)

// D. Refresh/recovery — persisted owner context in localStorage
ensureBuilder2OwnerContext(storage)
const afterRefresh = readBuilder2OwnerContext(storage)
assert.ok(afterRefresh?.ownerId)
assert.equal(BUILDER2_OWNER_CONTEXT_STORAGE_KEY, 'ace.ownerContext.v1')
assert.match(builder2PageSource, /ensureBuilder2OwnerContext/)
assert.match(builder2PageSource, /fetchVideoStatus\(jobId/)

// E. 403 stops polling safely
assert.ok(isBuilder2OwnershipPollFailure({ httpStatus: 403, error: 'ownership_mismatch' }))
assert.ok(isBuilder2OwnershipPollFailure({ httpStatus: 403, ok: false, error: 'ownership_required' }))
assert.ok(isBuilder2OwnershipPollFailure({ status: 'error', error: 'ownership_mismatch' }))
assert.equal(getBuilder2OwnershipErrorCode({ httpStatus: 403, error: 'Forbidden' }), 'ownership_mismatch')
assert.ok(!isTransientBuilder2PollFailure({ httpStatus: 403, status: 'error', error: 'ownership_mismatch' }))
assert.match(builder2PageSource, /isBuilder2OwnershipPollFailure\(st\)/)
assert.match(
  builder2PageSource.match(/isBuilder2OwnershipPollFailure\(st\)[\s\S]{0,200}/)?.[0] ?? '',
  /break/
)
assert.match(builder2PageSource, /ownershipError/)
assert.doesNotMatch(
  builder2PageSource.match(/isBuilder2OwnershipPollFailure\(st\)[\s\S]{0,300}/)?.[0] ?? '',
  /generateVideo|resumeBuilder2Job/
)

// F. Builder1 unchanged — job-status without Builder2 owner headers
assert.match(apiSource, /getJobStatus/)
assert.doesNotMatch(
  apiSource.match(/async function getJobStatus[\s\S]*?\n\}/)?.[0] ?? '',
  /buildBuilder2RequestHeaders|X-ACE-Batch-State/
)
assert.doesNotMatch(builder1PageSource, /fetchVideoStatus|buildBuilder2RequestHeaders|builder2OwnerContext/)

console.log('builder2 ownership poll tests passed')
