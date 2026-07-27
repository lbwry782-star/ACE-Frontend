/**
 * Builder2 durable recovery tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER2_OWNER_CONTEXT_STORAGE_KEY,
  ensureBuilder2OwnerContext,
  getBuilder2OwnerBatchStateHeader,
  readBuilder2OwnerContext
} from '../src/utils/builder2OwnerContext.js'
import {
  BUILDER2_CURRENT_JOB_STORAGE_KEY,
  BUILDER2_RESUME_CONTRACT_VERSION,
  readBuilder2CurrentJob,
  writeBuilder2CurrentJob,
  clearBuilder2CurrentJob,
  updateBuilder2CurrentJobFromStatus,
  parseBuilder2CurrentJobRecord
} from '../src/utils/builder2JobPersistence.js'
import {
  resolveBuilder2FinalVideoUrl,
  canBuilder2StatusResume,
  isBuilder2ResumeAlreadyInProgress,
  isBuilder2StatusCompleted,
  isTransientBuilder2PollFailure,
  getBuilder2OwnershipErrorCode,
  buildBuilder2VideoResult,
  BUILDER2_MSG_RESTORING,
  BUILDER2_MSG_DISCONNECTED,
  BUILDER2_MSG_RESUME,
  BUILDER2_MSG_NEW_VIDEO
} from '../src/utils/builder2Status.js'
import {
  reconcileBuilder2JobTiming,
  getBuilder2ElapsedSeconds,
  clearAllBuilder2JobStartTimes,
  getBuilder2StageLabel,
  mergeBuilder2ProgressWithStageFloor,
  BUILDER2_PROGRESS_PENDING_URL_CAP,
  resolveBuilder2ProgressFrame
} from '../src/utils/builder2Progress.js'
import { buildBuilder2RequestHeaders } from '../src/services/api.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const apiSource = readFileSync(join(root, 'src/services/api.js'), 'utf8')
const builder1PageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const videoAdCardSource = readFileSync(join(root, 'src/components/VideoAdCard/VideoAdCard.jsx'), 'utf8')

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

function approx(actual, expected, tolerance = 0.05) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ~${expected}, got ${actual}`)
}

// 1. Stable owner context survives refresh
const first = ensureBuilder2OwnerContext(storage)
const second = ensureBuilder2OwnerContext(storage)
assert.equal(first.ownerId, second.ownerId)
assert.equal(readBuilder2OwnerContext(storage)?.ownerId, first.ownerId)

// 2. Owner header identical on create/status/resume wiring
assert.match(apiSource, /buildBuilder2RequestHeaders/)
assert.match(apiSource, /generateVideo[\s\S]*buildBuilder2RequestHeaders/)
assert.match(apiSource, /fetchVideoStatus[\s\S]*buildBuilder2RequestHeaders/)
assert.match(apiSource, /resumeBuilder2Job[\s\S]*buildBuilder2RequestHeaders/)
const headerA = getBuilder2OwnerBatchStateHeader(storage)
const headerB = getBuilder2OwnerBatchStateHeader(storage)
assert.equal(headerA, headerB)
assert.doesNotMatch(headerA, /productName|description/i)

// 3. jobId persists immediately after creation
clearBuilder2CurrentJob(storage)
const job = writeBuilder2CurrentJob(
  { jobId: 'job-123', createdAt: '2026-01-01T00:00:00.000Z' },
  storage
)
assert.equal(job?.jobId, 'job-123')
assert.equal(readBuilder2CurrentJob(storage)?.jobId, 'job-123')
assert.match(builder2PageSource, /writeBuilder2CurrentJob/)

// 4–6. Refresh restore wiring (active/completed/failed resumable)
assert.match(builder2PageSource, /readBuilder2CurrentJob/)
assert.match(builder2PageSource, /BUILDER2_MSG_RESTORING/)
assert.match(builder2PageSource, /restorePhase/)
assert.match(builder2PageSource, /canBuilder2StatusResume/)
assert.match(builder2PageSource, /BUILDER2_MSG_RESUME/)

// 7. Refresh never submits generate-video automatically
assert.match(builder2PageSource, /readBuilder2CurrentJob\(\)\?\.jobId/)
const restoreEffect = builder2PageSource.match(/useEffect\(\(\) => \{[\s\S]*?ensureBuilder2OwnerContext[\s\S]*?\}, \[/)?.[0] ?? ''
assert.doesNotMatch(restoreEffect, /generateVideo/)

// 8–9. Network disconnect retains job and reconnect polls only
assert.match(builder2PageSource, /BUILDER2_MSG_DISCONNECTED/)
assert.match(builder2PageSource, /isTransientBuilder2PollFailure/)
assert.doesNotMatch(
  builder2PageSource.match(/isTransientBuilder2PollFailure[\s\S]{0,400}/)?.[0] ?? '',
  /generateVideo|resumeBuilder2Job/
)

// 10–12. Resume same jobId + owner, never replacement job
assert.match(apiSource, /builder2-resume/)
assert.match(apiSource, /jobId: String\(jobId\)/)
assert.match(builder2PageSource, /resumeBuilder2Job\(jobId\)/)
assert.doesNotMatch(
  builder2PageSource.match(/handleResume[\s\S]*?finally/)?.[0] ?? '',
  /generateVideo/
)

// 13–14. Duplicate resume blocked; resumeAlreadyInProgress continues polling
assert.match(builder2PageSource, /resumeInFlight/)
assert.match(builder2PageSource, /isBuilder2ResumeAlreadyInProgress/)
assert.ok(isBuilder2ResumeAlreadyInProgress({ resumeAlreadyInProgress: true }))

// 15. Completed resume restores result immediately
assert.match(builder2PageSource, /immediate:\s*true/)

// 16. Ownership failure does not create new job
const ownership = getBuilder2OwnershipErrorCode({ error: 'ownership_mismatch' })
assert.equal(ownership, 'ownership_mismatch')
assert.doesNotMatch(
  builder2PageSource.match(/getBuilder2OwnershipErrorCode[\s\S]{0,500}/)?.[0] ?? '',
  /generateVideo/
)

// 17–18. progressStartedAt survives refresh; resume does not reset elapsed
clearAllBuilder2JobStartTimes()
const startedAtIso = '2026-01-01T00:00:00.000Z'
const timing = reconcileBuilder2JobTiming('job-elapsed', {
  progressStartedAt: startedAtIso,
  elapsedSeconds: 900
})
const afterRefresh = reconcileBuilder2JobTiming('job-elapsed', {
  progressStartedAt: startedAtIso,
  elapsedSeconds: 900
})
assert.equal(afterRefresh.startMs, timing.startMs)
approx(getBuilder2ElapsedSeconds(afterRefresh, timing.serverElapsedAtMs + 60_000), 960, 2)

// 19. LTR fill in RTL page wiring preserved
assert.match(readFileSync(join(root, 'src/components/ProgressBar/builder2-progress.css'), 'utf8'), /direction:\s*ltr/)

// 20–21. Progress never 100% without URL; completed without URL stays at 99%
assert.ok(
  resolveBuilder2ProgressFrame({ elapsedSeconds: 5000, previousPercent: 0, pendingFinalUrl: true }) <=
    BUILDER2_PROGRESS_PENDING_URL_CAP
)
assert.ok(
  resolveBuilder2ProgressFrame({ elapsedSeconds: 5000, previousPercent: 0, pendingFinalUrl: true }) < 100
)

// 22–23. finalVideoWithClosureUrl precedence; raw runway not preferred
const withClosure = resolveBuilder2FinalVideoUrl({
  videoUrl: 'https://runway.example/raw.mp4',
  finalVideoUrl: 'https://cdn.example/final.mp4',
  finalVideoWithClosureUrl: 'https://cdn.example/closure.mp4'
})
assert.equal(withClosure, 'https://cdn.example/closure.mp4')
const onlyRunway = resolveBuilder2FinalVideoUrl({
  videoUrl: 'https://runway.example/raw.mp4'
})
assert.equal(onlyRunway, 'https://runway.example/raw.mp4')

// 24. Advertising closure stage labels
assert.equal(getBuilder2StageLabel('advertising_closure'), 'מכין את הסגירה הפרסומית')
assert.equal(getBuilder2StageLabel('rendering_advertising_closure'), 'מוסיף שם מוצר וסלוגן')

// 25–26. Video player + download after refresh
assert.match(builder2PageSource, /videoResult/)
assert.match(videoAdCardSource, /DOWNLOAD ZIP/)
assert.match(builder2PageSource, /onPlaybackError/)

// 27. Playback failure refetches status
assert.match(builder2PageSource, /handlePlaybackError/)
assert.match(builder2PageSource, /fetchVideoStatus\(jobId\)/)

// 28–29. New video clears job only; no job until submit
assert.match(builder2PageSource, /clearBuilder2CurrentJob/)
assert.match(builder2PageSource, /BUILDER2_MSG_NEW_VIDEO/)
assert.match(builder2PageSource, /handleStartNewVideo/)
assert.doesNotMatch(
  builder2PageSource.match(/handleStartNewVideo[\s\S]*?\n  \}/)?.[0] ?? '',
  /generateVideo/
)

// 30. Malformed persistent state ignored safely
storage.setItem(BUILDER2_CURRENT_JOB_STORAGE_KEY, '{bad json')
assert.equal(readBuilder2CurrentJob(storage), null)
storage.setItem(BUILDER2_CURRENT_JOB_STORAGE_KEY, JSON.stringify({ jobId: '' }))
assert.equal(readBuilder2CurrentJob(storage), null)

// 31–32. Single polling loop; stale job ignored
assert.match(builder2PageSource, /pollGenerationRef/)
assert.match(builder2PageSource, /responseJobId && responseJobId !== jobId/)
assert.match(builder2PageSource, /persisted\?\.jobId && persisted\.jobId !== jobId/)

// 33. Builder1 unchanged
assert.doesNotMatch(builder1PageSource, /builder2JobPersistence|builder2OwnerContext|builder2-resume/i)

// Extra: storage keys + contract version
assert.equal(BUILDER2_OWNER_CONTEXT_STORAGE_KEY, 'ace.ownerContext.v1')
assert.equal(BUILDER2_CURRENT_JOB_STORAGE_KEY, 'ace.builder2.currentJob.v1')
assert.equal(parseBuilder2CurrentJobRecord({ jobId: 'x', createdAt: 't' })?.builder2ResumeContractVersion, BUILDER2_RESUME_CONTRACT_VERSION)

// Extra: failed resumable retains job record
updateBuilder2CurrentJobFromStatus('job-fail', { status: 'failed', canResume: true }, storage)
assert.equal(readBuilder2CurrentJob(storage)?.jobId, 'job-fail')
assert.ok(canBuilder2StatusResume({ status: 'failed', canResume: true }))

// Extra: transient poll failure detection
assert.ok(isTransientBuilder2PollFailure({ status: 'error', error: 'Network error' }))
assert.ok(!isTransientBuilder2PollFailure({ status: 'failed', canResume: true }))

// Extra: build headers include batch state
const headers = buildBuilder2RequestHeaders({ 'Content-Type': 'application/json' })
assert.ok(headers['X-ACE-Batch-State'])
assert.equal(headers['Content-Type'], 'application/json')

// Extra: completed detection + result builder
assert.ok(isBuilder2StatusCompleted({ status: 'done' }))
const built = buildBuilder2VideoResult(
  { status: 'done', finalVideoWithClosureUrl: 'https://cdn.example/v.mp4' },
  () => 'marketing'
)
assert.equal(built.videoUrl, 'https://cdn.example/v.mp4')

// Extra: stage floor smoothing never moves backward
const floored = mergeBuilder2ProgressWithStageFloor(10, 40, 35)
assert.ok(floored >= 35)
assert.ok(floored <= 40)

// Extra: UI constants present
assert.equal(BUILDER2_MSG_RESTORING, 'משחזר את העבודה האחרונה…')
assert.equal(BUILDER2_MSG_DISCONNECTED, 'החיבור נותק. העבודה נשמרה וננסה להתחבר מחדש.')
assert.equal(BUILDER2_MSG_RESUME, 'המשך מאותה נקודה')
assert.equal(BUILDER2_MSG_NEW_VIDEO, 'צור סרטון חדש')

console.log('builder2 recovery tests passed')
