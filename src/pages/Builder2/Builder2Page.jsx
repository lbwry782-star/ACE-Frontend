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
  readBuilder2FormDraft,
  writeBuilder2FormDraft,
  clearBuilder2FormDraft
} from '../../utils/builder2FormDraft'
import {
  BUILDER2_MSG_RESTORING,
  BUILDER2_MSG_DISCONNECTED,
  BUILDER2_MSG_PREPARING_VIDEO_FILE,
  BUILDER2_MSG_NEW_VIDEO,
  normalizeBuilder2Status,
  isBuilder2StatusCompleted,
  isBuilder2StatusRunning,
  isBuilder2StatusFailed,
  isBuilder2TerminalNonRecoverableFailure,
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

const STATE = {
  IDLE: 'IDLE',
  GENERATING: 'GENERATING',
  SUCCESS: 'SUCCESS'
}

function readInitialFormState() {
  const draft = readBuilder2FormDraft()
  return {
    formData: {
      productName: draft?.productName ?? '',
      productDescription: draft?.productDescription ?? ''
    },
    isProductNameAuto: Boolean(draft?.isProductNameAuto),
    canonicalResolvedProductName: draft?.canonicalResolvedProductName ?? null
  }
}

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

function Builder2Page() {
  const initial = readInitialFormState()
  const [state, setState] = useState(STATE.IDLE)
  const [restorePhase, setRestorePhase] = useState('checking')
  const [videoResult, setVideoResult] = useState(null)
  const [failureInfo, setFailureInfo] = useState(null)
  const [ownershipError, setOwnershipError] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const [errorPanelTitle, setErrorPanelTitle] = useState('Generation failed')
  const [isDisconnected, setIsDisconnected] = useState(false)
  const [formData, setFormData] = useState(initial.formData)
  const [isProductNameAuto, setIsProductNameAuto] = useState(initial.isProductNameAuto)
  const [canonicalResolvedProductName, setCanonicalResolvedProductName] = useState(
    initial.canonicalResolvedProductName
  )
  const [progressActive, setProgressActive] = useState(false)
  const [progressKey, setProgressKey] = useState(0)
  const [showProgressBar, setShowProgressBar] = useState(false)
  const [progressTaskSucceeded, setProgressTaskSucceeded] = useState(false)
  const [progressTaskFailed, setProgressTaskFailed] = useState(false)
  const [progressPendingFinalUrl, setProgressPendingFinalUrl] = useState(false)
  const [progressTiming, setProgressTiming] = useState(null)
  const [progressStageLabel, setProgressStageLabel] = useState('')

  const submitInFlightRef = useRef(false)
  const pollGenerationRef = useRef(0)
  const pollAbortRef = useRef(null)
  const activeJobIdRef = useRef(null)
  const progressActiveJobIdRef = useRef(null)
  const progressJobStartMsRef = useRef(null)
  const pendingVideoResultRef = useRef(null)
  const lockedResolvedNameRef = useRef(initial.canonicalResolvedProductName)
  const fillingResolvedNameRef = useRef(false)
  const userLeftProductNameEmptyRef = useRef(false)
  const hadConfirmedRunningRef = useRef(false)
  const skipDraftPersistRef = useRef(true)

  const persistFormDraft = useCallback(
    (nextFormData, extras = {}) => {
      writeBuilder2FormDraft({
        productName: nextFormData.productName,
        productDescription: nextFormData.productDescription,
        isProductNameAuto:
          extras.isProductNameAuto !== undefined ? extras.isProductNameAuto : isProductNameAuto,
        canonicalResolvedProductName:
          extras.canonicalResolvedProductName !== undefined
            ? extras.canonicalResolvedProductName
            : canonicalResolvedProductName
      })
    },
    [isProductNameAuto, canonicalResolvedProductName]
  )

  useEffect(() => {
    skipDraftPersistRef.current = false
  }, [])

  useEffect(() => {
    if (skipDraftPersistRef.current || fillingResolvedNameRef.current) {
      fillingResolvedNameRef.current = false
      return
    }
    persistFormDraft(formData)
  }, [formData, persistFormDraft])

  const tryApplyResolvedProductName = useCallback(
    (payload) => {
      if (!userLeftProductNameEmptyRef.current) return
      const name = extractResolvedProductName(payload)
      if (!name) return
      if (lockedResolvedNameRef.current !== null) {
        if (name !== lockedResolvedNameRef.current) return
        setCanonicalResolvedProductName(lockedResolvedNameRef.current)
        setFormData((prev) => {
          const next = { ...prev, productName: lockedResolvedNameRef.current }
          persistFormDraft(next, {
            isProductNameAuto: true,
            canonicalResolvedProductName: lockedResolvedNameRef.current
          })
          return next
        })
        setIsProductNameAuto(true)
        return
      }
      lockedResolvedNameRef.current = name
      fillingResolvedNameRef.current = true
      setCanonicalResolvedProductName(name)
      setFormData((prev) => {
        const next = { ...prev, productName: name }
        persistFormDraft(next, { isProductNameAuto: true, canonicalResolvedProductName: name })
        return next
      })
      setIsProductNameAuto(true)
    },
    [persistFormDraft]
  )

  const applyPollProgressTiming = useCallback((jobId, statusPayload) => {
    const timing = reconcileBuilder2JobTiming(
      jobId,
      statusPayload,
      progressJobStartMsRef.current ?? Date.now()
    )
    progressJobStartMsRef.current = timing.startMs
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

  const stopPolling = useCallback(() => {
    pollAbortRef.current?.abort()
    pollGenerationRef.current += 1
  }, [])

  const showCompletedResult = useCallback(
    (statusPayload, jobId, { immediate = false } = {}) => {
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

      if (immediate) {
        setVideoResult(built)
        setState(STATE.SUCCESS)
        stopProgressUi()
        submitInFlightRef.current = false
        return true
      }

      pendingVideoResultRef.current = { result: built, jobId }
      setProgressTaskSucceeded(true)
      setProgressPendingFinalUrl(false)
      return true
    },
    [beginProgress, stopProgressUi]
  )

  const handleProgressRevealReady = useCallback(() => {
    const pending = pendingVideoResultRef.current
    if (pending?.result) {
      setErrorMessage(null)
      setErrorPanelTitle('Generation failed')
      setVideoResult(pending.result)
      setState(STATE.SUCCESS)
    }
    pendingVideoResultRef.current = null
    stopProgressUi()
    setProgressTiming(null)
    submitInFlightRef.current = false
  }, [stopProgressUi])

  const handleFailureFromStatus = useCallback(
    (statusPayload, jobId) => {
      const ownership = getBuilder2OwnershipErrorCode(statusPayload)
      if (ownership) {
        setOwnershipError(getBuilder2SafeFailureMessage(statusPayload))
        setFailureInfo(null)
        updateBuilder2CurrentJobFromStatus(jobId, statusPayload)
        stopProgressUi()
        setState(STATE.IDLE)
        return
      }

      updateBuilder2CurrentJobFromStatus(jobId, statusPayload)
      stopProgressUi()
      setFailureInfo({
        message: getBuilder2SafeFailureMessage(statusPayload),
        jobId
      })
      setState(STATE.IDLE)
    },
    [stopProgressUi]
  )

  const releasePersistedJobAssociation = useCallback(
    (jobId) => {
      stopPolling()
      if (jobId) {
        clearBuilder2JobStartTime(jobId)
      }
      clearBuilder2CurrentJob()
      activeJobIdRef.current = null
      progressActiveJobIdRef.current = null
      progressJobStartMsRef.current = null
      submitInFlightRef.current = false
      stopProgressUi()
      setProgressTiming(null)
    },
    [stopPolling, stopProgressUi]
  )

  const handleDismissFailure = useCallback(() => {
    const jobId =
      failureInfo?.jobId ?? activeJobIdRef.current ?? readBuilder2CurrentJob()?.jobId ?? null
    releasePersistedJobAssociation(jobId)
    setFailureInfo(null)
    setState(STATE.IDLE)
  }, [failureInfo, releasePersistedJobAssociation])

  const handleDismissOwnershipError = useCallback(() => {
    const jobId = activeJobIdRef.current ?? readBuilder2CurrentJob()?.jobId ?? null
    releasePersistedJobAssociation(jobId)
    setOwnershipError(null)
    setState(STATE.IDLE)
  }, [releasePersistedJobAssociation])

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
        setFailureInfo(null)
        if (!showProgressBar || fromRestore) {
          beginProgress(jobId)
        }
        return 'continue'
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
          return 'continue'
        }

        applyPollProgressTiming(jobId, statusPayload)
        tryApplyResolvedProductName(statusPayload)
        showCompletedResult(statusPayload, jobId)
        setIsDisconnected(false)
        return 'terminal'
      }

      if (isBuilder2StatusFailed(statusPayload)) {
        handleFailureFromStatus(statusPayload, jobId)
        return 'terminal'
      }

      const status = normalizeBuilder2Status(statusPayload)
      if (status === 'interrupted') {
        handleFailureFromStatus(
          {
            ...statusPayload,
            failureReason: getInterruptCode(statusPayload) ?? statusPayload.error
          },
          jobId
        )
        return 'terminal'
      }

      if (isBuilder2StatusRunning(statusPayload) || status === 'running') {
        hadConfirmedRunningRef.current = true
        applyPollProgressTiming(jobId, statusPayload)
        updateBuilder2CurrentJobFromStatus(jobId, statusPayload)
        tryApplyResolvedProductName(statusPayload)
        if (!showProgressBar || fromRestore) {
          beginProgress(jobId)
        }
        setIsDisconnected(false)
        setFailureInfo(null)
        return 'continue'
      }

      if (status === 'error' && !isTransientBuilder2PollFailure(statusPayload)) {
        handleFailureFromStatus(statusPayload, jobId)
        return 'terminal'
      }

      return 'continue'
    },
    [
      applyPollProgressTiming,
      beginProgress,
      handleFailureFromStatus,
      showCompletedResult,
      showProgressBar,
      tryApplyResolvedProductName
    ]
  )

  const runPollLoop = useCallback(
    async (jobId, generation) => {
      let consecutiveTransientPollErrors = 0

      while (pollGenerationRef.current === generation) {
        const persisted = readBuilder2CurrentJob()
        if (persisted?.jobId && persisted.jobId !== jobId) {
          break
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
      return undefined
    }

    let cancelled = false
    const jobId = persisted.jobId
    activeJobIdRef.current = jobId
    progressActiveJobIdRef.current = jobId

    ;(async () => {
      const st = await fetchVideoStatus(jobId)
      if (cancelled) return

      if (isBuilder2TerminalNonRecoverableFailure(st)) {
        releasePersistedJobAssociation(jobId)
        setFailureInfo(null)
        setOwnershipError(null)
        setIsDisconnected(false)
        setState(STATE.IDLE)
        setRestorePhase('done')
        return
      }

      if (persisted.completed) {
        if (isValidBuilder2VideoUrl(resolveBuilder2FinalVideoUrl(st))) {
          const built = buildBuilder2VideoResult(st, generateMarketingText)
          setVideoResult(built)
          setState(STATE.SUCCESS)
        } else {
          beginProgress(jobId)
          startPolling(jobId)
        }
        setRestorePhase('done')
        return
      }

      const outcome = await processStatusPayload(jobId, st, { fromRestore: true })
      if (outcome !== 'terminal' && outcome !== 'stale') {
        startPolling(jobId)
      }
      setRestorePhase('done')
    })()

    return () => {
      cancelled = true
    }
  }, [beginProgress, processStatusPayload, releasePersistedJobAssociation, startPolling])

  const handleSubmit = async (data) => {
    if (submitInFlightRef.current || readBuilder2CurrentJob()?.jobId) {
      return
    }

    submitInFlightRef.current = true
    userLeftProductNameEmptyRef.current = !data.productName?.trim()

    if (!userLeftProductNameEmptyRef.current) {
      lockedResolvedNameRef.current = null
    }
    setFailureInfo(null)
    setOwnershipError(null)
    setVideoResult(null)
    setIsDisconnected(false)
    setErrorMessage(null)
    setErrorPanelTitle('Generation failed')
    hadConfirmedRunningRef.current = false

    persistFormDraft(data, {
      isProductNameAuto: userLeftProductNameEmptyRef.current ? isProductNameAuto : false,
      canonicalResolvedProductName: userLeftProductNameEmptyRef.current
        ? canonicalResolvedProductName
        : null
    })

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
      tryApplyResolvedProductName(start)
      startPolling(jobId)
    } catch (_) {
      submitInFlightRef.current = false
      setErrorPanelTitle('Generation failed')
      setErrorMessage('Something went wrong. Please try again.')
      setState(STATE.IDLE)
      stopProgressUi()
    }
  }

  const handleStartNewVideo = () => {
    stopPolling()
    const jobId = activeJobIdRef.current ?? readBuilder2CurrentJob()?.jobId
    if (jobId) {
      clearBuilder2JobStartTime(jobId)
    }
    clearBuilder2CurrentJob()
    clearBuilder2FormDraft()
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
    setState(STATE.IDLE)
    setIsProductNameAuto(false)
    setCanonicalResolvedProductName(null)
    setFormData({ productName: '', productDescription: '' })
    stopProgressUi()
    setProgressTiming(null)
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

  const hasPersistedJob = Boolean(readBuilder2CurrentJob()?.jobId)
  const isActivelyProcessing = state === STATE.GENERATING || showProgressBar
  const fieldsReadOnly = isActivelyProcessing
  const submitDisabled =
    restorePhase === 'checking' ||
    hasPersistedJob ||
    submitInFlightRef.current ||
    isActivelyProcessing

  const getButtonText = () => {
    if (hasPersistedJob && !isActivelyProcessing) return 'GENERATE AGAIN'
    if (isActivelyProcessing) return 'GENERATING'
    return 'GENERATE'
  }

  void resumeBuilder2Job

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

      {isDisconnected ? (
        <p className="builder2-disconnect-message" dir="rtl" aria-live="polite">
          {BUILDER2_MSG_DISCONNECTED}
        </p>
      ) : null}

      <ProductForm2
        formData={formData}
        setFormData={setFormData}
        onSubmit={handleSubmit}
        fieldsReadOnly={fieldsReadOnly}
        buttonText={getButtonText()}
        buttonDisabled={submitDisabled}
        isProductNameAuto={isProductNameAuto}
        boldResolvedProductName={canonicalResolvedProductName}
        onProductNameEdited={() => {
          lockedResolvedNameRef.current = null
          setIsProductNameAuto(false)
          setCanonicalResolvedProductName(null)
        }}
      />

      {showProgressBar ? (
        <section className="builder2-progress-section" aria-live="polite">
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
        </section>
      ) : null}

      {ownershipError ? (
        <ErrorPanel
          error={ownershipError}
          onRetry={handleDismissOwnershipError}
          buttonLabel="Dismiss"
          title="Cannot restore job"
        />
      ) : null}

      {failureInfo ? (
        <div className="builder2-failure-panel" dir="rtl">
          <ErrorPanel
            error={failureInfo.message}
            onRetry={handleDismissFailure}
            buttonLabel="Dismiss"
            title="Generation failed"
          />
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
