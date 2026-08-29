/**
 * Builder2 progress animation monotonic behavior tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS,
  BUILDER2_PROGRESS_MAX_WHILE_RUNNING,
  BUILDER2_PROGRESS_COMPLETION_DURATION_MS,
  computeBuilder2ProgressTarget,
  advanceBuilder2DisplayedProgress,
  resolveBuilder2ProgressFrame,
  getBuilder2StageProgressFloor,
  getBuilder2ElapsedSeconds,
  getBuilder2RemainingTimeText,
  reconcileBuilder2JobTiming,
  clearAllBuilder2JobStartTimes
} from '../src/utils/builder2Progress.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const progressBarSource = readFileSync(
  join(root, 'src/components/ProgressBar/Builder2ProgressBar.jsx'),
  'utf8'
)
const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const builder1ProgressBarSource = readFileSync(
  join(root, 'src/components/ProgressBar/Builder1ProgressBar.jsx'),
  'utf8'
)

const TOTAL = BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS
const BUILDER2_DISPLAY_PROGRESS_SPEED_PER_SEC = 9

function approx(actual, expected, tolerance = 0.15) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ~${expected}, got ${actual}`
  )
}

/**
 * Mirrors Builder2ProgressBar RAF tick elapsed/progress/countdown logic.
 * @param {object} options
 */
function simulateProgressBarFrames({
  timing,
  jobStartMs,
  durationMs,
  msPerFrame = 16,
  rafBase = 1000,
  onPollIntervalMs = null,
  onPoll = null,
  useWallClockForElapsed = true
}) {
  let activeTiming = timing
  let displayProgress = 0
  let remainingTimeText = getBuilder2RemainingTimeText(0, TOTAL)
  let lastRemainingSecond = -1
  let prevFrameMs = null
  const frameCount = Math.floor(durationMs / msPerFrame)
  const samples = {}

  for (let f = 0; f <= frameCount; f++) {
    const rafNow = rafBase + f * msPerFrame
    const wallNow = jobStartMs + f * msPerFrame

    if (
      onPollIntervalMs != null &&
      onPoll &&
      f > 0 &&
      f % Math.floor(onPollIntervalMs / msPerFrame) === 0
    ) {
      const nextTiming = onPoll(activeTiming)
      if (nextTiming) {
        activeTiming = nextTiming
      }
    }

    const deltaMs =
      prevFrameMs != null && Number.isFinite(prevFrameMs) ? Math.max(0, rafNow - prevFrameMs) : 16
    prevFrameMs = rafNow
    const maxStep = BUILDER2_DISPLAY_PROGRESS_SPEED_PER_SEC * (deltaMs / 1000)

    const elapsedClock = useWallClockForElapsed ? wallNow : rafNow
    const elapsedSeconds = getBuilder2ElapsedSeconds(activeTiming, elapsedClock)
    const target = computeBuilder2ProgressTarget(
      elapsedSeconds,
      TOTAL,
      activeTiming.stageFloor ?? 0,
      false
    )
    displayProgress = advanceBuilder2DisplayedProgress(target, displayProgress, maxStep)

    const elapsedSecond = Math.floor(elapsedSeconds)
    if (elapsedSecond !== lastRemainingSecond) {
      lastRemainingSecond = elapsedSecond
      remainingTimeText = getBuilder2RemainingTimeText(elapsedSeconds, TOTAL)
    }

    const sec = Math.floor((f * msPerFrame) / 1000)
    if ([0, 10, 30, 60].includes(sec) && samples[sec] == null) {
      samples[sec] = {
        elapsedSeconds,
        target,
        displayProgress,
        remainingTimeText
      }
    }
  }

  return { samples, displayProgress, remainingTimeText }
}

function runFramesToward(target, from, frames, maxStep = 0.15) {
  let displayed = from
  for (let i = 0; i < frames; i++) {
    displayed = advanceBuilder2DisplayedProgress(target, displayed, maxStep)
  }
  return displayed
}

// A. Normal progression — never resets backward
const normalTrail = [0]
let normalDisplayed = 0
for (const target of [10, 20, 30, 25, 40]) {
  for (let frame = 0; frame < 120; frame++) {
    normalDisplayed = advanceBuilder2DisplayedProgress(target, normalDisplayed, 0.15)
  }
  normalTrail.push(normalDisplayed)
}
for (let i = 1; i < normalTrail.length; i++) {
  assert.ok(normalTrail[i] >= normalTrail[i - 1], `step ${i} went backward`)
}
assert.ok(normalTrail.at(-1) >= 40)

// B. Polling update — displayed stays >= previous (simulated status target refresh)
let displayed = 37
displayed = advanceBuilder2DisplayedProgress(
  computeBuilder2ProgressTarget(900, TOTAL, getBuilder2StageProgressFloor('creator_generation')),
  displayed,
  0.2
)
assert.ok(displayed >= 37)
assert.match(progressBarSource, /}, \[visible, taskFailed, progressKey\]\)/)
assert.match(progressBarSource, /progressTimingRef/)
assert.match(progressBarSource, /}, \[progressKey\]\)/)

// C. Stage floor increase — movement from 32 toward 45, not from 0
let stageDisplayed = 32
const stageTarget = computeBuilder2ProgressTarget(600, TOTAL, 45)
for (let i = 0; i < 120; i++) {
  stageDisplayed = advanceBuilder2DisplayedProgress(stageTarget, stageDisplayed, 0.15)
}
assert.ok(stageDisplayed >= 32)
assert.ok(stageDisplayed <= 45.01)
assert.ok(stageDisplayed > 40)

// D. Lower recalculated target — displayed remains >= 52
const held = advanceBuilder2DisplayedProgress(49, 52, 0.5)
assert.equal(held, 52)

// E. Completion early — 68 → 100 from current position
const earlyDone = resolveBuilder2ProgressFrame({
  elapsedSeconds: 1200,
  previousPercent: 68,
  taskSucceeded: true,
  completionFromPercent: 68,
  completionElapsedMs: BUILDER2_PROGRESS_COMPLETION_DURATION_MS
})
assert.equal(earlyDone, 100)

// F. Completion late — 95 → 100
const lateDone = resolveBuilder2ProgressFrame({
  elapsedSeconds: 2200,
  previousPercent: 95,
  taskSucceeded: true,
  completionFromPercent: 95,
  completionElapsedMs: BUILDER2_PROGRESS_COMPLETION_DURATION_MS
})
assert.equal(lateDone, 100)

assert.ok(
  resolveBuilder2ProgressFrame({
    elapsedSeconds: 1200,
    previousPercent: 68,
    taskSucceeded: true,
    completionFromPercent: 68,
    completionElapsedMs: 0
  }) >= 68
)

// G. Still running after 30 min — <= 95, no reset
const longRunTarget = computeBuilder2ProgressTarget(5000, TOTAL, 90)
assert.ok(longRunTarget <= BUILDER2_PROGRESS_MAX_WHILE_RUNNING)
let longRunDisplayed = 70
longRunDisplayed = advanceBuilder2DisplayedProgress(longRunTarget, longRunDisplayed, 1)
assert.ok(longRunDisplayed >= 70)

// H. New job alone resets — progressKey only on fresh session
assert.match(builder2PageSource, /isFreshProgressSession/)
assert.match(builder2PageSource, /showProgressBarRef/)
assert.doesNotMatch(builder2PageSource, /key=\{progressKey\}/)

// Completion must start from displayed ref, not zero
assert.match(progressBarSource, /completionFromRef\.current = progressRef\.current/)
assert.doesNotMatch(
  progressBarSource.match(/setDisplayProgress\(0\)[\s\S]{0,200}/)?.[0] ?? '',
  /progressTiming/
)

// J. Builder1 unchanged
assert.doesNotMatch(builder1ProgressBarSource, /computeBuilder2ProgressTarget/)
assert.doesNotMatch(builder1ProgressBarSource, /advanceBuilder2DisplayedProgress/)

// --- Component time-base regression (production RAF bug) ---

assert.match(progressBarSource, /const wallNow = Date\.now\(\)/)
assert.match(progressBarSource, /getBuilder2ElapsedSeconds\(timing, wallNow\)/)
assert.doesNotMatch(
  progressBarSource,
  /getBuilder2ElapsedSeconds\(timing, now\)/
)

// Old bug: RAF timestamp vs epoch startMs → elapsed stuck at 0
clearAllBuilder2JobStartTimes()
const jobStartMs = 1_700_000_000_000
const jobId = 'raf-time-base'
let timing = reconcileBuilder2JobTiming(jobId, { progressStartedAt: jobStartMs }, jobStartMs)

const buggy60 = simulateProgressBarFrames({
  timing,
  jobStartMs,
  durationMs: 60_000,
  useWallClockForElapsed: false
})
assert.equal(buggy60.samples[60]?.elapsedSeconds ?? 0, 0, 'RAF timestamp must reproduce frozen elapsed')
assert.equal(buggy60.displayProgress, 0, 'RAF timestamp must reproduce frozen progress')

// Fixed: wall-clock drives elapsed, progress, and countdown
const fixed60 = simulateProgressBarFrames({
  timing,
  jobStartMs,
  durationMs: 60_000,
  useWallClockForElapsed: true
})

approx(fixed60.samples[10].elapsedSeconds, 10, 0.2)
approx(fixed60.samples[10].target, 0.528, 0.1)
assert.equal(fixed60.samples[10].remainingTimeText, 'זמן שנותר: 29:50')

approx(fixed60.samples[30].elapsedSeconds, 30, 0.2)
approx(fixed60.samples[30].target, 1.583, 0.15)
assert.equal(fixed60.samples[30].remainingTimeText, 'זמן שנותר: 29:30')

approx(fixed60.samples[60].elapsedSeconds, 60, 0.2)
approx(fixed60.samples[60].target, 3.167, 0.15)
assert.ok(fixed60.displayProgress > 0, 'displayProgress must exceed 0 after 60s')
assert.equal(fixed60.samples[60].remainingTimeText, 'זמן שנותר: 29:00')

// Repeated elapsedSeconds=0 polls — local wall clock continues
clearAllBuilder2JobStartTimes()
const zeroPollJobId = 'zero-poll-raf'
timing = reconcileBuilder2JobTiming(
  zeroPollJobId,
  { progressStartedAt: jobStartMs },
  jobStartMs
)
const zeroPollRun = simulateProgressBarFrames({
  timing,
  jobStartMs,
  durationMs: 60_000,
  useWallClockForElapsed: true,
  onPollIntervalMs: 2000,
  onPoll: () =>
    reconcileBuilder2JobTiming(zeroPollJobId, { status: 'running', elapsedSeconds: 0 })
})
approx(zeroPollRun.samples[60].elapsedSeconds, 60, 0.2)
assert.ok(zeroPollRun.displayProgress > 0)
assert.equal(zeroPollRun.samples[60].remainingTimeText, 'זמן שנותר: 29:00')
assert.equal(
  reconcileBuilder2JobTiming(zeroPollJobId, {}).serverElapsedSeconds,
  null
)

// No backend poll for 60 seconds — bar and clock still move
clearAllBuilder2JobStartTimes()
const noPollJobId = 'no-poll-raf'
timing = reconcileBuilder2JobTiming(
  noPollJobId,
  { progressStartedAt: jobStartMs },
  jobStartMs
)
const noPollRun = simulateProgressBarFrames({
  timing,
  jobStartMs,
  durationMs: 60_000,
  useWallClockForElapsed: true
})
approx(noPollRun.samples[60].elapsedSeconds, 60, 0.2)
assert.ok(noPollRun.displayProgress > 0)
assert.equal(noPollRun.samples[60].remainingTimeText, 'זמן שנותר: 29:00')

console.log('builder2 progress animation tests passed')
