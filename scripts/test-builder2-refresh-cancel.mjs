/**
 * Builder2 refresh = cancel active job + fresh UI tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER2_ACTIVE_JOB_SESSION_KEY,
  readBuilder2ActiveJob,
  writeBuilder2ActiveJob,
  clearBuilder2ActiveJob
} from '../src/utils/builder2ActiveJob.js'
import {
  BUILDER2_CURRENT_JOB_STORAGE_KEY,
  clearBuilder2CurrentJob
} from '../src/utils/builder2JobPersistence.js'
import {
  BUILDER2_MSG_CANCELLING,
  BUILDER2_MSG_CANCEL_BLOCKED,
  isBuilder2CancelAcknowledged
} from '../src/utils/builder2Status.js'
import {
  BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS,
  BUILDER2_PROGRESS_MAX_WHILE_RUNNING
} from '../src/utils/builder2Progress.js'
import { buildBuilder2JobCancelUrl } from '../src/services/api.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const builder2CssSource = readFileSync(join(root, 'src/pages/Builder2/builder2.css'), 'utf8')
const apiSource = readFileSync(join(root, 'src/services/api.js'), 'utf8')
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

const sessionStorage = new MemoryStorage()
const localStorage = new MemoryStorage()

const mountEffect =
  builder2PageSource.match(
    /useEffect\(\(\) => \{\r?\n    ensureBuilder2OwnerContext\(\)[\s\S]*?\}, \[resetFreshGenerationUi\]\)/
  )?.[0] ?? ''

const unloadEffect =
  builder2PageSource.match(
    /useEffect\(\(\) => \{\r?\n    const onPageHide[\s\S]*?\}, \[\]\)/
  )?.[0] ?? ''

// A. Correct canonical cancel endpoint
assert.doesNotMatch(apiSource, /\/api\/builder2-cancel/)
assert.match(apiSource, /\/api\/builder2\/jobs\/\$\{id\}\/cancel/)
assert.match(apiSource, /frontend_refresh/)
assert.equal(buildBuilder2JobCancelUrl('ABC').endsWith('/api/builder2/jobs/ABC/cancel'), true)
assert.match(apiSource, /cancelBuilder2JobKeepalive/)
assert.match(apiSource, /keepalive:\s*true/)

// B. All acknowledgement outcomes accepted
for (const status of [
  'cancelled',
  'already_cancelled',
  'already_completed',
  'already_terminal'
]) {
  assert.ok(
    isBuilder2CancelAcknowledged({ ok: true, status }),
    `expected ack for ${status}`
  )
}
assert.ok(isBuilder2CancelAcknowledged({ status: 'already_cancelled' }))
assert.ok(!isBuilder2CancelAcknowledged({ ok: false, status: 'error' }))

// C. Unload best-effort — pagehide sends keepalive cancel for active job
assert.match(unloadEffect, /pagehide/)
assert.match(unloadEffect, /readBuilder2ActiveJob/)
assert.match(unloadEffect, /cancelBuilder2JobKeepalive/)
assert.match(unloadEffect, /frontend_refresh/)
assert.doesNotMatch(unloadEffect, /clearBuilder2ActiveJob/)

// D. Mount fallback — cancel again after reload; already_cancelled is fine
assert.match(mountEffect, /readBuilder2ActiveJob/)
assert.match(mountEffect, /cancelBuilder2Job\(jobId\)/)
assert.match(mountEffect, /isBuilder2CancelAcknowledged\(result\)/)
assert.ok(isBuilder2CancelAcknowledged({ status: 'already_cancelled' }))

// E. Failed unload — mount still protects; Generate blocked until ack
assert.match(mountEffect, /setCancellationGate\('pending'\)/)
assert.match(mountEffect, /setCancellationGate\('blocked'\)/)
assert.match(mountEffect, /BUILDER2_MSG_CANCEL_BLOCKED/)

// F. Generate gate — no new generation before acknowledgement
assert.match(builder2PageSource, /cancellationGate !== 'ready'/)
assert.match(builder2PageSource, /initPhase !== 'done'/)
assert.match(mountEffect, /setCancellationGate\('ready'\)/)

// Refresh during running job — persist active job, cancel on mount, no polling restore
writeBuilder2ActiveJob({ jobId: 'ABC' }, sessionStorage)
const active = readBuilder2ActiveJob(sessionStorage)
assert.equal(active?.jobId, 'ABC')
assert.equal(active?.active, true)
assert.equal(BUILDER2_ACTIVE_JOB_SESSION_KEY, 'ace.builder2.activeJob.v1')

assert.match(mountEffect, /resetFreshGenerationUi/)
assert.doesNotMatch(mountEffect, /startPolling/)
assert.doesNotMatch(mountEffect, /fetchVideoStatus/)
assert.match(builder2PageSource, /writeBuilder2ActiveJob/)

// Refresh after completed job — no active marker, no cancel path
clearBuilder2ActiveJob(sessionStorage)
assert.equal(readBuilder2ActiveJob(sessionStorage), null)
assert.match(mountEffect, /if \(!activeJob\?\.jobId\)/)

// Product reset — empty fields after reload, no draft restore
assert.match(builder2PageSource, /EMPTY_FORM_DATA/)
assert.doesNotMatch(builder2PageSource, /readBuilder2FormDraft/)

// Progress reset — no restore on mount; 30-minute timing for next job
assert.doesNotMatch(mountEffect, /beginProgress/)
assert.equal(BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS, 1800)
assert.equal(BUILDER2_PROGRESS_MAX_WHILE_RUNNING, 95)

// Button removal — "צור סרטון חדש" gone
assert.doesNotMatch(builder2PageSource, /BUILDER2_MSG_NEW_VIDEO/)
assert.doesNotMatch(builder2PageSource, /handleStartNewVideo/)

// G. Builder1 isolation
assert.doesNotMatch(builder1PageSource, /builder2ActiveJob|builder2\/jobs|cancelBuilder2Job/i)

// Mount clears localStorage currentJob; never restores generation from it
assert.match(mountEffect, /clearBuilder2CurrentJob/)
clearBuilder2CurrentJob(localStorage)
assert.equal(localStorage.getItem(BUILDER2_CURRENT_JOB_STORAGE_KEY), null)
assert.doesNotMatch(mountEffect, /writeBuilder2CurrentJob/)
assert.doesNotMatch(mountEffect, /startPolling/)

assert.equal(BUILDER2_MSG_CANCELLING, 'מבטל את העבודה הקודמת…')
assert.equal(
  BUILDER2_MSG_CANCEL_BLOCKED,
  'לא ניתן לאשר שהעבודה הקודמת בוטלה. נסו לרענן שוב בעוד רגע.'
)

console.log('builder2 refresh-cancel tests passed')
