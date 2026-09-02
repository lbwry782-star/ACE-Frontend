import { useState, useRef, useEffect, useCallback } from 'react'
import ProductForm2 from '../../components/Form/ProductForm2'
import Builder2ProgressBar from '../../components/ProgressBar/Builder2ProgressBar'
import VideoAdCard from '../../components/VideoAdCard/VideoAdCard'
import ErrorPanel from '../../components/Error/ErrorPanel'
import { generateVideo, generateVideoNext, fetchVideoStatus, cancelBuilder2Job, cancelBuilder2JobKeepalive } from '../../services/api'
import { ensureBuilder2OwnerContext } from '../../utils/builder2OwnerContext'
import {
  resolveBuilder2CheckoutTargetVideoCount
} from '../../utils/builder2VideoCheckout'
import {
  mergeBuilder2AllowanceState,
  buildBuilder2CompletedVideoFromEntry,
  parseBuilder2CompletedVideosFromStatus,
  upsertBuilder2CompletedVideo,
  getBuilder2GenerateButtonLabel,
  isBuilder2GenerateButtonDisabled,
  isBuilder2AllowanceConsumed
} from '../../utils/builder2Allowance'
import {
  registerBuilder2OfflineConsoleHelpers,
  resolveBuilder2OfflineTargetVideoCount
} from '../../utils/builder2OfflinePlaceholders'
import {
  readBuilder2CurrentJob,
  writeBuilder2CurrentJob,
  clearBuilder2CurrentJob,
  updateBuilder2CurrentJobFromStatus
} from '../../utils/builder2JobPersistence'
import {
  readBuilder2ActiveJob,
  writeBuilder2ActiveJob,
  clearBuilder2ActiveJob
} from '../../utils/builder2ActiveJob'
import { clearBuilder2FormDraft } from '../../utils/builder2FormDraft'
import {
  BUILDER2_MSG_CANCELLING,
  BUILDER2_MSG_CANCEL_BLOCKED,
  BUILDER2_MSG_DISCONNECTED,
  BUILDER2_MSG_PREPARING_VIDEO_FILE,
  normalizeBuilder2Status,
  isBuilder2StatusCompleted,
  isBuilder2StatusRunning,
  isBuilder2StatusFailed,
  isBuilder2CancelAcknowledged,
  isBuilder2ResumeAlreadyInProgress,
  isBuilder2OwnershipPollFailure,
  getBuilder2OwnershipErrorCode,
  getBuilder2SafeFailureMessage,
  buildBuilder2VideoResult,
  isTransientBuilder2PollFailure,
  resolveBuilder2FinalVideoUrl
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

const EMPTY_FORM_DATA = {
  productName: '',
  productDescription: ''
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
  const [state, setState] = useState(STATE.IDLE)
  const [initPhase, setInitPhase] = useState('checking')
  const [cancellationGate, setCancellationGate] = useState('ready')
  const [videoResult, setVideoResult] = useState(null)
  const [completedVideos, setCompletedVideos] = useState([])
  const [allowanceState, setAllowanceState] = useState(null)
  const [failureInfo, setFailureInfo] = useState(null)
  const [ownershipError, setOwnershipError] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const [errorPanelTitle, setErrorPanelTitle] = useState('Generation failed')
  const [isDisconnected, setIsDisconnected] = useState(false)
  const [formData, setFormData] = useState(EMPTY_FORM_DATA)
  const [isProductNameAuto, setIsProductNameAuto] = useState(false)
  const [canonicalResolvedProductName, setCanonicalResolvedProductName] = useState(null)
  const [progressActive, setProgressActive] = useState(false)
  const [progressKey, setProgressKey] = useState(0)
  const [showProgressBar, setShowProgressBar] = useState(false)
  const [progressTaskSucceeded, setProgressTaskSucceeded] = useState(false)
  const [progressTaskFailed, setProgressTaskFailed] = useState(false)
  const [progressPendingFinalUrl, setProgressPendingFinalUrl] = useState(false)
  const [progressTiming, setProgressTiming] = useState(null)
  const [progressStageLabel, setProgressStageLabel] = useState('')

  const submitInFlightRef = useRef(false)
  const generateNextInFlightRef = useRef(false)
  const allowanceLockedRef = useRef(false)
  const initialTargetVideoCountRef = useRef(1)
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
  const showProgressBarRef = useRef(false)

  useEffect(() => {
    clearBuilder2FormDraft()
    registerBuilder2OfflineConsoleHelpers()
    const offlineTarget = resolveBuilder2OfflineTargetVideoCount()
    if (offlineTarget === 1 || offlineTarget === 2) {
      initialTargetVideoCountRef.current = offlineTarget
    } else {
      const resolved = resolveBuilder2CheckoutTargetVideoCount({
        hash: window.location.hash,
        search: window.location.search
      })
      initialTargetVideoCountRef.current = resolved.targetVideoCount
    }
  }, [])

  const resetFreshFormFields = useCallback(() => {
    clearBuilder2FormDraft()
    lockedResolvedNameRef.current = null
    setFormData(EMPTY_FORM_DATA)
    setIsProductNameAuto(false)
    setCanonicalResolvedProductName(null)
  }, [])

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
        return next
      })
      setIsProductNameAuto(true)
    },
    []
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
    const isFreshProgressSession = !showProgressBarRef.current

    pendingVideoResultRef.current = null
    setProgressTaskFailed(false)
    setProgressTaskSucceeded(false)
    if (isFreshProgressSession) {
      setProgressPendingFinalUrl(false)
      setProgressStageLabel('')
      setProgressKey((prev) => prev + 1)
    }
    const startedAt =
      progressJobStartMsRef.current ??
      reconcileBuilder2JobTiming(jobId, {}, Date.now()).startMs
    progressJobStartMsRef.current = startedAt
    const timing = reconcileBuilder2JobTiming(jobId, { progressStartedAt: startedAt }, startedAt)
    setProgressTiming(timing)
    setProgressActive(true)
    setShowProgressBar(true)
    showProgressBarRef.current = true
    setState(STATE.GENERATING)
  }, [])

  const stopProgressUi = useCallback(() => {
    setProgressActive(false)
    setShowProgressBar(false)
    showProgressBarRef.current = false
    setProgressTaskSucceeded(false)
    setProgressPendingFinalUrl(false)
    setProgressStageLabel('')
  }, [])

  const stopPolling = useCallback(() => {
    pollAbortRef.current?.abort()
    pollGenerationRef.current += 1
  }, [])

  const resetFreshGenerationUi = useCallback(() => {
    stopPolling()
    activeJobIdRef.current = null
    progressActiveJobIdRef.current = null
    progressJobStartMsRef.current = null
    pendingVideoResultRef.current = null
    lockedResolvedNameRef.current = null
    hadConfirmedRunningRef.current = false
    submitInFlightRef.current = false

    setVideoResult(null)
    setCompletedVideos([])
    setAllowanceState(null)
    allowanceLockedRef.current = false
    generateNextInFlightRef.current = false
    setFailureInfo(null)
    setOwnershipError(null)
    setErrorMessage(null)
    setIsDisconnected(false)
    setState(STATE.IDLE)
    stopProgressUi()
    setProgressTiming(null)
    resetFreshFormFields()
  }, [resetFreshFormFields, stopPolling, stopProgressUi])

  const applyAllowanceAndCompletedVideos = useCallback((statusPayload, jobId) => {
    setAllowanceState((prev) => {
      const merged = mergeBuilder2AllowanceState(prev, statusPayload)
      if (merged?.videoAllowanceId) {
        allowanceLockedRef.current = true
      }
      return merged
    })

    const fromVideos = parseBuilder2CompletedVideosFromStatus(statusPayload)
    if (fromVideos.length > 0) {
      setCompletedVideos(fromVideos)
      return
    }

    const built = buildBuilder2CompletedVideoFromEntry(
      {
        ...statusPayload,
        jobId: statusPayload?.jobId ?? statusPayload?.job_id ?? jobId
      },
      statusPayload
    )
    if (built) {
      setCompletedVideos((prev) => upsertBuilder2CompletedVideo(prev, built))
    }
  }, [])

  const showCompletedResult = useCallback(
    (statusPayload, jobId, { immediate = false } = {}) => {
      const built = buildBuilder2VideoResult(statusPayload)
      if (!built.videoUrl) {
        setProgressPendingFinalUrl(true)
        setProgressStageLabel(BUILDER2_MSG_PREPARING_VIDEO_FILE)
        if (!showProgressBarRef.current) {
          beginProgress(jobId)
        }
        return false
      }

      updateBuilder2CurrentJobFromStatus(jobId, { ...statusPayload, status: 'done', completed: true })
      clearBuilder2ActiveJob()
      clearBuilder2CurrentJob()
      setFailureInfo(null)
      setOwnershipError(null)
      setIsDisconnected(false)

      const completedEntry = buildBuilder2CompletedVideoFromEntry(
        {
          ...statusPayload,
          jobId: statusPayload?.jobId ?? statusPayload?.job_id ?? jobId,
          videoUrl: built.videoUrl,
          marketingText: built.marketingText,
          headline: built.headline,
          headlineText: built.headlineText,
          overlayHeadline: built.overlayHeadline,
          productNameResolved: built.productNameResolved,
          sessionId: built.sessionId,
          isPlaceholder: built.isPlaceholder,
          placeholderLabel: built.placeholderLabel
        },
        statusPayload
      )

      if (immediate) {
        applyAllowanceAndCompletedVideos(statusPayload, jobId)
        if (completedEntry) {
          setCompletedVideos((prev) => upsertBuilder2CompletedVideo(prev, completedEntry))
        }
        setVideoResult(built)
        setState(STATE.SUCCESS)
        stopProgressUi()
        submitInFlightRef.current = false
        generateNextInFlightRef.current = false
        return true
      }

      pendingVideoResultRef.current = { result: built, jobId, statusPayload, completedEntry }
      setProgressTaskSucceeded(true)
      setProgressPendingFinalUrl(false)
      return true
    },
    [applyAllowanceAndCompletedVideos, beginProgress, stopProgressUi]
  )

  const handleProgressRevealReady = useCallback(() => {
    const pending = pendingVideoResultRef.current
    if (pending?.result) {
      setErrorMessage(null)
      setErrorPanelTitle('Generation failed')
      if (pending.statusPayload) {
        applyAllowanceAndCompletedVideos(pending.statusPayload, pending.jobId)
      }
      if (pending.completedEntry) {
        setCompletedVideos((prev) => upsertBuilder2CompletedVideo(prev, pending.completedEntry))
      } else {
        setVideoResult(pending.result)
      }
      setState(STATE.SUCCESS)
    }
    pendingVideoResultRef.current = null
    stopProgressUi()
    setProgressTiming(null)
    submitInFlightRef.current = false
    generateNextInFlightRef.current = false
    clearBuilder2ActiveJob()
  }, [applyAllowanceAndCompletedVideos, stopProgressUi])

  const handleFailureFromStatus = useCallback(
    (statusPayload, jobId) => {
      const ownership = getBuilder2OwnershipErrorCode(statusPayload)
      if (ownership) {
        setOwnershipError(getBuilder2SafeFailureMessage(statusPayload))
        setFailureInfo(null)
        updateBuilder2CurrentJobFromStatus(jobId, statusPayload)
        clearBuilder2ActiveJob()
        stopProgressUi()
        setState(STATE.IDLE)
        return
      }

      updateBuilder2CurrentJobFromStatus(jobId, statusPayload)
      clearBuilder2ActiveJob()
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
      clearBuilder2ActiveJob()
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
    resetFreshFormFields()
    setFailureInfo(null)
    setState(STATE.IDLE)
  }, [failureInfo, releasePersistedJobAssociation, resetFreshFormFields])

  const handleDismissOwnershipError = useCallback(() => {
    const jobId = activeJobIdRef.current ?? readBuilder2CurrentJob()?.jobId ?? null
    releasePersistedJobAssociation(jobId)
    resetFreshFormFields()
    setOwnershipError(null)
    setState(STATE.IDLE)
  }, [releasePersistedJobAssociation, resetFreshFormFields])

  const processStatusPayload = useCallback(
    async (jobId, statusPayload) => {
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
        if (!showProgressBar) {
          beginProgress(jobId)
        }
        return 'continue'
      }

      const ownership = getBuilder2OwnershipErrorCode(statusPayload)
      if (ownership) {
        handleFailureFromStatus(statusPayload, jobId)
        return 'terminal'
      }

      setAllowanceState((prev) => mergeBuilder2AllowanceState(prev, statusPayload))

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
        if (!showProgressBar) {
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
      tryApplyResolvedProductName,
      mergeBuilder2AllowanceState
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

        if (isBuilder2OwnershipPollFailure(st)) {
          await processStatusPayload(jobId, st)
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
    const onPageHide = () => {
      const activeJob = readBuilder2ActiveJob()
      if (!activeJob?.jobId) return
      cancelBuilder2JobKeepalive(activeJob.jobId, { reason: 'frontend_refresh' })
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])

  useEffect(() => {
    ensureBuilder2OwnerContext()
    resetFreshGenerationUi()
    clearBuilder2CurrentJob()

    const activeJob = readBuilder2ActiveJob()
    if (!activeJob?.jobId) {
      setCancellationGate('ready')
      setInitPhase('done')
      return undefined
    }

    let cancelled = false
    const jobId = activeJob.jobId
    setCancellationGate('pending')
    setInitPhase('cancelling')

    ;(async () => {
      const result = await cancelBuilder2Job(jobId)
      if (cancelled) return

      if (isBuilder2CancelAcknowledged(result)) {
        clearBuilder2ActiveJob()
        clearBuilder2CurrentJob()
        clearBuilder2JobStartTime(jobId)
        setCancellationGate('ready')
      } else {
        setCancellationGate('blocked')
        setErrorMessage(BUILDER2_MSG_CANCEL_BLOCKED)
      }
      setInitPhase('done')
    })()

    return () => {
      cancelled = true
    }
  }, [resetFreshGenerationUi])

  const handleSubmit = async (data) => {
    const persistedJob = readBuilder2CurrentJob()
    const hasActiveIncompleteJob = Boolean(persistedJob?.jobId && !persistedJob?.completed)
    const isGenerateNext = Boolean(
      allowanceState?.canGenerateNext && allowanceState?.videoAllowanceId && !hasActiveIncompleteJob
    )

    if (
      submitInFlightRef.current ||
      (isGenerateNext && generateNextInFlightRef.current) ||
      cancellationGate !== 'ready' ||
      initPhase !== 'done' ||
      (hasActiveIncompleteJob && !isGenerateNext) ||
      state === STATE.GENERATING ||
      showProgressBar
    ) {
      return
    }

    if (isBuilder2AllowanceConsumed(allowanceState)) {
      return
    }

    submitInFlightRef.current = true
    if (isGenerateNext) {
      generateNextInFlightRef.current = true
    }

    userLeftProductNameEmptyRef.current = !data.productName?.trim()

    if (!userLeftProductNameEmptyRef.current) {
      lockedResolvedNameRef.current = null
    }
    setFailureInfo(null)
    setOwnershipError(null)
    if (!isGenerateNext) {
      setVideoResult(null)
      if (!allowanceLockedRef.current) {
        setCompletedVideos([])
        setAllowanceState(null)
      }
    }
    setIsDisconnected(false)
    setErrorMessage(null)
    setErrorPanelTitle('Generation failed')
    hadConfirmedRunningRef.current = false

    try {
      let start
      if (isGenerateNext) {
        start = await generateVideoNext({
          videoAllowanceId: allowanceState.videoAllowanceId
        })
      } else {
        const targetVideoCount = allowanceLockedRef.current
          ? allowanceState?.targetVideoCount ?? initialTargetVideoCountRef.current ?? 1
          : initialTargetVideoCountRef.current ?? 1
        start = await generateVideo({
          productName: data.productName,
          productDescription: data.productDescription,
          targetVideoCount
        })
      }

      if (start?.aborted) {
        submitInFlightRef.current = false
        generateNextInFlightRef.current = false
        return
      }

      const rawJobId = start?.jobId ?? start?.job_id
      const jobId = rawJobId != null && String(rawJobId).trim() ? String(rawJobId).trim() : null

      if (start?.ok === false || !jobId) {
        submitInFlightRef.current = false
        generateNextInFlightRef.current = false
        setErrorPanelTitle('Generation failed')
        setErrorMessage(
          start?.error || start?.message || 'Could not start video generation. Please try again.'
        )
        setState(STATE.IDLE)
        return
      }

      setAllowanceState((prev) => {
        const merged = mergeBuilder2AllowanceState(prev, start)
        if (merged?.videoAllowanceId) {
          allowanceLockedRef.current = true
        }
        return merged
      })

      writeBuilder2CurrentJob({
        jobId,
        createdAt: new Date().toISOString(),
        lastKnownStatus: normalizeBuilder2Status(start) || 'queued',
        completed: false
      })
      writeBuilder2ActiveJob({ jobId })

      activeJobIdRef.current = jobId
      progressActiveJobIdRef.current = jobId
      applyPollProgressTiming(jobId, start)
      beginProgress(jobId)
      if (!isGenerateNext) {
        tryApplyResolvedProductName(start)
      }
      startPolling(jobId)
    } catch (_) {
      submitInFlightRef.current = false
      generateNextInFlightRef.current = false
      setErrorPanelTitle('Generation failed')
      setErrorMessage('Something went wrong. Please try again.')
      setState(STATE.IDLE)
      stopProgressUi()
    }
  }

  const persistedJob = readBuilder2CurrentJob()
  const hasActiveIncompleteJob = Boolean(persistedJob?.jobId && !persistedJob?.completed)
  const isActivelyProcessing = state === STATE.GENERATING || showProgressBar
  const fieldsReadOnly = isActivelyProcessing
  const allowanceConsumed = isBuilder2AllowanceConsumed(allowanceState)
  const submitDisabled = isBuilder2GenerateButtonDisabled({
    initBlocked: initPhase !== 'done' || cancellationGate !== 'ready',
    isActivelyProcessing,
    submitInFlight: submitInFlightRef.current || generateNextInFlightRef.current,
    hasActiveIncompleteJob,
    consumed: allowanceConsumed,
    canGenerateNext: Boolean(allowanceState?.canGenerateNext)
  })

  const getButtonText = () => {
    if (cancellationGate === 'pending') return 'GENERATE'
    return getBuilder2GenerateButtonLabel({
      isActivelyProcessing,
      consumed: allowanceConsumed,
      canGenerateNext: Boolean(allowanceState?.canGenerateNext)
    })
  }

  const handlePlaybackError = useCallback(async (jobId) => {
    const resolvedJobId = jobId ?? activeJobIdRef.current ?? readBuilder2CurrentJob()?.jobId
    if (!resolvedJobId) return
    const st = await fetchVideoStatus(resolvedJobId)
    const url = resolveBuilder2FinalVideoUrl(st)
    if (url) {
      setCompletedVideos((prev) =>
        prev.map((video) =>
          video.jobId === resolvedJobId ? { ...video, videoUrl: url } : video
        )
      )
      setVideoResult((prev) => (prev ? { ...prev, videoUrl: url } : prev))
      updateBuilder2CurrentJobFromStatus(resolvedJobId, st)
    }
  }, [])

  return (
    <div className="builder-page builder2-page">
      <div className="builder-title-block">
        <h1 className="builder-title">יוצר וידאו</h1>
        <span className="builder2-warning" dir="rtl">
          אין לרענן את הדף!
        </span>
      </div>

      {initPhase === 'cancelling' ? (
        <p className="builder2-restore-message" dir="rtl" aria-live="polite">
          {BUILDER2_MSG_CANCELLING}
        </p>
      ) : null}

      {cancellationGate === 'blocked' ? (
        <p className="builder2-cancel-blocked-message" dir="rtl" aria-live="polite">
          {BUILDER2_MSG_CANCEL_BLOCKED}
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

      {completedVideos.length > 0 ? (
        <div className="builder-results">
          <h2 className="results-title">Results</h2>
          {completedVideos.map((video) => (
            <VideoAdCard
              key={video.jobId}
              attemptNumber={video.videoIndex}
              jobId={video.jobId}
              videoSrc={video.videoUrl}
              marketingText={video.marketingText}
              headline={video.headline}
              headlineText={video.headlineText}
              overlayHeadline={video.overlayHeadline}
              productNameResolved={video.productNameResolved}
              placeholderLabel={video.placeholderLabel}
              isGenerating={false}
              onPlaybackError={() => handlePlaybackError(video.jobId)}
            />
          ))}
        </div>
      ) : videoResult ? (
        <div className="builder-results">
          <h2 className="results-title">Results</h2>
          <VideoAdCard
            attemptNumber={1}
            jobId={videoResult.jobId}
            videoSrc={videoResult.videoUrl}
            marketingText={videoResult.marketingText}
            headline={videoResult.headline}
            headlineText={videoResult.headlineText}
            overlayHeadline={videoResult.overlayHeadline}
            productNameResolved={videoResult.productNameResolved}
            placeholderLabel={videoResult.placeholderLabel}
            isGenerating={state === STATE.GENERATING}
            onPlaybackError={() => handlePlaybackError(videoResult.jobId)}
          />
        </div>
      ) : null}
    </div>
  )
}

export default Builder2Page
