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
import { clearBuilder2ActiveJob } from '../src/utils/builder2ActiveJob.js'

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
const sessionStorage = new MemoryStorage()

const mountEffect =
  builder2PageSource.match(
    /useEffect\(\(\) => \{\r?\n    ensureBuilder2OwnerContext\(\)[\s\S]*?\}, \[resetFreshGenerationUi\]\)/
  )?.[0] ?? ''

// 1. Status helper: active jobs are not terminal non-recoverable
assert.ok(isBuilder2StatusRunning({ status: 'running' }))
assert.ok(isBuilder2StatusRunning({ status: 'queued' }))
assert.ok(!isBuilder2TerminalNonRecoverableFailure({ status: 'running' }))
assert.ok(!isBuilder2TerminalNonRecoverableFailure({ status: 'processing' }))

// 2. Completed jobs are not terminal failures
assert.ok(isBuilder2StatusCompleted({ status: 'done' }))
assert.ok(!isBuilder2TerminalNonRecoverableFailure({ status: 'done' }))

// 3. Recoverable failed jobs stay associated (in-session)
assert.ok(canBuilder2StatusResume({ status: 'failed', canResume: true }))
assert.ok(!isBuilder2TerminalNonRecoverableFailure({ status: 'failed', canResume: true }))

// 4. Terminal failed jobs are detected (helper still used elsewhere)
assert.ok(isBuilder2TerminalNonRecoverableFailure({ status: 'failed' }))
assert.ok(isBuilder2TerminalNonRecoverableFailure({ status: 'error', error: 'permanent' }))
assert.ok(isBuilder2TerminalNonRecoverableFailure({ status: 'interrupted', interrupt_code: 'x' }))
assert.ok(
  isBuilder2TerminalNonRecoverableFailure({ error: 'ownership_mismatch', status: 'failed' })
)

// 5. Transient poll errors are not terminal
assert.ok(isTransientBuilder2PollFailure({ status: 'error', error: 'Network error' }))
assert.ok(!isBuilder2TerminalNonRecoverableFailure({ status: 'error', error: 'Network error' }))

// 6. Refresh mount cancels active session job — no terminal-failure restore branch
assert.doesNotMatch(builder2PageSource, /isBuilder2TerminalNonRecoverableFailure/)
assert.match(builder2PageSource, /releasePersistedJobAssociation/)
assert.match(mountEffect, /cancelBuilder2Job/)
assert.doesNotMatch(mountEffect, /isBuilder2TerminalNonRecoverableFailure/)
assert.doesNotMatch(mountEffect, /generateVideo|resumeBuilder2Job/)

const releaseBlock =
  builder2PageSource.match(
    /const releasePersistedJobAssociation = useCallback\([\s\S]*?\n  \)/,
  )?.[0] ?? ''
assert.match(releaseBlock, /clearBuilder2CurrentJob/)
assert.match(releaseBlock, /clearBuilder2ActiveJob/)

// 7. Refresh does not resume polling old job
assert.doesNotMatch(mountEffect, /startPolling/)
assert.match(builder2PageSource, /startPolling\(jobId\)/)

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

// 9. Direct /builder2 without active session job stays fresh
clearBuilder2CurrentJob(storage)
clearBuilder2ActiveJob(sessionStorage)
assert.equal(readBuilder2CurrentJob(storage), null)
assert.match(mountEffect, /if \(!activeJob\?\.jobId\)/)

// 10. Clearing failure does not delete backend — no delete API in dismiss/mount
assert.doesNotMatch(mountEffect, /DELETE|deleteJob|removeJob/)
assert.doesNotMatch(releaseBlock, /DELETE|deleteJob|removeJob/)
assert.doesNotMatch(
  builder2PageSource.match(/handleDismissFailure[\s\S]{0,400}/)?.[0] ?? '',
  /DELETE|deleteJob|removeJob/
)

// 11. In-session completion path preserved
assert.match(builder2PageSource, /buildBuilder2VideoResult/)
assert.doesNotMatch(mountEffect, /buildBuilder2VideoResult/)

// 12. New video button removed — refresh is reset mechanism
assert.doesNotMatch(builder2PageSource, /handleStartNewVideo/)
assert.doesNotMatch(builder2PageSource, /BUILDER2_MSG_NEW_VIDEO/)

// 13. Builder1 unchanged
assert.doesNotMatch(builder1PageSource, /isBuilder2TerminalNonRecoverableFailure|handleDismissFailure/)

// 14. Paid-call safety on refresh/dismiss paths
assert.doesNotMatch(mountEffect, /generateVideo/)
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
  builder2PageSource.match(/handleDismissFailure[\s\S]{0,300}/)?.[0] ?? '',
  /resetFreshFormFields/
)
assert.match(mountEffect, /resetFreshGenerationUi/)

// 19. Failure during session clears active job marker
assert.match(
  builder2PageSource.match(/handleFailureFromStatus[\s\S]{0,500}/)?.[0] ?? '',
  /clearBuilder2ActiveJob/
)

console.log('builder2 terminal failure tests passed')
