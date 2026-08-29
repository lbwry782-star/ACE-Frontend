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
  getBuilder2StageProgressFloor
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

console.log('builder2 progress animation tests passed')
