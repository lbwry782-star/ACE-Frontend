import { useState, useRef, useEffect, useCallback } from 'react'
import ProductForm2 from '../../components/Form/ProductForm2'
import Builder2ProgressBar from '../../components/ProgressBar/Builder2ProgressBar'
import VideoAdCard from '../../components/VideoAdCard/VideoAdCard'
import ErrorPanel from '../../components/Error/ErrorPanel'
import { generateMarketingText } from '../../utils/marketingText'
import { generateVideo, fetchVideoStatus, resumeBuilder2Job } from '../../services/api'
import { ensureBuilder2OwnerContext } from '../../utils/builder2OwnerContext'
import {
  readBuilder2CurrentJob,
  writeBuilder2CurrentJob,
  clearBuilder2CurrentJob,
  updateBuilder2CurrentJobFromStatus
} from '../../utils/builder2JobPersistence'
import {
  BUILDER2_MSG_RESTORING,
  BUILDER2_MSG_DISCONNECTED,
  BUILDER2_MSG_RESUME_IN_PROGRESS,
  BUILDER2_MSG_PREPARING_VIDEO_FILE,
  BUILDER2_MSG_NEW_VIDEO,
  BUILDER2_MSG_RESUME,
  normalizeBuilder2Status,
  isBuilder2StatusCompleted,
  isBuilder2StatusRunning,
  isBuilder2StatusFailed,
  canBuilder2StatusResume,
  isBuilder2ResumeAlreadyInProgress,
  getBuilder2OwnershipErrorCode,
  getBuilder2SafeFailureMessage,
  buildBuilder2VideoResult,
  isTransientBuilder2PollFailure,
  resolveBuilder2FinalVideoUrl,
  isValidBuilder2VideoUrl
} from '../../utils/builder2Status'
import {
  reconcileBuilder2JobTiming,
  getBuilder2StageLabel,
  clearBuilder2JobStartTime
} from '../../utils/builder2Progress'
import '../Builder/builder.css'
import './builder2.css'

const POLL_INTERVAL_MS = 2000
const POLL_LONG_RUNNING_NOTICE_MS = 12 * 60 * 1000
const BUILDER2_MAX_VIDEOS_SESSION_KEY = 'ace_builder2_max_videos'
const DEFAULT_BUILDER2_SESSION_LIMIT = 2

const STATE = {
  IDLE: 'IDLE',
  GENERATING: 'GENERATING',
  SUCCESS: 'SUCCESS'
}

function resolveBuilder2SessionLimit() {
  try {
    const raw = sessionStorage.getItem(BUILDER2_MAX_VIDEOS_SESSION_KEY)
    const n = Number(raw)
    if (n === 2 || n === 3 || n === 4) return n
  } catch (_) {
    /* ignore */
  }
  return DEFAULT_BUILDER2_SESSION_LIMIT
}

/** Video job interrupted (e.g. worker shutdown). */
function getInterruptCode(st) {
  if (!st || typeof st !== 'object') return null
  const nested = st.infrastructure_interruption ?? st.infrastructureInterruption
  const raw =
    st.interrupt_code ??
    st.interruptCode ??
    nested?.interrupt_code ??
    nested?.interruptCode
  return raw != null ? String(raw) : null
}

const INTERRUPT_WORKER_SHUTDOWN = 'interrupted_worker_shutdown'
const MSG_WORKER_SHUTDOWN =
  'The generation was interrupted by a server restart. Use resume to continue from the same point.'

function extractResolvedProductName(payload) {
  if (!payload || typeof payload !== 'object') return null

  const tryString = (v) => {
    if (v == null) return null
    if (typeof v === 'string') {
      const t = v.trim()
      return t || null
    }
    if (typeof v === 'object') {
      const n = v.name ?? v.productName ?? v.value
      if (typeof n === 'string' && n.trim()) return n.trim()
    }
    return null
  }

  const flatKeys = [
    'productNameResolved',
    'product_name_resolved',
    'resolvedProductName',
    'resolved_product_name',
    'resolvedName',
    'chosenProductName',
    'generatedProductName',
    'autoProductName',
    'backendProductName',
    'canonicalProductName'
  ]
  for (const k of flatKeys) {
    const s = tryString(payload[k])
    if (s) return s
  }

  const nested = [payload.result, payload.data, payload.job, payload.metadata, payload.video, payload.response]
  for (const obj of nested) {
    if (!obj || typeof obj !== 'object') continue
    for (const k of flatKeys) {
      const s = tryString(obj[k])
      if (s) return s
    }
    const s = tryString(obj.productName)
    if (s) return s
  }

  return tryString(payload.productName)
}

function tryApplyResolvedProductName(
  payload,
  userLeftProductNameEmpty,
  lockedResolvedNameRef,
  fillingResolvedNameRef,
  setFormData,
  setIsProductNameAuto,
  setCanonicalResolvedProductName
) {
  if (!userLeftProductNameEmpty) return
  const name = extractResolvedProductName(payload)
  if (!name) return
  if (lockedResolvedNameRef.current !== null) {
    if (name !== lockedResolvedNameRef.current) return
    setCanonicalResolvedProductName(lockedResolvedNameRef.current)
    setFormData((prev) => ({ ...prev, productName: lockedResolvedNameRef.current }))
    setIsProductNameAuto(true)
    return
  }
  lockedResolvedNameRef.current = name
  fillingResolvedNameRef.current = true
  setCanonicalResolvedProductName(name)
  setFormData((prev) => ({ ...prev, productName: name }))
  setIsProductNameAuto(true)
}

function Builder2Page() {
  const [state, setState] = useState(STATE.IDLE)
  const [sessionLimit, setSessionLimit] = useState(DEFAULT_BUILDER2_SESSION_LIMIT)
  const [restorePhase, setRestorePhase] = useState('checking')
  const [videoResult, setVideoResult] = useState(null)
  const [failureInfo, setFailureInfo] = useState(null)
  const [ownershipError, setOwnershipError] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const [errorPanelTitle, setErrorPanelTitle] = useState('Generation failed')
  const [isDisconnected, setIsDisconnected] = useState(false)
  const [resumeAlreadyInProgress, setResumeAlreadyInProgress] = useState(false)
  const [formData, setFormData] = useState({
    productName: '',
    productDescription: ''
  })
  const [isProductNameAuto, setIsProductNameAuto] = useState(false)
  const [canonicalResolvedProductName, setCanonicalResolvedProductName] = useState(null)
  const [progressActive, setProgressActive] = useState(false)
  const [progressKey, setProgressKey] = useState(0)
  const [showProgressBar, setShowProgressBar] = useState(false)
  const [progressTaskSucceeded, setProgressTaskSucceeded] = useState(false)
  const [progressTaskFailed, setProgressTaskFailed] = useState(false)
  const [progressPendingFinalUrl, setProgressPendingFinalUrl] = useState(false)
  const [progressJobStartMs, setProgressJobStartMs] = useState(null)
  const [progressTiming, setProgressTiming] = useState(null)
  const [progressStageLabel, setProgressStageLabel] = useState('')
  const [fieldsLocked, setFieldsLocked] = useState(false)
  const [showEmptyForm, setShowEmptyForm] = useState(true)
  const [resumeInFlight, setResumeInFlight] = useState(false)

  const submitInFlightRef = useRef(false)
  const pollGenerationRef = useRef(0)
  const pollAbortRef = useRef(null)
  const activeJobIdRef = useRef(null)
  const progressActiveJobIdRef = useRef(null)
  const progressJobStartMsRef = useRef(null)
  const pendingVideoResultRef = useRef(null)
  const lockedResolvedNameRef = useRef(null)
  const fillingResolvedNameRef = useRef(false)
  const userLeftProductNameEmptyRef = useRef(false)
  const hadConfirmedRunningRef = useRef(false)
  const pollStartedAtRef = useRef(0)
  const didLogLongRunningRef = useRef(false)

  useEffect(() => {
    setSessionLimit(resolveBuilder2SessionLimit())
  }, [])

  const applyPollProgressTiming = useCallback((jobId, statusPayload) => {
    const timing = reconcileBuilder2JobTiming(
      jobId,
      statusPayload,
      progressJobStartMsRef.current ?? Date.now()
    )
    progressJobStartMsRef.current = timing.startMs
    setProgressJobStartMs(timing.startMs)
    setProgressTiming(timing)
    const stageLabel = getBuilder2StageLabel(
      statusPayload?.progressStage ?? statusPayload?.progress_stage
    )
    if (stageLabel) {
      setProgressStageLabel(stageLabel)
    }
    return timing
  }, [])

  const beginProgress = useCallback((jobId) => {
    pendingVideoResultRef.current = null
    setProgressTaskFailed(false)
    setProgressTaskSucceeded(false)
    setProgressPendingFinalUrl(false)
    setProgressStageLabel('')
    const startedAt =
      progressJobStartMsRef.current ??
      reconcileBuilder2JobTiming(jobId, {}, Date.now()).startMs
    progressJobStartMsRef.current = startedAt
    setProgressJobStartMs(startedAt)
    const timing = reconcileBuilder2JobTiming(jobId, { progressStartedAt: startedAt }, startedAt)
    setProgressTiming(timing)
    setProgressKey((prev) => prev + 1)
    setProgressActive(true)
    setShowProgressBar(true)
    setState(STATE.GENERATING)
  }, [])

  const stopProgressUi = useCallback(() => {
    setProgressActive(false)
    setShowProgressBar(false)
    setProgressTaskSucceeded(false)
    setProgressPendingFinalUrl(false)
    setProgressStageLabel('')
  }, [])

  const showCompletedResult = useCallback((statusPayload, jobId, { immediate = false } = {}) => {
    const built = buildBuilder2VideoResult(statusPayload, generateMarketingText)
    if (!built.videoUrl) {
      setProgressPendingFinalUrl(true)
      setProgressStageLabel(BUILDER2_MSG_PREPARING_VIDEO_FILE)
      beginProgress(jobId)
      return false
    }

    updateBuilder2CurrentJobFromStatus(jobId, { ...statusPayload, status: 'done', completed: true })
    setFailureInfo(null)
    setOwnershipError(null)
    setIsDisconnected(false)
    setResumeAlreadyInProgress(false)

    if (immediate) {
      setVideoResult(built)
      setState(STATE.SUCCESS)
      setShowEmptyForm(false)
      setFieldsLocked(true)
      stopProgressUi()
      submitInFlightRef.current = false
      return true
    }

    pendingVideoResultRef.current = { result: built, jobId }
    setProgressTaskSucceeded(true)
    setProgressPendingFinalUrl(false)
    return true
  }, [beginProgress, stopProgressUi])

  const handleProgressRevealReady = useCallback(() => {
    const pending = pendingVideoResultRef.current
    if (pending?.result) {
      setErrorMessage(null)
      setErrorPanelTitle('Generation failed')
      setVideoResult(pending.result)
      setState(STATE.SUCCESS)
      setShowEmptyForm(false)
      setFieldsLocked(true)
    }
    pendingVideoResultRef.current = null
    stopProgressUi()
    setProgressTiming(null)
    submitInFlightRef.current = false
  }, [stopProgressUi])

  const handleFailureFromStatus = useCallback((statusPayload, jobId) => {
    const ownership = getBuilder2OwnershipErrorCode(statusPayload)
    if (ownership) {
      setOwnershipError(getBuilder2SafeFailureMessage(statusPayload))
      setFailureInfo(null)
      updateBuilder2CurrentJobFromStatus(jobId, statusPayload)
      stopProgressUi()
      setState(STATE.IDLE)
      setShowEmptyForm(false)
      return
    }

    const canResume = canBuilder2StatusResume(statusPayload)
    updateBuilder2CurrentJobFromStatus(jobId, statusPayload)
    stopProgressUi()
    setFailureInfo({
      message: getBuilder2SafeFailureMessage(statusPayload),
      canResume,
      jobId
    })
    setResumeAlreadyInProgress(isBuilder2ResumeAlreadyInProgress(statusPayload))
    setState(STATE.IDLE)
    setShowEmptyForm(false)
    setFieldsLocked(true)
  }, [stopProgressUi])

  const processStatusPayload = useCallback(
    async (jobId, statusPayload, { fromRestore = false } = {}) => {
      if (!jobId || !statusPayload) return 'continue'

      const responseJobId = String(statusPayload.jobId ?? statusPayload.job_id ?? jobId).trim()
      if (responseJobId && responseJobId !== jobId) {
        return 'stale'
      }

      const persisted = readBuilder2CurrentJob()
      if (persisted?.jobId && persisted.jobId !== jobId) {
        return 'stale'
      }

      if (isBuilder2ResumeAlreadyInProgress(statusPayload)) {
        setResumeAlreadyInProgress(true)
      }

      const ownership = getBuilder2OwnershipErrorCode(statusPayload)
      if (ownership) {
        handleFailureFromStatus(statusPayload, jobId)
        return 'terminal'
      }

      if (isBuilder2StatusCompleted(statusPayload)) {
        const finalUrl = resolveBuilder2FinalVideoUrl(statusPayload)
        if (!finalUrl) {
          applyPollProgressTiming(jobId, statusPayload)
          updateBuilder2CurrentJobFromStatus(jobId, statusPayload)
          setProgressPendingFinalUrl(true)
          setProgressStageLabel(BUILDER2_MSG_PREPARING_VIDEO_FILE)
          if (!showProgressBar) beginProgress(jobId)
          setIsDisconnected(false)
          setFailureInfo(null)
          setShowEmptyForm(false)
          return 'continue'
        }

        applyPollProgressTiming(jobId, statusPayload)
        tryApplyResolvedProductName(
          statusPayload,
          userLeftProductNameEmptyRef.current,
          lockedResolvedNameRef,
          fillingResolvedNameRef,
          setFormData,
          setIsProductNameAuto,
          setCanonicalResolvedProductName
        )
        showCompletedResult(statusPayload, jobId)
        setIsDisconnected(false)
        return 'terminal'
      }

      if (isBuilder2StatusFailed(statusPayload) && !canBuilder2StatusResume(statusPayload)) {
        handleFailureFromStatus(statusPayload, jobId)
        return 'terminal'
      }

      if (isBuilder2StatusFailed(statusPayload) && canBuilder2StatusResume(statusPayload)) {
        handleFailureFromStatus(statusPayload, jobId)
        return 'terminal'
      }

      const status = normalizeBuilder2Status(statusPayload)
      if (status === 'interrupted') {
        const ic = getInterruptCode(statusPayload)?.toLowerCase() ?? ''
        handleFailureFromStatus(
          {
            ...statusPayload,
            canResume: true,
            failureReason: ic === INTERRUPT_WORKER_SHUTDOWN ? MSG_WORKER_SHUTDOWN : statusPayload.error
          },
          jobId
        )
        return 'terminal'
      }

      if (isBuilder2StatusRunning(statusPayload) || status === 'running') {
        hadConfirmedRunningRef.current = true
        applyPollProgressTiming(jobId, statusPayload)
        updateBuilder2CurrentJobFromStatus(jobId, statusPayload)
        tryApplyResolvedProductName(
          statusPayload,
          userLeftProductNameEmptyRef.current,
          lockedResolvedNameRef,
          fillingResolvedNameRef,
          setFormData,
          setIsProductNameAuto,
          setCanonicalResolvedProductName
        )
        if (!showProgressBar || fromRestore) {
          beginProgress(jobId)
        }
        setIsDisconnected(false)
        setFailureInfo(null)
        setShowEmptyForm(false)
        return 'continue'
      }

      if (status === 'error' && !isTransientBuilder2PollFailure(statusPayload)) {
        handleFailureFromStatus(statusPayload, jobId)
        return 'terminal'
      }

      return 'continue'
    },
    [applyPollProgressTiming, beginProgress, handleFailureFromStatus, showCompletedResult, showProgressBar]
  )

  const runPollLoop = useCallback(
    async (jobId, generation) => {
      let consecutiveTransientPollErrors = 0
      pollStartedAtRef.current = Date.now()
      didLogLongRunningRef.current = false

      while (pollGenerationRef.current === generation) {
        const persisted = readBuilder2CurrentJob()
        if (persisted?.jobId && persisted.jobId !== jobId) {
          break
        }

        if (
          hadConfirmedRunningRef.current &&
          Date.now() - pollStartedAtRef.current >= POLL_LONG_RUNNING_NOTICE_MS &&
          !didLogLongRunningRef.current
        ) {
          didLogLongRunningRef.current = true
          setErrorPanelTitle('Please wait')
          setErrorMessage('Still processing… this can take a little longer.')
        }

        const controller = new AbortController()
        pollAbortRef.current = controller

        const st = await fetchVideoStatus(jobId, { signal: controller.signal })

        if (pollGenerationRef.current !== generation) {
          break
        }

        if (st?.aborted) {
          break
        }

        if (isTransientBuilder2PollFailure(st)) {
          consecutiveTransientPollErrors += 1
          setIsDisconnected(true)
          setErrorMessage(BUILDER2_MSG_DISCONNECTED)
          const backoffMs = Math.min(
            12000,
            POLL_INTERVAL_MS + consecutiveTransientPollErrors * 1500
          )
          await new Promise((resolve) => setTimeout(resolve, backoffMs))
          continue
        }

        if (consecutiveTransientPollErrors > 0) {
          consecutiveTransientPollErrors = 0
          setIsDisconnected(false)
          setErrorMessage(null)
        }

        const outcome = await processStatusPayload(jobId, st)
        if (outcome === 'stale') {
          break
        }
        if (outcome === 'terminal') {
          break
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
    },
    [processStatusPayload]
  )

  const startPolling = useCallback(
    (jobId) => {
      if (!jobId) return
      pollAbortRef.current?.abort()
      const generation = pollGenerationRef.current + 1
      pollGenerationRef.current = generation
      void runPollLoop(jobId, generation)
    },
    [runPollLoop]
  )

  const stopPolling = useCallback(() => {
    pollAbortRef.current?.abort()
    pollGenerationRef.current += 1
  }, [])

  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  useEffect(() => {
    ensureBuilder2OwnerContext()
    const persisted = readBuilder2CurrentJob()
    if (!persisted?.jobId) {
      setRestorePhase('done')
      setShowEmptyForm(true)
      return undefined
    }

    let cancelled = false
    const jobId = persisted.jobId
    activeJobIdRef.current = jobId
    progressActiveJobIdRef.current = jobId

    ;(async () => {
      if (persisted.completed) {
        const st = await fetchVideoStatus(jobId)
        if (cancelled) return
        if (isValidBuilder2VideoUrl(resolveBuilder2FinalVideoUrl(st))) {
          const built = buildBuilder2VideoResult(st, generateMarketingText)
          setVideoResult(built)
          setState(STATE.SUCCESS)
          setShowEmptyForm(false)
          setFieldsLocked(true)
        } else {
          beginProgress(jobId)
          startPolling(jobId)
        }
        setRestorePhase('done')
        return
      }

      const st = await fetchVideoStatus(jobId)
      if (cancelled) return

      const outcome = await processStatusPayload(jobId, st, { fromRestore: true })
      if (outcome !== 'terminal' && outcome !== 'stale') {
        startPolling(jobId)
      }
      setRestorePhase('done')
    })()

    return () => {
      cancelled = true
    }
  }, [beginProgress, processStatusPayload, startPolling])

  const handleSubmit = async (data) => {
    if (submitInFlightRef.current || videoResult) {
      return
    }

    if (readBuilder2CurrentJob()?.jobId) {
      return
    }

    submitInFlightRef.current = true
    userLeftProductNameEmptyRef.current = !data.productName?.trim()

    if (!userLeftProductNameEmptyRef.current) {
      lockedResolvedNameRef.current = null
    }
    setCanonicalResolvedProductName(null)
    setFailureInfo(null)
    setOwnershipError(null)
    setVideoResult(null)
    setIsDisconnected(false)
    setResumeAlreadyInProgress(false)
    setErrorMessage(null)
    setErrorPanelTitle('Generation failed')
    setFieldsLocked(true)
    setShowEmptyForm(false)
    hadConfirmedRunningRef.current = false

    try {
      const start = await generateVideo({
        productName: data.productName,
        productDescription: data.productDescription
      })

      if (start?.aborted) {
        submitInFlightRef.current = false
        return
      }

      const rawJobId = start?.jobId ?? start?.job_id
      const jobId = rawJobId != null && String(rawJobId).trim() ? String(rawJobId).trim() : null

      if (!start?.ok || !jobId) {
        submitInFlightRef.current = false
        setFieldsLocked(false)
        setShowEmptyForm(true)
        setErrorPanelTitle('Generation failed')
        setErrorMessage(
          start?.error || start?.message || 'Could not start video generation. Please try again.'
        )
        setState(STATE.IDLE)
        return
      }

      writeBuilder2CurrentJob({
        jobId,
        createdAt: new Date().toISOString(),
        lastKnownStatus: normalizeBuilder2Status(start) || 'queued',
        completed: false
      })

      activeJobIdRef.current = jobId
      progressActiveJobIdRef.current = jobId
      applyPollProgressTiming(jobId, start)
      beginProgress(jobId)

      tryApplyResolvedProductName(
        start,
        userLeftProductNameEmptyRef.current,
        lockedResolvedNameRef,
        fillingResolvedNameRef,
        setFormData,
        setIsProductNameAuto,
        setCanonicalResolvedProductName
      )

      startPolling(jobId)
    } catch (_) {
      submitInFlightRef.current = false
      setFieldsLocked(false)
      setShowEmptyForm(true)
      setErrorPanelTitle('Generation failed')
      setErrorMessage('Something went wrong. Please try again.')
      setState(STATE.IDLE)
      stopProgressUi()
    }
  }

  const handleResume = async () => {
    const jobId = failureInfo?.jobId ?? activeJobIdRef.current ?? readBuilder2CurrentJob()?.jobId
    if (!jobId || resumeInFlight || resumeAlreadyInProgress) {
      return
    }

    setResumeInFlight(true)
    setFailureInfo((prev) => (prev ? { ...prev, canResume: prev.canResume } : prev))
    setErrorMessage(null)

    try {
      const response = await resumeBuilder2Job(jobId)
      if (response?.aborted) {
        return
      }

      const ownership = getBuilder2OwnershipErrorCode(response)
      if (ownership) {
        setOwnershipError(getBuilder2SafeFailureMessage(response))
        setFailureInfo(null)
        return
      }

      if (isBuilder2ResumeAlreadyInProgress(response)) {
        setResumeAlreadyInProgress(true)
        setFailureInfo(null)
        beginProgress(jobId)
        startPolling(jobId)
        return
      }

      if (isBuilder2StatusCompleted(response)) {
        if (showCompletedResult(response, jobId, { immediate: true })) {
          return
        }
        beginProgress(jobId)
        startPolling(jobId)
        return
      }

      updateBuilder2CurrentJobFromStatus(jobId, response)
      setFailureInfo(null)
      setResumeAlreadyInProgress(false)
      beginProgress(jobId)
      startPolling(jobId)
    } catch (_) {
      setErrorMessage(BUILDER2_MSG_DISCONNECTED)
    } finally {
      setResumeInFlight(false)
    }
  }

  const handleStartNewVideo = () => {
    stopPolling()
    const jobId = activeJobIdRef.current ?? readBuilder2CurrentJob()?.jobId
    if (jobId) {
      clearBuilder2JobStartTime(jobId)
    }
    clearBuilder2CurrentJob()
    activeJobIdRef.current = null
    progressActiveJobIdRef.current = null
    progressJobStartMsRef.current = null
    pendingVideoResultRef.current = null
    lockedResolvedNameRef.current = null
    hadConfirmedRunningRef.current = false
    submitInFlightRef.current = false

    setVideoResult(null)
    setFailureInfo(null)
    setOwnershipError(null)
    setErrorMessage(null)
    setIsDisconnected(false)
    setResumeAlreadyInProgress(false)
    setState(STATE.IDLE)
    setShowEmptyForm(true)
    setFieldsLocked(false)
    setIsProductNameAuto(false)
    setCanonicalResolvedProductName(null)
    stopProgressUi()
    setProgressTiming(null)
    setProgressJobStartMs(null)
  }

  const handlePlaybackError = useCallback(async () => {
    const jobId = activeJobIdRef.current ?? readBuilder2CurrentJob()?.jobId
    if (!jobId) return
    const st = await fetchVideoStatus(jobId)
    const url = resolveBuilder2FinalVideoUrl(st)
    if (url) {
      setVideoResult((prev) => (prev ? { ...prev, videoUrl: url } : prev))
      updateBuilder2CurrentJobFromStatus(jobId, st)
    }
  }, [])

  const getButtonText = () => {
    if (videoResult) return 'CONSUMED'
    if (failureInfo || ownershipError) return 'CONSUMED'
    return 'GENERATE'
  }

  const isButtonDisabled = () => {
    return (
      state === STATE.GENERATING ||
      restorePhase === 'checking' ||
      Boolean(videoResult) ||
      Boolean(failureInfo) ||
      Boolean(ownershipError) ||
      submitInFlightRef.current
    )
  }

  const showForm = showEmptyForm && restorePhase === 'done' && !videoResult && !failureInfo && !ownershipError

  return (
    <div className="builder-page builder2-page">
      <div className="builder-title-block">
        <h1 className="builder-title">יוצר וידאו</h1>
      </div>

      {restorePhase === 'checking' ? (
        <p className="builder2-restore-message" dir="rtl" aria-live="polite">
          {BUILDER2_MSG_RESTORING}
        </p>
      ) : null}

      {isDisconnected && !failureInfo ? (
        <p className="builder2-disconnect-message" dir="rtl" aria-live="polite">
          {BUILDER2_MSG_DISCONNECTED}
        </p>
      ) : null}

      {resumeAlreadyInProgress && !showProgressBar ? (
        <p className="builder2-resume-in-progress" dir="rtl" aria-live="polite">
          {BUILDER2_MSG_RESUME_IN_PROGRESS}
        </p>
      ) : null}

      {showForm ? (
        <ProductForm2
          formData={formData}
          setFormData={setFormData}
          onSubmit={handleSubmit}
          fieldsLocked={fieldsLocked}
          buttonText={getButtonText()}
          buttonDisabled={isButtonDisabled()}
          showProgress={showProgressBar}
          progressActive={progressActive}
          progressKey={progressKey}
          progressTiming={progressTiming}
          progressStageLabel={progressStageLabel}
          progressPendingFinalUrl={progressPendingFinalUrl}
          progressTaskSucceeded={progressTaskSucceeded}
          progressTaskFailed={progressTaskFailed}
          onProgressRevealReady={handleProgressRevealReady}
          isProductNameAuto={isProductNameAuto}
          boldResolvedProductName={canonicalResolvedProductName}
          onProductNameEdited={() => {
            lockedResolvedNameRef.current = null
            setIsProductNameAuto(false)
            setCanonicalResolvedProductName(null)
          }}
        />
      ) : null}

      {!showForm && showProgressBar ? (
        <Builder2ProgressBar
          key={progressKey}
          progressKey={progressKey}
          visible={progressActive}
          progressTiming={progressTiming}
          progressStageLabel={progressStageLabel}
          pendingFinalUrl={progressPendingFinalUrl}
          taskSucceeded={progressTaskSucceeded}
          taskFailed={progressTaskFailed}
          onRevealReady={handleProgressRevealReady}
        />
      ) : null}

      {ownershipError ? (
        <ErrorPanel
          error={ownershipError}
          onRetry={() => setOwnershipError(null)}
          buttonLabel="Dismiss"
          title="Cannot restore job"
        />
      ) : null}

      {failureInfo ? (
        <div className="builder2-failure-panel" dir="rtl">
          <ErrorPanel
            error={failureInfo.message}
            onRetry={() => setErrorMessage(null)}
            buttonLabel="Dismiss"
            title="Generation failed"
          />
          {failureInfo.canResume ? (
            <button
              type="button"
              className="builder2-resume-button"
              onClick={handleResume}
              disabled={resumeInFlight || resumeAlreadyInProgress}
            >
              {BUILDER2_MSG_RESUME}
            </button>
          ) : null}
        </div>
      ) : null}

      {errorMessage && !failureInfo && !isDisconnected ? (
        <ErrorPanel
          error={errorMessage}
          onRetry={() => {
            setErrorMessage(null)
            setErrorPanelTitle('Generation failed')
          }}
          buttonLabel="Dismiss"
          title={errorPanelTitle}
        />
      ) : null}

      {videoResult ? (
        <div className="builder-results">
          <h2 className="results-title">Results</h2>
          <VideoAdCard
            attemptNumber={1}
            videoSrc={videoResult.videoUrl}
            marketingText={videoResult.marketingText}
            headline={videoResult.headline}
            headlineText={videoResult.headlineText}
            overlayHeadline={videoResult.overlayHeadline}
            productNameResolved={videoResult.productNameResolved}
            sessionId={videoResult.sessionId}
            isGenerating={state === STATE.GENERATING}
            onPlaybackError={handlePlaybackError}
          />
          <button type="button" className="builder2-new-video-button" onClick={handleStartNewVideo}>
            {BUILDER2_MSG_NEW_VIDEO}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default Builder2Page
