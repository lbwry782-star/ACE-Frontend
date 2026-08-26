/**
 * Builder2 terminal failure lifecycle tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER2_CURRENT_JOB_STORAGE_KEY,
  readBuilder2CurrentJob,
  writeBuilder2CurrentJob,
  clearBuilder2CurrentJob
} from '../src/utils/builder2JobPersistence.js'
import {
  isBuilder2StatusRunning,
  isBuilder2StatusCompleted,
  canBuilder2StatusResume,
  isBuilder2TerminalNonRecoverableFailure,
  isTransientBuilder2PollFailure
} from '../src/utils/builder2Status.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const builder1PageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const apiSource = readFileSync(join(root, 'src/services/api.js'), 'utf8')

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

// 1. Status helper: active jobs are not terminal non-recoverable
assert.ok(isBuilder2StatusRunning({ status: 'running' }))
assert.ok(isBuilder2StatusRunning({ status: 'queued' }))
assert.ok(!isBuilder2TerminalNonRecoverableFailure({ status: 'running' }))
assert.ok(!isBuilder2TerminalNonRecoverableFailure({ status: 'processing' }))

// 2. Completed jobs are not terminal failures
assert.ok(isBuilder2StatusCompleted({ status: 'done' }))
assert.ok(!isBuilder2TerminalNonRecoverableFailure({ status: 'done' }))

// 3. Recoverable failed jobs stay associated
assert.ok(canBuilder2StatusResume({ status: 'failed', canResume: true }))
assert.ok(!isBuilder2TerminalNonRecoverableFailure({ status: 'failed', canResume: true }))

// 4. Terminal failed jobs are detected
assert.ok(isBuilder2TerminalNonRecoverableFailure({ status: 'failed' }))
assert.ok(isBuilder2TerminalNonRecoverableFailure({ status: 'error', error: 'permanent' }))
assert.ok(isBuilder2TerminalNonRecoverableFailure({ status: 'interrupted', interrupt_code: 'x' }))
assert.ok(
  isBuilder2TerminalNonRecoverableFailure({ error: 'ownership_mismatch', status: 'failed' })
)

// 5. Transient poll errors are not terminal
assert.ok(isTransientBuilder2PollFailure({ status: 'error', error: 'Network error' }))
assert.ok(!isBuilder2TerminalNonRecoverableFailure({ status: 'error', error: 'Network error' }))

// 6. Refresh restore clears terminal failure pointer (frontend only)
assert.match(builder2PageSource, /isBuilder2TerminalNonRecoverableFailure/)
assert.match(builder2PageSource, /releasePersistedJobAssociation/)
const restoreBlock =
  builder2PageSource.match(
    /if \(isBuilder2TerminalNonRecoverableFailure\(st\)\) \{[\s\S]*?return/
  )?.[0] ?? ''
assert.match(restoreBlock, /releasePersistedJobAssociation/)
const releaseBlock =
  builder2PageSource.match(
    /const releasePersistedJobAssociation = useCallback\([\s\S]*?\n  \)/,
  )?.[0] ?? ''
assert.match(releaseBlock, /clearBuilder2CurrentJob/)
assert.doesNotMatch(restoreBlock, /generateVideo|resumeBuilder2Job/)

// 7. Active refresh still polls — no auto-clear for running jobs
assert.match(builder2PageSource, /startPolling\(jobId\)/)
assert.doesNotMatch(
  builder2PageSource.match(/isBuilder2TerminalNonRecoverableFailure[\s\S]{0,200}/)?.[0] ?? '',
  /generateVideo/
)

// 8. Dismiss clears persisted frontend association
assert.match(builder2PageSource, /handleDismissFailure/)
assert.match(builder2PageSource, /handleDismissOwnershipError/)
assert.match(builder2PageSource, /onRetry=\{handleDismissFailure\}/)
assert.doesNotMatch(builder2PageSource, /onRetry=\{\(\) => setFailureInfo\(null\)\}/)
assert.match(
  builder2PageSource,
  /handleDismissFailure[\s\S]{0,300}releasePersistedJobAssociation/
)
assert.doesNotMatch(
  builder2PageSource.match(/handleDismissFailure[\s\S]{0,400}/)?.[0] ?? '',
  /generateVideo|resumeBuilder2Job/
)

// 9. Direct /builder2 without persisted job stays fresh
clearBuilder2CurrentJob(storage)
assert.equal(readBuilder2CurrentJob(storage), null)
assert.match(builder2PageSource, /if \(!persisted\?\.jobId\)/)

// 10. Clearing terminal failure does not delete backend — no delete API in dismiss/restore
assert.doesNotMatch(restoreBlock, /DELETE|deleteJob|removeJob/)
assert.doesNotMatch(releaseBlock, /DELETE|deleteJob|removeJob/)
assert.doesNotMatch(
  builder2PageSource.match(/handleDismissFailure[\s\S]{0,400}/)?.[0] ?? '',
  /DELETE|deleteJob|removeJob/
)

// 11. Completed refresh path preserved
assert.match(builder2PageSource, /persisted\.completed/)
assert.match(builder2PageSource, /buildBuilder2VideoResult/)

// 12. New video path still clears only frontend state
assert.match(builder2PageSource, /handleStartNewVideo/)
assert.doesNotMatch(
  builder2PageSource.match(/handleStartNewVideo[\s\S]*?\n  \}/)?.[0] ?? '',
  /generateVideo|resumeBuilder2Job/
)

// 13. Builder1 unchanged
assert.doesNotMatch(builder1PageSource, /isBuilder2TerminalNonRecoverableFailure|handleDismissFailure/)

// 14. Paid-call safety on refresh/dismiss paths
const restoreEffect =
  builder2PageSource.match(/useEffect\(\(\) => \{[\s\S]*?ensureBuilder2OwnerContext[\s\S]*?\}, \[/)?.[0] ??
  ''
assert.doesNotMatch(restoreEffect, /generateVideo/)
assert.doesNotMatch(
  builder2PageSource.match(/handleDismissFailure[\s\S]{0,400}/)?.[0] ?? '',
  /generateVideo|resumeBuilder2Job/
)

// 15. Simulated terminal failure pointer cleanup (localStorage only)
writeBuilder2CurrentJob({ jobId: 'job-terminal', createdAt: '2026-01-01T00:00:00.000Z' }, storage)
assert.equal(readBuilder2CurrentJob(storage)?.jobId, 'job-terminal')
clearBuilder2CurrentJob(storage)
assert.equal(readBuilder2CurrentJob(storage), null)
assert.equal(BUILDER2_CURRENT_JOB_STORAGE_KEY, 'ace.builder2.currentJob.v1')

// 16. Resume API still exists for recoverable architecture
assert.match(apiSource, /builder2-resume/)

// 17. Regression: stopPolling must initialize before releasePersistedJobAssociation (TDZ)
const stopPollingDecl = builder2PageSource.indexOf('const stopPolling = useCallback')
const releaseDecl = builder2PageSource.indexOf('const releasePersistedJobAssociation = useCallback')
assert.ok(stopPollingDecl > 0, 'stopPolling declaration missing')
assert.ok(releaseDecl > 0, 'releasePersistedJobAssociation declaration missing')
assert.ok(
  stopPollingDecl < releaseDecl,
  'stopPolling must be declared before releasePersistedJobAssociation to avoid TDZ on mount'
)

// 18. Form draft is not restored after refresh; mount clears legacy draft
assert.doesNotMatch(builder2PageSource, /readBuilder2FormDraft/)
assert.doesNotMatch(builder2PageSource, /writeBuilder2FormDraft/)
assert.match(builder2PageSource, /EMPTY_FORM_DATA/)
assert.match(
  builder2PageSource.match(/isBuilder2TerminalNonRecoverableFailure\(st\)[\s\S]{0,300}/)?.[0] ??
    '',
  /resetFreshFormFields/
)
assert.match(
  builder2PageSource.match(/handleDismissFailure[\s\S]{0,300}/)?.[0] ?? '',
  /resetFreshFormFields/
)

console.log('builder2 terminal failure tests passed')
