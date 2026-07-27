import { useEffect, useRef, useState } from 'react'
import {
  resolveBuilder2ProgressFrame,
  normalizeBuilder2ProgressPercent,
  getBuilder2RemainingTimeText,
  formatBuilder2ProgressStatusLine,
  getBuilder2ElapsedSeconds,
  BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS
} from '../../utils/builder2Progress'
import './builder2-progress.css'

function Builder2ProgressBar({
  visible,
  progressKey,
  progressTiming = null,
  progressStageLabel = '',
  pendingFinalUrl = false,
  taskSucceeded = false,
  taskFailed = false,
  onRevealReady
}) {
  const [displayProgress, setDisplayProgress] = useState(0)
  const [remainingTimeText, setRemainingTimeText] = useState('')
  const rafRef = useRef(null)
  const completionStartRef = useRef(null)
  const completionFromRef = useRef(null)
  const revealCalledRef = useRef(false)
  const progressRef = useRef(0)
  const lastRemainingSecondRef = useRef(-1)

  const visibleRef = useRef(visible)
  const taskSucceededRef = useRef(taskSucceeded)
  const taskFailedRef = useRef(taskFailed)
  const pendingFinalUrlRef = useRef(pendingFinalUrl)
  const progressTimingRef = useRef(progressTiming)
  const onRevealReadyRef = useRef(onRevealReady)

  visibleRef.current = visible
  taskSucceededRef.current = taskSucceeded
  taskFailedRef.current = taskFailed
  pendingFinalUrlRef.current = pendingFinalUrl
  progressTimingRef.current = progressTiming
  onRevealReadyRef.current = onRevealReady

  const estimatedTotalSeconds =
    progressTiming?.estimatedTotalSeconds ?? BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS

  useEffect(() => {
    setDisplayProgress(0)
    progressRef.current = 0
    completionStartRef.current = null
    completionFromRef.current = null
    revealCalledRef.current = false
    lastRemainingSecondRef.current = -1
    setRemainingTimeText(
      getBuilder2RemainingTimeText(0, estimatedTotalSeconds)
    )
  }, [progressKey, estimatedTotalSeconds])

  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    if (!visible || taskFailed) {
      return undefined
    }

    const scheduleRevealIfReady = (pct) => {
      if (
        taskSucceededRef.current &&
        pct >= 100 &&
        !revealCalledRef.current &&
        onRevealReadyRef.current
      ) {
        revealCalledRef.current = true
        onRevealReadyRef.current()
      }
    }

    const tick = (now) => {
      if (!visibleRef.current || taskFailedRef.current) {
        return
      }

      const timing = progressTimingRef.current
      const totalSeconds = timing?.estimatedTotalSeconds ?? BUILDER2_DEFAULT_ESTIMATED_TOTAL_SECONDS
      const stageFloor = timing?.stageFloor ?? 0
      const elapsedSeconds = getBuilder2ElapsedSeconds(timing)

      if (
        taskSucceededRef.current &&
        completionStartRef.current == null &&
        progressRef.current < 100
      ) {
        completionStartRef.current = now
        completionFromRef.current = progressRef.current
      }

      let nextPercent
      if (taskSucceededRef.current && completionStartRef.current != null) {
        const completionElapsedMs = now - completionStartRef.current
        nextPercent = resolveBuilder2ProgressFrame({
          elapsedSeconds,
          estimatedTotalSeconds: totalSeconds,
          previousPercent: progressRef.current,
          taskSucceeded: true,
          completionFromPercent: completionFromRef.current,
          completionElapsedMs
        })
      } else {
        nextPercent = resolveBuilder2ProgressFrame({
          elapsedSeconds,
          estimatedTotalSeconds: totalSeconds,
          previousPercent: progressRef.current,
          stageFloor,
          pendingFinalUrl: pendingFinalUrlRef.current
        })
      }

      progressRef.current = nextPercent
      setDisplayProgress(nextPercent)

      const elapsedSecond = Math.floor(elapsedSeconds)
      if (elapsedSecond !== lastRemainingSecondRef.current) {
        lastRemainingSecondRef.current = elapsedSecond
        setRemainingTimeText(getBuilder2RemainingTimeText(elapsedSeconds, totalSeconds))
      }

      scheduleRevealIfReady(nextPercent)

      if (taskSucceededRef.current && nextPercent >= 100) {
        return
      }

      if (visibleRef.current && !taskFailedRef.current) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [visible, taskFailed, progressKey, progressTiming])

  useEffect(() => {
    if (!visible || taskFailed || !taskSucceeded) return
    if (progressRef.current >= 100 && !revealCalledRef.current && onRevealReadyRef.current) {
      revealCalledRef.current = true
      onRevealReadyRef.current()
    }
  }, [visible, taskFailed, taskSucceeded])

  if (!visible) {
    return null
  }

  const safeProgress = normalizeBuilder2ProgressPercent(displayProgress)
  const statusLine = formatBuilder2ProgressStatusLine(
    remainingTimeText || getBuilder2RemainingTimeText(0, estimatedTotalSeconds)
  )

  return (
    <div className="builder2-progress-wrap">
      <p className="builder2-progress-status-line" dir="rtl" aria-live="polite">
        {statusLine}
      </p>
      {progressStageLabel ? (
        <p className="builder2-progress-stage-line" dir="rtl" aria-live="polite">
          {progressStageLabel}
        </p>
      ) : null}
      <div
        className="builder2-progress"
        dir="ltr"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(safeProgress)}
        aria-label={statusLine}
      >
        <div className="builder2-progress-track">
          <div
            className="builder2-progress-fill"
            style={{ width: `${safeProgress}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export default Builder2ProgressBar
