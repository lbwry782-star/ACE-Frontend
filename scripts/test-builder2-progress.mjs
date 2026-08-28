/**
 * Builder2 progress display tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS,
  BUILDER2_ESTIMATED_DURATION_MS,
  BUILDER2_PROGRESS_COMPLETION_DURATION_MS,
  BUILDER2_PROGRESS_HEADLINE_HE,
  BUILDER2_PROGRESS_ESTIMATE_HE,
  BUILDER2_PROGRESS_POST_ESTIMATE_TAIL_HE,
  BUILDER2_PROGRESS_SEPARATOR,
  BUILDER2_PROGRESS_MAX_WHILE_RUNNING,
  BUILDER2_PROGRESS_PRE_ESTIMATE_CAP,
  computeBuilder2ProgressPercent,
  computeBuilder2CompletionProgress,
  resolveBuilder2ProgressFrame,
  getBuilder2RemainingTimeText,
  formatBuilder2ProgressStatusLine,
  formatBuilder2RemainingClock,
  getBuilder2ElapsedSeconds,
  getBuilder2StageLabel,
  getBuilder2StageProgressFloor,
  mergeBuilder2ProgressWithStageFloor,
  BUILDER2_PROGRESS_PENDING_URL_CAP,
  parseBuilder2ProgressTimingFromStatus,
  reconcileBuilder2JobTiming,
  resolveBuilder2JobStartTime,
  clearBuilder2JobStartTime,
  clearAllBuilder2JobStartTimes
} from '../src/utils/builder2Progress.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const productForm2Source = readFileSync(join(root, 'src/components/Form/ProductForm2.jsx'), 'utf8')
const progressBarSource = readFileSync(join(root, 'src/components/ProgressBar/Builder2ProgressBar.jsx'), 'utf8')
const progressCss = readFileSync(join(root, 'src/components/ProgressBar/builder2-progress.css'), 'utf8')
const builder1ProgressBarSource = readFileSync(
  join(root, 'src/components/ProgressBar/Builder1ProgressBar.jsx'),
  'utf8'
)
const builder1ProgressJs = readFileSync(join(root, 'src/utils/builder1Progress.js'), 'utf8')

function approx(actual, expected, tolerance = 0.05) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ~${expected}, got ${actual}`
  )
}

const TOTAL = BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS

// 1. Default estimate 1800 seconds (30 minutes)
assert.equal(TOTAL, 1800)
assert.equal(BUILDER2_ESTIMATED_DURATION_MS, 1_800_000)

// 2. Heading displays כ־30 דקות
assert.equal(BUILDER2_PROGRESS_ESTIMATE_HE, 'זמן משוער: כ־30 דקות')
assert.match(
  formatBuilder2ProgressStatusLine('זמן שנותר: 14:32'),
  /זמן משוער: כ־30 דקות/
)

// A. Start — estimated 30 minutes, remaining 30:00
assert.equal(getBuilder2RemainingTimeText(0, TOTAL), 'זמן שנותר: 30:00')
assert.equal(formatBuilder2RemainingClock(1800), '30:00')
approx(computeBuilder2ProgressPercent(0, TOTAL), 0)

// B. Mid-generation — after 15 minutes remaining ≈ 15:00
assert.equal(getBuilder2RemainingTimeText(900, TOTAL), 'זמן שנותר: 15:00')
approx(computeBuilder2ProgressPercent(900, TOTAL), 47.5)

// 3–6. Uniform linear checkpoints (30-minute estimate)
approx(computeBuilder2ProgressPercent(300, TOTAL), 15.833, 0.1)
approx(computeBuilder2ProgressPercent(600, TOTAL), 31.666, 0.1)
approx(computeBuilder2ProgressPercent(900, TOTAL), 47.5)
assert.equal(computeBuilder2ProgressPercent(TOTAL, TOTAL), BUILDER2_PROGRESS_PRE_ESTIMATE_CAP)

// 7. After thirty minutes — tail text instead of 00:00
assert.equal(getBuilder2RemainingTimeText(TOTAL, TOTAL), BUILDER2_PROGRESS_POST_ESTIMATE_TAIL_HE)
assert.match(
  formatBuilder2ProgressStatusLine(BUILDER2_PROGRESS_POST_ESTIMATE_TAIL_HE),
  /מסיים את הווידאו/
)

// 8. Remaining time never negative
assert.equal(formatBuilder2RemainingClock(-10), '00:00')
assert.equal(getBuilder2RemainingTimeText(1900, TOTAL), BUILDER2_PROGRESS_POST_ESTIMATE_TAIL_HE)
for (const elapsed of [0, 20, 300, 700, TOTAL, 2000]) {
  assert.doesNotMatch(getBuilder2RemainingTimeText(elapsed, TOTAL), /-/)
}

// D. Still running at minute 30+ — progress <= 95%, no false 100%
assert.ok(computeBuilder2ProgressPercent(1900, TOTAL) <= BUILDER2_PROGRESS_MAX_WHILE_RUNNING)
assert.ok(
  resolveBuilder2ProgressFrame({ elapsedSeconds: 5000, previousPercent: 0 }) <=
    BUILDER2_PROGRESS_MAX_WHILE_RUNNING
)

// 9. Progress never moves backwards
const atTen = computeBuilder2ProgressPercent(900, TOTAL, 0)
const earlierAttempt = computeBuilder2ProgressPercent(450, TOTAL, atTen)
assert.equal(earlierAttempt, atTen)

// 10. Stage changes do not cause progress jumps
const stageA = computeBuilder2ProgressPercent(675, TOTAL, 0)
const stageB = computeBuilder2ProgressPercent(675, TOTAL, 0)
assert.equal(stageA, stageB)
assert.equal(getBuilder2StageLabel('strategy'), 'מגדיר את הבעיה והיתרון היחסי')
assert.equal(getBuilder2StageLabel('runway_waiting'), 'יוצר את סרטון הווידאו')
assert.equal(getBuilder2StageLabel('rendering_advertising_closure'), 'מוסיף שם מוצר וסלוגן')

// 11. Slow polling does not freeze progress — RAF uses local elapsed between polls
assert.match(progressBarSource, /requestAnimationFrame/)
assert.match(progressBarSource, /getBuilder2ElapsedSeconds/)

// 12–13. Backend progressStartedAt + refresh resume
clearAllBuilder2JobStartTimes()
const startedAtIso = '2026-01-01T00:00:00.000Z'
const startedAtMs = Date.parse(startedAtIso)
const timingFromBackend = reconcileBuilder2JobTiming('job-backend', {
  progressStartedAt: startedAtIso,
  estimatedTotalSeconds: TOTAL,
  elapsedSeconds: 600
})
assert.equal(timingFromBackend.startMs, startedAtMs)
assert.equal(timingFromBackend.estimatedTotalSeconds, TOTAL)
assert.equal(timingFromBackend.serverElapsedSeconds, 600)
const resumedNowMs = timingFromBackend.serverElapsedAtMs + 30_000
approx(getBuilder2ElapsedSeconds(timingFromBackend, resumedNowMs), 630, 1)
const refreshTiming = reconcileBuilder2JobTiming(
  'job-refresh',
  { progressStartedAt: startedAtIso },
  startedAtMs
)
approx(getBuilder2ElapsedSeconds(refreshTiming, startedAtMs + 630_000), 630, 2)
clearBuilder2JobStartTime('job-backend')
clearBuilder2JobStartTime('job-refresh')

// C. Completion at 24 minutes — backend success → 100%
approx(computeBuilder2ProgressPercent(1440, TOTAL), 76, 0.1)
assert.equal(
  resolveBuilder2ProgressFrame({
    elapsedSeconds: 1440,
    previousPercent: 76,
    taskSucceeded: true,
    completionFromPercent: 76,
    completionElapsedMs: BUILDER2_PROGRESS_COMPLETION_DURATION_MS
  }),
  100
)

// 14. Success moves to 100%
assert.equal(
  resolveBuilder2ProgressFrame({
    elapsedSeconds: 1000,
    previousPercent: 90,
    taskSucceeded: true,
    completionFromPercent: 90,
    completionElapsedMs: BUILDER2_PROGRESS_COMPLETION_DURATION_MS
  }),
  100
)

// 15–16. Failure does not reach 100%; timers stop via taskFailed
assert.ok(computeBuilder2ProgressPercent(1200, TOTAL) < 100)
assert.match(progressBarSource, /if \(!visible \|\| taskFailed\)/)
assert.match(builder2PageSource, /handleFailureFromStatus/)
assert.match(builder2PageSource, /stopProgressUi/)

// 17. While running capped at 95%
assert.equal(BUILDER2_PROGRESS_MAX_WHILE_RUNNING, 95)
assert.equal(BUILDER2_PROGRESS_PRE_ESTIMATE_CAP, 95)
assert.ok(computeBuilder2ProgressPercent(TOTAL, TOTAL) <= 95.01)
assert.ok(computeBuilder2ProgressPercent(2200, TOTAL) <= BUILDER2_PROGRESS_MAX_WHILE_RUNNING)

// 18–19. LTR fill + RTL heading
assert.match(progressCss, /\.builder2-progress[\s\S]*direction:\s*ltr/)
assert.match(progressCss, /\.builder2-progress-fill[\s\S]*left:\s*0/)
assert.match(progressCss, /builder2-progress-status-line[\s\S]*direction:\s*rtl/)
assert.match(progressBarSource, /dir="rtl"/)
assert.match(progressBarSource, /dir="ltr"/)

// E. Builder1 unchanged
assert.doesNotMatch(builder1ProgressBarSource, /builder2-progress/)
assert.doesNotMatch(builder1ProgressJs, /builder2/i)
assert.doesNotMatch(builder1ProgressBarSource, /1800|30 דקות/)

// 21. Separate timing per job ID
clearAllBuilder2JobStartTimes()
const tA = reconcileBuilder2JobTiming('job-a', {}, 1000)
const tB = reconcileBuilder2JobTiming('job-b', {}, 5000)
assert.notEqual(tA.startMs, tB.startMs)
assert.equal(reconcileBuilder2JobTiming('job-a', {}).startMs, tA.startMs)
clearBuilder2JobStartTime('job-a')
assert.equal(resolveBuilder2JobStartTime('job-a', 9000), 9000)
clearAllBuilder2JobStartTimes()

// 22. Missing backend timing fields fallback to 1800 seconds
clearAllBuilder2JobStartTimes()
const fallbackTiming = reconcileBuilder2JobTiming('job-fallback', {}, 42)
assert.equal(fallbackTiming.estimatedTotalSeconds, TOTAL)
assert.equal(fallbackTiming.startMs, 42)
assert.deepEqual(parseBuilder2ProgressTimingFromStatus({ status: 'running' }), {
  progressStartedAtMs: null,
  estimatedTotalSeconds: null,
  elapsedSeconds: null,
  estimatedRemainingSeconds: null,
  progressStage: null
})

// Component wiring
assert.match(builder2PageSource, /builder2-progress-section/)
assert.match(builder2PageSource, /Builder2ProgressBar/)
assert.doesNotMatch(productForm2Source, /Builder2ProgressBar/)
assert.match(builder2PageSource, /ensureBuilder2OwnerContext/)
assert.match(builder2PageSource, /resumeBuilder2Job/)
assert.match(builder2PageSource, /BUILDER2_MSG_NEW_VIDEO/)
assert.doesNotMatch(builder2PageSource, /buildDemoVideoResult/)
assert.doesNotMatch(builder2PageSource, /isDemoMode/)
assert.match(progressBarSource, /progressTiming/)
assert.match(progressBarSource, /progressStageLabel/)
assert.doesNotMatch(builder2PageSource, /Builder1ProgressBar/)
assert.doesNotMatch(progressBarSource, /<br/i)

// Exact normal heading example
assert.match(
  formatBuilder2ProgressStatusLine('זמן שנותר: 14:32'),
  /יוצר וידאו איכותי · זמן משוער: כ־30 דקות · זמן שנותר: 14:32/
)

// Builder2 form preserved
assert.match(productForm2Source, /productName-b2/)
assert.match(productForm2Source, /productDescription-b2/)
assert.match(productForm2Source, /Product description is required/)

// Stage floors smooth upward only; capped at 95 while running
assert.equal(getBuilder2StageProgressFloor('runway_waiting'), 86)
const merged = mergeBuilder2ProgressWithStageFloor(20, 86, 80)
assert.ok(merged >= 80)
assert.ok(merged <= BUILDER2_PROGRESS_MAX_WHILE_RUNNING)

// Pending URL cap below 100
assert.ok(BUILDER2_PROGRESS_PENDING_URL_CAP === 95)
assert.ok(
  resolveBuilder2ProgressFrame({ elapsedSeconds: 5000, previousPercent: 0, pendingFinalUrl: true }) <
    100
)

console.log('builder2 progress tests passed')
