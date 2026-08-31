import { useState, useRef, useEffect, useCallback, useContext } from 'react'
import ProductForm from '../../components/Form/ProductForm'
import AdCard from '../../components/AdCard/AdCard'
import ErrorPanel from '../../components/Error/ErrorPanel'
import { SecurityConfigContext } from '../../App'
import { fetchLatestPaid, NetworkError, ApiError } from '../../services/api'
import {
  builder1Generate,
  builder1GenerateNext,
  builder1RepairPhysical,
  pollBuilder1Job,
  cancelBuilder1Job,
  cancelBuilder1JobKeepalive,
  builder1DownloadZip,
  callBuilder1MutationWithRetry,
  replayBuilder1PendingMutation
} from '../../services/builder1Api'
import { ensureBuilder1OwnerContext } from '../../utils/builder1OwnerContext'
import { createBuilder1RequestId } from '../../utils/builder1RequestId'
import {
  readBuilder1PendingMutation,
  writeBuilder1PendingMutation,
  updateBuilder1PendingMutation,
  clearBuilder1PendingMutation,
  isUnresolvedBuilder1PendingMutation
} from '../../utils/builder1PendingMutation'
import {
  readBuilder1ActiveJob,
  writeBuilder1ActiveJob,
  clearBuilder1ActiveJob
} from '../../utils/builder1ActiveJob'
import {
  BUILDER1_MSG_CANCEL_BLOCKED,
  BUILDER1_MSG_CANCELLING,
  BUILDER1_MSG_OWNERSHIP,
  BUILDER1_MSG_IDEMPOTENCY_CONFLICT,
  isBuilder1CancelAcknowledged,
  isBuilder1CampaignAuthoritativelyReady,
  isBuilder1CampaignDeliveryPending,
  isBuilder1IdempotencyConflict,
  extractBuilder1MutationJobIds
} from '../../utils/builder1Status'
import {
  readBuilder1CampaignAdCount,
  resolveBuilder1InitialAdCount,
  getBuilder1GenerateButtonLabel,
  normalizeBuilder1FormatForApi,
  validateInitialCampaignResponse,
  validateNextAdResponse,
  createCampaignSessionFromInitial,
  appendAdToSession,
  buildInitialGeneratePayload,
  buildSingleAdZipRequest,
  sanitizeSingleAdZipFilename,
  getStageLabel,
  createDevMockInitialCampaign,
  createDevMockNextAd,
  parseRateLimitError,
  sortAdsByIndex,
  validateBuilder1InitialSubmitInputs,
  getBuilder1ProductNameGenerationFailedMessage,
  getBuilder1ProductDescriptionFieldMessage,
  resolveBuilder1GenerationFormError,
  parseBuilder1ApiErrorCode,
  BUILDER1_PRODUCT_NAME_GENERATION_FAILED,
  BUILDER1_MISSING_PRODUCT_DESCRIPTION,
  BUILDER1_IMAGE_COMPLIANCE_FAILED,
  BUILDER1_IMAGE_COMPLIANCE_UNAVAILABLE,
  isBuilder1ImageComplianceError,
  getBuilder1ImageComplianceFailedMessage,
  getBuilder1ImageComplianceUnavailableMessage,
  getBuilder1ImageComplianceMessage,
  resolveBuilder1RetryErrorResponse,
  parseBuilder1RetryContext,
  getBuilder1RetryModeProgressLabel,
  buildBuilder1GenerateNextPayload,
  buildBuilder1RepairPhysicalPayload,
  BUILDER1_RETRY_MODE
} from '../../utils/builder1Campaign'
import {
  BUILDER1_INITIAL_ESTIMATED_DURATION_MS,
  BUILDER1_NEXT_AD_ESTIMATED_DURATION_MS,
  BUILDER1_PROGRESS_OPERATION,
  getBuilder1EstimatedDurationForOperation,
  resolveBuilder1JobStartTime,
  clearBuilder1JobStartTime
} from '../../utils/builder1Progress'
import './builder.css'

const BUILDER1_ACCESS_GUARD_DISABLED = true
const PREVIEW_REDIRECT_URL = 'https://ace-advertising.agency/#/preview'
const POLL_INTERVAL_MS = 2000

const STATE = {
  IDLE: 'IDLE',
  GENERATING: 'GENERATING',
  GENERATING_NEXT: 'GENERATING_NEXT',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR'
}

const redirectToPreview = () => {
  if (BUILDER1_ACCESS_GUARD_DISABLED) return
  window.location.href = PREVIEW_REDIRECT_URL
}

function hasBuilder1DevQueryUnlock() {
  if (typeof window === 'undefined') return false
  const hash = window.location.hash || ''
  if (hash.includes('?')) {
    const query = hash.split('?').slice(1).join('?')
    if (new URLSearchParams(query).get('dev') === '1') return true
  }
  try {
    if (new URLSearchParams(window.location.search || '').get('dev') === '1') return true
  } catch (_) {
    /* ignore */
  }
  return false
}

function isBuilder1DevAccessBypass() {
  if (BUILDER1_ACCESS_GUARD_DISABLED) return true
  if (typeof window === 'undefined') return false
  if (hasBuilder1DevQueryUnlock()) return true
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') return true
  return Boolean(import.meta.env?.DEV)
}

function mapUserFacingError(err, code) {
  const raw = String(err?.message ?? err ?? 'Generation failed')
  const lower = raw.toLowerCase()
  const errCode = String(code ?? err?.code ?? '').toLowerCase()

  if (err instanceof NetworkError || err?.isNetworkError || errCode === 'network_error') {
    return 'Network error: Unable to connect to server. Please check your connection and try again.'
  }
  if (lower.includes('timed out') || lower.includes('timeout') || errCode === 'generation_timeout') {
    return 'Generation timed out. Please try again.'
  }
  if (lower.includes('response_contract') || errCode === 'response_contract_invalid') {
    return 'The server returned an invalid campaign response. Please try again.'
  }
  if (errCode === 'invalid_ad_count' || lower.includes('invalid_ad_count')) {
    return 'Invalid campaign size. Please refresh and try again.'
  }
  if (
    errCode === BUILDER1_PRODUCT_NAME_GENERATION_FAILED ||
    lower.includes(BUILDER1_PRODUCT_NAME_GENERATION_FAILED)
  ) {
    return getBuilder1ProductNameGenerationFailedMessage('he')
  }
  if (
    errCode === BUILDER1_MISSING_PRODUCT_DESCRIPTION ||
    lower.includes(BUILDER1_MISSING_PRODUCT_DESCRIPTION)
  ) {
    return getBuilder1ProductDescriptionFieldMessage('he')
  }
  if (isBuilder1ImageComplianceError(errCode)) {
    return getBuilder1ImageComplianceMessage(errCode, 'he')
  }
  if (errCode === 'planning_failed' || lower.includes('planning_failed')) {
    return 'Campaign planning failed. Please try again.'
  }
  if (errCode === 'image_generation_failed' || lower.includes('image_generation')) {
    return 'Image generation failed. Please try again.'
  }
  if (errCode === 'campaign_not_found' || errCode === 'campaign_expired') {
    return 'Campaign session expired. Please start a new campaign.'
  }
  if (errCode === 'campaign_complete') {
    return 'This campaign is already complete.'
  }
  if (errCode === 'campaign_index_conflict' || errCode === 'campaign_generation_in_progress') {
    return 'Campaign generation is already in progress. Please wait.'
  }
  if (errCode === 'image_rate_limited' || errCode === 'rate_limited') {
    return 'Image generation is temporarily busy. Please try again shortly.'
  }
  if (lower.includes('not_found') || lower.includes('job_not_found')) {
    return 'Campaign job not found. Please start a new campaign.'
  }
  return raw
}

function BuilderPage() {
  const { securityEnabled = true, securityConfigLoaded = false } = useContext(SecurityConfigContext)
  const [state, setState] = useState(STATE.IDLE)
  const [targetAdCount, setTargetAdCount] = useState(() => readBuilder1CampaignAdCount())
  const [campaignSession, setCampaignSession] = useState(null)
  const [formData, setFormData] = useState({
    productName: '',
    productDescription: '',
    imageSize: ''
  })
  const [isProductNameAuto, setIsProductNameAuto] = useState(false)
  const [fieldsLocked, setFieldsLocked] = useState(false)
  const [error, setError] = useState(null)
  const [isDevMock, setIsDevMock] = useState(false)
  const [progressActive, setProgressActive] = useState(false)
  const [isCompletingProgress, setIsCompletingProgress] = useState(false)
  const [progressKey, setProgressKey] = useState(0)
  const [showProgressBar, setShowProgressBar] = useState(false)
  const [stageLabel, setStageLabel] = useState('')
  const [progressEstimatedDurationMs, setProgressEstimatedDurationMs] = useState(
    BUILDER1_INITIAL_ESTIMATED_DURATION_MS
  )
  const [progressTaskSucceeded, setProgressTaskSucceeded] = useState(false)
  const [progressTaskFailed, setProgressTaskFailed] = useState(false)
  const [progressOperationType, setProgressOperationType] = useState(
    BUILDER1_PROGRESS_OPERATION.INITIAL_CAMPAIGN
  )
  const [progressJobStartMs, setProgressJobStartMs] = useState(null)
  const [rateLimitState, setRateLimitState] = useState(null)
  const [retryCountdown, setRetryCountdown] = useState(0)
  const [zipStateByAd, setZipStateByAd] = useState({})
  const [formFieldErrors, setFormFieldErrors] = useState({ productName: null, productDescription: null })
  const [complianceRetryMessage, setComplianceRetryMessage] = useState(null)
  const [builder1RetryContext, setBuilder1RetryContext] = useState(null)
  const [cancellationGate, setCancellationGate] = useState('ready')
  const [initPhase, setInitPhase] = useState('checking')
  const [ownershipError, setOwnershipError] = useState(null)
  const [isPollDisconnected, setIsPollDisconnected] = useState(false)

  const sidRef = useRef(null)
  const bootstrapCompleteRef = useRef(false)
  const fromPaymentCheckDoneRef = useRef(false)
  const generateRequestInFlightRef = useRef(false)
  const fillingResolvedNameRef = useRef(false)
  const initialPollTokenRef = useRef(0)
  const nextPollTokenRef = useRef(0)
  const mountedRef = useRef(true)
  const lockedTargetAdCountRef = useRef(null)
  const pendingRevealRef = useRef(null)
  const progressModeRef = useRef('initial')
  const progressLanguageRef = useRef('he')
  const progressJobStartMsRef = useRef(null)
  const progressActiveJobIdRef = useRef(null)

  const clearProgressJobTiming = useCallback((jobId = progressActiveJobIdRef.current) => {
    if (jobId) {
      clearBuilder1JobStartTime(jobId)
    }
    progressActiveJobIdRef.current = null
    progressJobStartMsRef.current = null
    setProgressJobStartMs(null)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      initialPollTokenRef.current += 1
      nextPollTokenRef.current += 1
      clearProgressJobTiming(progressActiveJobIdRef.current)
    }
  }, [clearProgressJobTiming])

  useEffect(() => {
    const stored = readBuilder1CampaignAdCount()
    setTargetAdCount(stored)
    if (lockedTargetAdCountRef.current == null) {
      lockedTargetAdCountRef.current = stored
    }
  }, [])

  useEffect(() => {
    if (!rateLimitState?.retryAvailableAt) {
      setRetryCountdown(0)
      return undefined
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((rateLimitState.retryAvailableAt - Date.now()) / 1000))
      setRetryCountdown(remaining)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [rateLimitState])

  useEffect(() => {
    if (BUILDER1_ACCESS_GUARD_DISABLED) {
      let baseHash = window.location.hash
      let sidFromUrl = null
      if (window.location.hash && window.location.hash.includes('?')) {
        const hashParts = window.location.hash.split('?')
        baseHash = hashParts[0]
        const hashParams = new URLSearchParams(hashParts[1])
        sidFromUrl = hashParams.get('sid')
        if (sidFromUrl) {
          sidRef.current = sidFromUrl
          window.history.replaceState(null, '', baseHash)
        }
      }
      if (!sidFromUrl && window.location.search) {
        const searchParams = new URLSearchParams(window.location.search)
        sidFromUrl = searchParams.get('sid')
        if (sidFromUrl) {
          sidRef.current = sidFromUrl
          const clean = window.location.pathname + (window.location.hash || '#/builder')
          window.history.replaceState(null, '', clean)
        }
      }
      bootstrapCompleteRef.current = true
      fromPaymentCheckDoneRef.current = true
      return
    }

    if (!securityConfigLoaded) return
    if (!securityEnabled) {
      bootstrapCompleteRef.current = true
      return
    }
    if (bootstrapCompleteRef.current || fromPaymentCheckDoneRef.current) return

    let baseHash = window.location.hash
    let sidFromUrl = null
    let fromPayment = false

    if (window.location.hash && window.location.hash.includes('?')) {
      const hashParts = window.location.hash.split('?')
      baseHash = hashParts[0]
      const hashParams = new URLSearchParams(hashParts[1])
      sidFromUrl = hashParams.get('sid')
      fromPayment = hashParams.get('fromPayment') === '1'
      if (sidFromUrl) {
        sidRef.current = sidFromUrl
        bootstrapCompleteRef.current = true
        window.history.replaceState(null, '', baseHash)
        return
      }
    }

    if (!sidFromUrl && !fromPayment && window.location.search) {
      const searchParams = new URLSearchParams(window.location.search)
      sidFromUrl = searchParams.get('sid')
      fromPayment = searchParams.get('fromPayment') === '1'
      if (sidFromUrl) {
        sidRef.current = sidFromUrl
        bootstrapCompleteRef.current = true
        const clean = window.location.pathname + (window.location.hash || '#/builder')
        window.history.replaceState(null, '', clean)
        return
      }
    }

    if (sidRef.current) {
      bootstrapCompleteRef.current = true
      return
    }

    if (fromPayment) {
      fromPaymentCheckDoneRef.current = true
      fetchLatestPaid()
        .then((data) => {
          if (data.sid && data.status === 'paid') {
            sidRef.current = data.sid
            bootstrapCompleteRef.current = true
            const cleanUrl = window.location.search
              ? window.location.pathname + baseHash
              : baseHash
            window.history.replaceState(null, '', cleanUrl)
            return
          }
          if (!BUILDER1_ACCESS_GUARD_DISABLED && !isBuilder1DevAccessBypass()) {
            redirectToPreview()
          } else {
            bootstrapCompleteRef.current = true
          }
        })
        .catch(() => {
          if (!BUILDER1_ACCESS_GUARD_DISABLED && !isBuilder1DevAccessBypass()) {
            redirectToPreview()
          } else {
            bootstrapCompleteRef.current = true
          }
        })
    } else if (!BUILDER1_ACCESS_GUARD_DISABLED && !isBuilder1DevAccessBypass()) {
      redirectToPreview()
    } else {
      bootstrapCompleteRef.current = true
    }
  }, [securityEnabled, securityConfigLoaded])

  const displayLanguage = campaignSession?.campaign?.detectedLanguage === 'en' ? 'en' : 'he'
  const isGenerating = state === STATE.GENERATING || state === STATE.GENERATING_NEXT
  const campaignAuthoritativelyReady = isBuilder1CampaignAuthoritativelyReady(campaignSession)
  const campaignDeliveryPending = isBuilder1CampaignDeliveryPending(campaignSession)
  const campaignComplete = campaignAuthoritativelyReady
  const canRetryServerAd =
    Boolean(builder1RetryContext?.retryable && campaignSession?.campaignId)
  const canGenerateAgain =
    campaignSession != null &&
    (campaignSession.canGenerateNext || canRetryServerAd) &&
    !campaignComplete &&
    !campaignDeliveryPending
  const generateButtonLabel = getBuilder1GenerateButtonLabel({
    campaignComplete,
    hasGeneratedAds: Boolean(campaignSession?.generatedCount),
    canGenerateNext: Boolean(canGenerateAgain),
    retryable: canRetryServerAd
  })
  const generateButtonDisabled =
    cancellationGate !== 'ready' ||
    initPhase !== 'done' ||
    campaignComplete ||
    isGenerating ||
    generateRequestInFlightRef.current ||
    Boolean(readBuilder1ActiveJob()) ||
    Boolean(readBuilder1PendingMutation()) ||
    (Boolean(rateLimitState) && retryCountdown > 0)

  const generationProgressVisible = showProgressBar && !progressTaskFailed

  const stopProgressWithFailure = useCallback(() => {
    clearProgressJobTiming()
    setProgressTaskFailed(true)
    setProgressTaskSucceeded(false)
    setIsCompletingProgress(false)
    setProgressActive(false)
    setShowProgressBar(false)
    pendingRevealRef.current = null
  }, [clearProgressJobTiming])

  const beginProgress = useCallback((operationType) => {
    const mode =
      operationType === BUILDER1_PROGRESS_OPERATION.NEXT_AD ||
      operationType === 'next' ||
      operationType === 'next_ad'
        ? BUILDER1_PROGRESS_OPERATION.NEXT_AD
        : BUILDER1_PROGRESS_OPERATION.INITIAL_CAMPAIGN
    clearProgressJobTiming()
    progressModeRef.current = mode
    setProgressOperationType(mode)
    setProgressEstimatedDurationMs(getBuilder1EstimatedDurationForOperation(mode))
    const startedAt = Date.now()
    progressJobStartMsRef.current = startedAt
    setProgressJobStartMs(startedAt)
    setError(null)
    setComplianceRetryMessage(null)
    setProgressTaskFailed(false)
    setProgressTaskSucceeded(false)
    setIsCompletingProgress(false)
    pendingRevealRef.current = null
    setProgressKey((prev) => prev + 1)
    setProgressActive(true)
    setShowProgressBar(true)
    setStageLabel('')
  }, [clearProgressJobTiming])

  const applyPendingReveal = useCallback(() => {
    const pending = pendingRevealRef.current
    if (!pending) return

    if (pending.type === 'initial') {
      if (pending.autoName) {
        fillingResolvedNameRef.current = true
        setFormData((prev) => ({
          ...prev,
          productName: pending.autoName
        }))
        setIsProductNameAuto(true)
      }
      setIsDevMock(Boolean(pending.isDevMock))
      setCampaignSession(pending.session)
      setBuilder1RetryContext(null)
      setComplianceRetryMessage(null)
    } else if (pending.type === 'next') {
      setIsDevMock(Boolean(pending.isDevMock))
      setCampaignSession(pending.session)
      setRateLimitState(null)
      setBuilder1RetryContext(null)
      setComplianceRetryMessage(null)
    }

    pendingRevealRef.current = null
    clearBuilder1ActiveJob()
    clearBuilder1PendingMutation()
    setIsPollDisconnected(false)
    clearProgressJobTiming()
    setProgressTaskSucceeded(false)
    setIsCompletingProgress(false)
    setProgressActive(false)
    setShowProgressBar(false)
    setState(STATE.SUCCESS)
  }, [clearProgressJobTiming])

  const queueSuccessfulReveal = useCallback((payload) => {
    pendingRevealRef.current = payload
    setIsCompletingProgress(true)
    setProgressTaskSucceeded(true)
  }, [])

  const handleProgressRevealReady = useCallback(() => {
    applyPendingReveal()
  }, [applyPendingReveal])

  const resetFreshBuilder1Ui = useCallback(() => {
    initialPollTokenRef.current += 1
    nextPollTokenRef.current += 1
    pendingRevealRef.current = null
    generateRequestInFlightRef.current = false
    clearProgressJobTiming(progressActiveJobIdRef.current)
    setCampaignSession(null)
    setState(STATE.IDLE)
    setError(null)
    setOwnershipError(null)
    setBuilder1RetryContext(null)
    setComplianceRetryMessage(null)
    setRateLimitState(null)
    setZipStateByAd({})
    setCampaignZipState({ loading: false, error: null })
    setIsPollDisconnected(false)
    setProgressTaskFailed(false)
    setProgressTaskSucceeded(false)
    setIsCompletingProgress(false)
    setProgressActive(false)
    setShowProgressBar(false)
    setStageLabel('')
  }, [clearProgressJobTiming])

  const handleBuilder1OwnershipFailure = useCallback(() => {
    stopProgressWithFailure()
    setOwnershipError(BUILDER1_MSG_OWNERSHIP)
    setCancellationGate('blocked')
    setFormFieldErrors({ productName: null, productDescription: null })
    setError(null)
    setState(STATE.ERROR)
  }, [stopProgressWithFailure])

  const handleBuilder1IdempotencyConflict = useCallback(() => {
    stopProgressWithFailure()
    setCancellationGate('blocked')
    setError(BUILDER1_MSG_IDEMPOTENCY_CONFLICT)
    setState(STATE.ERROR)
  }, [stopProgressWithFailure])

  const clearBuilder1RecoveryState = useCallback(() => {
    clearBuilder1ActiveJob()
    clearBuilder1PendingMutation()
  }, [])

  const shouldClearBuilder1ActiveJobOnError = useCallback((err) => {
    const code = String(err?.code ?? '').toLowerCase()
    if (code === 'generation_timeout') return false
    if (err instanceof NetworkError || err?.isNetworkError) return false
    return true
  }, [])

  useEffect(() => {
    const onPageHide = () => {
      const activeJob = readBuilder1ActiveJob()
      if (!activeJob?.jobId) return
      cancelBuilder1JobKeepalive(activeJob.jobId, { reason: 'frontend_refresh' })
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])

  useEffect(() => {
    ensureBuilder1OwnerContext()
    resetFreshBuilder1Ui()

    const pendingMutation = readBuilder1PendingMutation()
    const activeJob = readBuilder1ActiveJob()

    if (!isUnresolvedBuilder1PendingMutation(pendingMutation) && !activeJob?.jobId) {
      setCancellationGate('ready')
      setInitPhase('done')
      return undefined
    }

    let cancelled = false
    setCancellationGate('pending')
    setInitPhase('cancelling')

    ;(async () => {
      let jobId = activeJob?.jobId ?? pendingMutation?.jobId ?? null

      if (!jobId && pendingMutation?.requestId && pendingMutation.requestPayload) {
        try {
          const { response, payload } = await callBuilder1MutationWithRetry(() =>
            replayBuilder1PendingMutation(pendingMutation)
          )
          if (cancelled) return

          if (payload && isBuilder1IdempotencyConflict(payload, response.status)) {
            setCancellationGate('blocked')
            setError(BUILDER1_MSG_IDEMPOTENCY_CONFLICT)
            setInitPhase('done')
            return
          }

          if (!response.ok && response.status !== 202) {
            setCancellationGate('blocked')
            setError(BUILDER1_MSG_CANCEL_BLOCKED)
            setInitPhase('done')
            return
          }

          const extracted = extractBuilder1MutationJobIds(payload)
          jobId = extracted.jobId
          if (!jobId) {
            setCancellationGate('blocked')
            setError(BUILDER1_MSG_CANCEL_BLOCKED)
            setInitPhase('done')
            return
          }

          updateBuilder1PendingMutation({
            jobId,
            campaignId: extracted.campaignId ?? pendingMutation.campaignId
          })
          writeBuilder1ActiveJob({
            jobId,
            campaignId: extracted.campaignId ?? pendingMutation.campaignId,
            operation: pendingMutation.operation,
            requestId: pendingMutation.requestId,
            startedAtMs: pendingMutation.createdAtMs
          })
        } catch (err) {
          if (cancelled) return
          if (err?.isIdempotencyConflict) {
            setCancellationGate('blocked')
            setError(BUILDER1_MSG_IDEMPOTENCY_CONFLICT)
            setInitPhase('done')
            return
          }
          if (err?.isOwnershipError) {
            setOwnershipError(BUILDER1_MSG_OWNERSHIP)
            setCancellationGate('blocked')
            setInitPhase('done')
            return
          }
          setCancellationGate('blocked')
          setError(BUILDER1_MSG_CANCEL_BLOCKED)
          setInitPhase('done')
          return
        }
      }

      if (!jobId) {
        setCancellationGate('blocked')
        setError(BUILDER1_MSG_CANCEL_BLOCKED)
        setInitPhase('done')
        return
      }

      const result = await cancelBuilder1Job(jobId, { reason: 'frontend_refresh' })
      if (cancelled) return

      if (result?.isOwnershipError) {
        setOwnershipError(BUILDER1_MSG_OWNERSHIP)
        setCancellationGate('blocked')
        setInitPhase('done')
        return
      }

      if (isBuilder1CancelAcknowledged(result)) {
        clearBuilder1RecoveryState()
        clearBuilder1JobStartTime(jobId)
        setCancellationGate('ready')
      } else {
        setCancellationGate('blocked')
        setError(BUILDER1_MSG_CANCEL_BLOCKED)
      }
      setInitPhase('done')
    })()

    return () => {
      cancelled = true
    }
  }, [resetFreshBuilder1Ui, clearBuilder1RecoveryState])

  const handleInitialSubmit = async (data) => {
    if (generateRequestInFlightRef.current) return
    if (cancellationGate !== 'ready' || initPhase !== 'done') return
    if (readBuilder1ActiveJob()) return
    if (readBuilder1PendingMutation()) return

    if (!BUILDER1_ACCESS_GUARD_DISABLED && !securityConfigLoaded) return
    if (
      !BUILDER1_ACCESS_GUARD_DISABLED &&
      securityEnabled &&
      !sidRef.current &&
      !fromPaymentCheckDoneRef.current &&
      !isBuilder1DevAccessBypass()
    ) {
      redirectToPreview()
      return
    }

    const nameValidation = validateBuilder1InitialSubmitInputs({
      productName: data.productName,
      productDescription: data.productDescription
    })
    if (!nameValidation.ok) {
      setFormFieldErrors({
        productName: null,
        productDescription: getBuilder1ProductDescriptionFieldMessage('he')
      })
      setError(null)
      return
    }

    generateRequestInFlightRef.current = true
    const pollToken = ++initialPollTokenRef.current
    const userLeftProductNameEmpty = !nameValidation.productName
    const adCount = resolveBuilder1InitialAdCount({
      targetAdCount: lockedTargetAdCountRef.current ?? targetAdCount
    })
    lockedTargetAdCountRef.current = adCount
    setTargetAdCount(adCount)
    progressLanguageRef.current = 'he'

    let requestBody
    try {
      requestBody = buildInitialGeneratePayload({
        productName: nameValidation.productName,
        productDescription: nameValidation.productDescription,
        format: data.imageSize,
        adCount
      })
    } catch (_) {
      setError('Please select a valid format.')
      setState(STATE.ERROR)
      generateRequestInFlightRef.current = false
      return
    }

    setFormFieldErrors({ productName: null, productDescription: null })
    if (!userLeftProductNameEmpty) {
      setIsProductNameAuto(false)
    }
    if (!fieldsLocked) setFieldsLocked(true)

    setState(STATE.GENERATING)
    beginProgress(BUILDER1_PROGRESS_OPERATION.INITIAL_CAMPAIGN)
    setRateLimitState(null)

    const applyGenerationFormError = (err) => {
      const resolved = resolveBuilder1GenerationFormError(err, 'he')
      stopProgressWithFailure()
      clearBuilder1PendingMutation()
      setFieldsLocked(false)
      if (resolved?.field === 'productName') {
        setFormFieldErrors({ productName: resolved.message, productDescription: null })
        setError(null)
        setState(STATE.IDLE)
        return
      }
      if (resolved?.field === 'productDescription') {
        setFormFieldErrors({ productName: null, productDescription: resolved.message })
        setError(null)
        setState(STATE.IDLE)
        return
      }
      setFormFieldErrors({ productName: null, productDescription: null })
      setError(mapUserFacingError(err, err?.code))
      setState(STATE.ERROR)
    }

    const requestId = createBuilder1RequestId()
    writeBuilder1PendingMutation({
      requestId,
      operation: 'initial',
      requestPayload: requestBody,
      createdAtMs: Date.now(),
      jobId: null,
      campaignId: null
    })

    try {
      let response
      let createResponse
      try {
        ;({ response, payload: createResponse } = await callBuilder1MutationWithRetry(() =>
          builder1Generate(requestBody, { requestId })
        ))
      } catch (fetchErr) {
        if (fetchErr?.isIdempotencyConflict) {
          handleBuilder1IdempotencyConflict()
          return
        }
        if (fetchErr?.isOwnershipError) {
          handleBuilder1OwnershipFailure()
          return
        }
        stopProgressWithFailure()
        setError(mapUserFacingError(fetchErr, fetchErr?.code))
        setState(STATE.ERROR)
        return
      }
      if (!response.ok && response.status !== 202) {
        if (isBuilder1IdempotencyConflict(createResponse, response.status)) {
          handleBuilder1IdempotencyConflict()
          return
        }
        const retryOutcome = resolveBuilder1RetryErrorResponse(createResponse, campaignSession, 'he')
        if (retryOutcome) {
          stopProgressWithFailure()
          clearBuilder1PendingMutation()
          if (retryOutcome.retryContext) {
            setBuilder1RetryContext(retryOutcome.retryContext)
          }
          setComplianceRetryMessage(retryOutcome.message)
          setError(null)
          setState(campaignSession ? STATE.SUCCESS : STATE.ERROR)
          return
        }
        const msg = createResponse?.message ?? createResponse?.error
        const errStr = typeof msg === 'string' ? msg : (msg?.message ?? `Server error: ${response.status}`)
        const apiErrorCode = parseBuilder1ApiErrorCode(createResponse, errStr)
        if (
          apiErrorCode === BUILDER1_PRODUCT_NAME_GENERATION_FAILED ||
          apiErrorCode === BUILDER1_MISSING_PRODUCT_DESCRIPTION
        ) {
          applyGenerationFormError(
            Object.assign(new Error(errStr || apiErrorCode), { code: apiErrorCode, body: createResponse })
          )
          return
        }
        const rateInfo = parseRateLimitError({ status: response.status, body: createResponse, message: errStr })
        if (rateInfo.rateLimited) {
          throw Object.assign(new ApiError(errStr || 'Too many requests', { code: 'image_rate_limited', status: 429 }), {
            rateInfo
          })
        }
        throw new Error(errStr || `Server error: ${response.status}`)
      }

      const mutationIds = extractBuilder1MutationJobIds(createResponse)
      const jobId = mutationIds.jobId
      if (!jobId) {
        throw new Error('Error creating campaign: missing jobId')
      }

      const trimmedJobId = jobId.trim()
      updateBuilder1PendingMutation({
        jobId: trimmedJobId,
        campaignId: mutationIds.campaignId
      })
      const resolvedStartMs = resolveBuilder1JobStartTime(
        trimmedJobId,
        progressJobStartMsRef.current ?? Date.now()
      )
      progressActiveJobIdRef.current = trimmedJobId
      progressJobStartMsRef.current = resolvedStartMs
      setProgressJobStartMs(resolvedStartMs)

      writeBuilder1ActiveJob({
        jobId: trimmedJobId,
        campaignId: mutationIds.campaignId ?? campaignSession?.campaignId ?? null,
        operation: 'initial',
        requestId,
        startedAtMs: resolvedStartMs
      })

      const rawResult = await pollBuilder1Job({
        jobId: trimmedJobId,
        isStale: () => initialPollTokenRef.current !== pollToken || !mountedRef.current,
        onStage: (stage) => {
          if (initialPollTokenRef.current !== pollToken || !mountedRef.current) return
          setStageLabel(
            getStageLabel(
              { stage, status: 'running' },
              'he',
              'initial',
              { adIndex: 1, targetAdCount: adCount, language: 'he' }
            )
          )
        },
        onTransientError: () => {
          if (initialPollTokenRef.current !== pollToken || !mountedRef.current) return
          setIsPollDisconnected(true)
        }
      })

      if (initialPollTokenRef.current !== pollToken || !mountedRef.current) return
      setIsPollDisconnected(false)

      const validated = validateInitialCampaignResponse(rawResult, adCount)
      if (!validated.ok) {
        throw new Error(validated.message || validated.error || 'response_contract_invalid')
      }

      const sessionResult = createCampaignSessionFromInitial(validated, adCount)
      if (!sessionResult.ok) {
        throw new Error(sessionResult.message || sessionResult.error || 'response_contract_invalid')
      }

      queueSuccessfulReveal({
        type: 'initial',
        session: sessionResult.session,
        isDevMock: false,
        autoName:
          userLeftProductNameEmpty && validated.campaign.productNameResolved
            ? validated.campaign.productNameResolved
            : null
      })
    } catch (err) {
      if (initialPollTokenRef.current !== pollToken || !mountedRef.current) return

      if (err?.isIdempotencyConflict) {
        handleBuilder1IdempotencyConflict()
        return
      }

      if (err?.isOwnershipError) {
        handleBuilder1OwnershipFailure()
        return
      }

      const generationFormErr = resolveBuilder1GenerationFormError(err, 'he')
      if (generationFormErr) {
        applyGenerationFormError(err)
        return
      }

      const rateInfo = err?.rateInfo ?? parseRateLimitError(err)
      if (rateInfo.rateLimited) {
        stopProgressWithFailure()
        setError(mapUserFacingError(err, 'image_rate_limited'))
        setState(STATE.ERROR)
        return
      }

      if (import.meta.env.DEV && (err instanceof NetworkError || err?.isNetworkError)) {
        const mock = createDevMockInitialCampaign(data, adCount)
        if (!mock.ok) {
          stopProgressWithFailure()
          setError(mapUserFacingError(mock.message))
          setState(STATE.ERROR)
          return
        }
        clearBuilder1PendingMutation()
        const sessionResult = createCampaignSessionFromInitial(mock, adCount)
        queueSuccessfulReveal({
          type: 'initial',
          session: sessionResult.session,
          isDevMock: true,
          autoName:
            userLeftProductNameEmpty && mock.campaign?.productNameResolved
              ? mock.campaign.productNameResolved
              : null
        })
        return
      }

      const retryOutcome = resolveBuilder1RetryErrorResponse(err?.body, campaignSession, 'he')
      if (retryOutcome) {
        stopProgressWithFailure()
        clearBuilder1PendingMutation()
        if (retryOutcome.retryContext) {
          setBuilder1RetryContext(retryOutcome.retryContext)
        }
        setComplianceRetryMessage(retryOutcome.message)
        setError(null)
        setState(campaignSession ? STATE.SUCCESS : STATE.ERROR)
        return
      }

      stopProgressWithFailure()
      if (shouldClearBuilder1ActiveJobOnError(err)) {
        clearBuilder1RecoveryState()
      }
      setCampaignSession(null)
      setBuilder1RetryContext(null)
      setError(mapUserFacingError(err))
      setState(STATE.ERROR)
    } finally {
      if (initialPollTokenRef.current === pollToken) {
        generateRequestInFlightRef.current = false
      }
    }
  }

  const handleGenerateNextAd = async () => {
    if (!campaignSession || generateRequestInFlightRef.current || isGenerating) return
    if (cancellationGate !== 'ready' || initPhase !== 'done') return
    if (readBuilder1ActiveJob()) return
    if (readBuilder1PendingMutation()) return

    const activeSession = campaignSession
    const activeRetryContext = builder1RetryContext
    const isServerRetry = Boolean(activeRetryContext?.retryable)
    if (!isServerRetry && (!activeSession.canGenerateNext || campaignComplete)) return

    const expectedIndex = isServerRetry ? activeRetryContext.retryAdIndex : activeSession.nextAdIndex
    const pollToken = ++nextPollTokenRef.current
    generateRequestInFlightRef.current = true
    setState(STATE.GENERATING_NEXT)
    setError(null)
    setComplianceRetryMessage(null)
    beginProgress(BUILDER1_PROGRESS_OPERATION.NEXT_AD)
    progressLanguageRef.current = displayLanguage
    if (isServerRetry && activeRetryContext.retryMode) {
      setStageLabel(getBuilder1RetryModeProgressLabel(activeRetryContext.retryMode, displayLanguage))
    }

    const applyRetryErrorIfPresent = (body) => {
      const outcome = resolveBuilder1RetryErrorResponse(body, activeSession, displayLanguage)
      if (!outcome) return false
      stopProgressWithFailure()
      clearBuilder1PendingMutation()
      if (outcome.retryContext) {
        setBuilder1RetryContext(outcome.retryContext)
      }
      setComplianceRetryMessage(outcome.message)
      setError(null)
      setState(STATE.SUCCESS)
      return true
    }

    const progressCtx = {
      adIndex: expectedIndex,
      targetAdCount: activeSession.targetAdCount,
      language: displayLanguage
    }

    const isRepairMutation =
      isServerRetry &&
      activeRetryContext.retryMode === BUILDER1_RETRY_MODE.REPAIR_FROM_PHYSICAL

    const mutationPayload = isRepairMutation
      ? buildBuilder1RepairPhysicalPayload({
          campaignId: activeSession.campaignId,
          retryAdIndex: expectedIndex,
          planRevision: activeRetryContext.planRevision
        })
      : buildBuilder1GenerateNextPayload({
          campaignId: activeSession.campaignId,
          expectedNextIndex: expectedIndex
        })

    const nextOperation = isRepairMutation ? 'repair' : isServerRetry ? 'retry' : 'next'

    const requestId = createBuilder1RequestId()
    writeBuilder1PendingMutation({
      requestId,
      operation: nextOperation,
      requestPayload: mutationPayload,
      createdAtMs: Date.now(),
      jobId: null,
      campaignId: activeSession.campaignId
    })

    const invokeMutation = () =>
      isRepairMutation
        ? builder1RepairPhysical(mutationPayload, { requestId })
        : builder1GenerateNext(mutationPayload, { requestId })

    try {
      let response
      let createResponse
      try {
        ;({ response, payload: createResponse } = await callBuilder1MutationWithRetry(invokeMutation))
      } catch (fetchErr) {
        if (fetchErr?.isIdempotencyConflict) {
          handleBuilder1IdempotencyConflict()
          return
        }
        if (fetchErr?.isOwnershipError) {
          handleBuilder1OwnershipFailure()
          return
        }
        stopProgressWithFailure()
        setError(mapUserFacingError(fetchErr, fetchErr?.code))
        setState(STATE.SUCCESS)
        return
      }
      if (!response.ok && response.status !== 202) {
        if (isBuilder1IdempotencyConflict(createResponse, response.status)) {
          handleBuilder1IdempotencyConflict()
          return
        }
        if (applyRetryErrorIfPresent(createResponse)) {
          clearBuilder1PendingMutation()
          return
        }
        const msg = createResponse?.message ?? createResponse?.error
        const errStr = typeof msg === 'string' ? msg : (msg?.message ?? `Server error: ${response.status}`)
        const rateInfo = parseRateLimitError({ status: response.status, body: createResponse, message: errStr })
        if (rateInfo.rateLimited || response.status === 429) {
          const retryAfterSeconds = rateInfo.retryAfterSeconds ?? 30
          stopProgressWithFailure()
          setRateLimitState({
            message:
              displayLanguage === 'he'
                ? 'יצירת התמונה עמוסה כרגע. נסו שוב בעוד רגע.'
                : 'Image generation is temporarily busy. Please try again shortly.',
            expectedNextIndex: expectedIndex,
            retryAfterSeconds,
            retryAvailableAt: Date.now() + retryAfterSeconds * 1000
          })
          setState(STATE.SUCCESS)
          return
        }
        const errCode = createResponse?.error ?? createResponse?.code
        throw Object.assign(new Error(errStr), { code: errCode, body: createResponse })
      }

      const mutationIds = extractBuilder1MutationJobIds(createResponse)
      const jobId = mutationIds.jobId
      if (!jobId) {
        throw new Error('Error creating next ad: missing jobId')
      }

      const trimmedJobId = jobId.trim()
      updateBuilder1PendingMutation({
        jobId: trimmedJobId,
        campaignId: mutationIds.campaignId ?? activeSession.campaignId
      })
      const resolvedStartMs = resolveBuilder1JobStartTime(
        trimmedJobId,
        progressJobStartMsRef.current ?? Date.now()
      )
      progressActiveJobIdRef.current = trimmedJobId
      progressJobStartMsRef.current = resolvedStartMs
      setProgressJobStartMs(resolvedStartMs)

      writeBuilder1ActiveJob({
        jobId: trimmedJobId,
        campaignId: mutationIds.campaignId ?? activeSession.campaignId,
        operation: nextOperation,
        requestId,
        startedAtMs: resolvedStartMs
      })

      const rawResult = await pollBuilder1Job({
        jobId: trimmedJobId,
        isStale: () => nextPollTokenRef.current !== pollToken || !mountedRef.current,
        onStage: (stage) => {
          if (nextPollTokenRef.current !== pollToken || !mountedRef.current) return
          setStageLabel(getStageLabel({ stage, status: 'running' }, displayLanguage, 'next', progressCtx))
        },
        onTransientError: () => {
          if (nextPollTokenRef.current !== pollToken || !mountedRef.current) return
          setIsPollDisconnected(true)
        }
      })

      if (nextPollTokenRef.current !== pollToken || !mountedRef.current) return
      setIsPollDisconnected(false)

      const validated = validateNextAdResponse(rawResult, {
        campaignId: activeSession.campaignId,
        expectedIndex
      })
      if (!validated.ok) {
        throw new Error(validated.message || validated.error || 'response_contract_invalid')
      }

      const appendResult = appendAdToSession(activeSession, validated)
      if (!appendResult.ok) {
        throw new Error(appendResult.message || appendResult.error || 'response_contract_invalid')
      }

      queueSuccessfulReveal({
        type: 'next',
        session: appendResult.session,
        isDevMock: false
      })
    } catch (err) {
      if (nextPollTokenRef.current !== pollToken || !mountedRef.current) return

      if (err?.isIdempotencyConflict) {
        handleBuilder1IdempotencyConflict()
        return
      }

      if (err?.isOwnershipError) {
        handleBuilder1OwnershipFailure()
        return
      }

      if (applyRetryErrorIfPresent(err?.body)) {
        return
      }

      const rateInfo = parseRateLimitError(err)
      if (rateInfo.rateLimited || err?.status === 429) {
        const retryAfterSeconds = rateInfo.retryAfterSeconds ?? 30
        stopProgressWithFailure()
        setRateLimitState({
          message:
            displayLanguage === 'he'
              ? 'יצירת התמונה עמוסה כרגע. נסו שוב בעוד רגע.'
              : 'Image generation is temporarily busy. Please try again shortly.',
          expectedNextIndex: expectedIndex,
          retryAfterSeconds,
          retryAvailableAt: Date.now() + retryAfterSeconds * 1000
        })
        setState(STATE.SUCCESS)
        return
      }

      if (import.meta.env.DEV && (err instanceof NetworkError || err?.isNetworkError)) {
        const mock = createDevMockNextAd(activeSession, expectedIndex)
        const appendResult = appendAdToSession(activeSession, mock)
        if (appendResult.ok) {
          clearBuilder1PendingMutation()
          queueSuccessfulReveal({
            type: 'next',
            session: appendResult.session,
            isDevMock: true
          })
          return
        }
      }

      stopProgressWithFailure()
      if (shouldClearBuilder1ActiveJobOnError(err)) {
        clearBuilder1RecoveryState()
      }
      setError(mapUserFacingError(err, err?.code))
      setState(STATE.SUCCESS)
    } finally {
      if (nextPollTokenRef.current === pollToken) {
        generateRequestInFlightRef.current = false
      }
    }
  }

  const handleFormSubmit = (data) => {
    if (cancellationGate !== 'ready' || initPhase !== 'done') return
    if (readBuilder1ActiveJob() && !isGenerating) return
    if (readBuilder1PendingMutation()) return
    if (campaignComplete && !builder1RetryContext?.retryable) return

    if (campaignSession?.campaignId) {
      if (builder1RetryContext?.retryable) {
        handleGenerateNextAd()
        return
      }
      if (canGenerateAgain) {
        handleGenerateNextAd()
        return
      }
      return
    }

    handleInitialSubmit(data)
  }

  const handleRetryInitial = () => {
    if (builder1RetryContext?.retryable && campaignSession?.campaignId) {
      handleGenerateNextAd()
      return
    }
    if (campaignSession?.campaignId) {
      return
    }
    handleInitialSubmit(formData)
  }

  const handleDownloadAdZip = async (ad) => {
    if (!campaignSession || !ad) return
    const adIndex = ad.index
    setZipStateByAd((prev) => ({
      ...prev,
      [adIndex]: { loading: true, error: null }
    }))

    try {
      const payload = buildSingleAdZipRequest(campaignSession, ad)
      const response = await builder1DownloadZip(payload)

      if (!response.ok) {
        const errBody = await response.json().catch(async () => {
          const errText = await response.text().catch(() => '')
          return { message: errText || `Server error: ${response.status}` }
        })
        const msg = errBody?.message || errBody?.error || `Server error: ${response.status}`
        throw new Error(typeof msg === 'string' ? msg : 'Download failed')
      }

      const zipBlob = await response.blob()
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = sanitizeSingleAdZipFilename(adIndex)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setZipStateByAd((prev) => ({
        ...prev,
        [adIndex]: { loading: false, error: null }
      }))
    } catch (downloadErr) {
      if (downloadErr?.isOwnershipError) {
        setOwnershipError(BUILDER1_MSG_OWNERSHIP)
        setCancellationGate('blocked')
      }
      setZipStateByAd((prev) => ({
        ...prev,
        [adIndex]: {
          loading: false,
          error: downloadErr?.isOwnershipError
            ? BUILDER1_MSG_OWNERSHIP
            : mapUserFacingError(downloadErr)
        }
      }))
    }
  }

  useEffect(() => {
    if (fillingResolvedNameRef.current) {
      fillingResolvedNameRef.current = false
      return
    }
    setCampaignSession(null)
    setRateLimitState(null)
    lockedTargetAdCountRef.current = readBuilder1CampaignAdCount()
    setTargetAdCount(lockedTargetAdCountRef.current)
  }, [formData.productName, formData.productDescription])

  const sortedAds = campaignSession ? sortAdsByIndex(campaignSession.ads) : []
  const campaignFormat =
    normalizeBuilder1FormatForApi(campaignSession?.campaign?.format) || 'portrait'

  return (
    <div className="builder-page">
      <div className="builder-title-block">
        <h1 className="builder-title">יוצר מודעות</h1>
        <span className="builder-warning" dir="rtl">
          (אין לרענן את הדף)
        </span>
      </div>

      {initPhase === 'cancelling' ? (
        <p className="builder-cancellation-notice" role="status" dir="rtl">
          {BUILDER1_MSG_CANCELLING}
        </p>
      ) : null}

      {cancellationGate === 'blocked' ? (
        <p className="builder-cancellation-notice builder-cancellation-blocked" role="alert" dir="rtl">
          {ownershipError || error || BUILDER1_MSG_CANCEL_BLOCKED}
        </p>
      ) : null}

      {isPollDisconnected && isGenerating ? (
        <p className="builder-poll-disconnected-notice" role="status" dir="rtl">
          {displayLanguage === 'he'
            ? 'חיבור זמני נותק — ממשיכים לעקוב…'
            : 'Connection interrupted — still tracking progress…'}
        </p>
      ) : null}

      <ProductForm
        formData={formData}
        setFormData={setFormData}
        onSubmit={handleFormSubmit}
        fieldsLocked={fieldsLocked}
        buttonText={generateButtonLabel}
        buttonDisabled={generateButtonDisabled}
        showSubmitButton
        showProgress={generationProgressVisible}
        progressMode="builder1"
        progressActive={generationProgressVisible}
        progressKey={progressKey}
        progressEstimatedDurationMs={progressEstimatedDurationMs}
        progressOperationType={progressOperationType}
        progressLanguage={displayLanguage}
        progressJobStartMs={progressJobStartMs}
        progressTaskSucceeded={progressTaskSucceeded}
        progressTaskFailed={progressTaskFailed}
        onProgressRevealReady={handleProgressRevealReady}
        stageLabel={stageLabel}
        isProductNameAuto={isProductNameAuto}
        onProductNameEdited={() => {
          setIsProductNameAuto(false)
          setFormFieldErrors((prev) => ({ ...prev, productName: null }))
        }}
        externalProductNameError={formFieldErrors.productName}
        externalProductDescriptionError={formFieldErrors.productDescription}
        onProductDescriptionEdited={() => {
          setFormFieldErrors((prev) => ({ ...prev, productDescription: null }))
        }}
      />

      {complianceRetryMessage && campaignSession && (
        <div className="builder-compliance-retry-panel" role="alert">
          <p>{complianceRetryMessage}</p>
        </div>
      )}

      {rateLimitState && (
        <div className="builder-rate-limit-panel" role="alert">
          <p>{rateLimitState.message}</p>
          {retryCountdown > 0 ? (
            <p className="builder-rate-limit-countdown">
              {displayLanguage === 'he'
                ? `אפשר לנסות שוב בעוד ${retryCountdown} שניות`
                : `You can try again in ${retryCountdown}s`}
            </p>
          ) : null}
        </div>
      )}

      {campaignSession && (
        <section className="builder-campaign-results" aria-live="polite">
          {isDevMock && (
            <div className="demo-mode-notice">
              Dev mock campaign — backend unavailable in development.
            </div>
          )}

          <div className="builder-campaign-series">
            {sortedAds.map((ad) => (
              <AdCard
                key={`campaign-ad-${campaignSession.campaignId}-${ad.index}`}
                ad={ad}
                format={campaignFormat}
                productName={campaignSession.campaign.productNameResolved}
                targetAdCount={campaignSession.targetAdCount}
                language={displayLanguage}
                onDownloadZip={handleDownloadAdZip}
                zipLoading={Boolean(zipStateByAd[ad.index]?.loading)}
                zipError={zipStateByAd[ad.index]?.error ?? null}
              />
            ))}
          </div>
        </section>
      )}

      {state === STATE.ERROR && error && !campaignSession && (
        <ErrorPanel
          error={error}
          onRetry={handleRetryInitial}
          buttonLabel={builder1RetryContext?.retryable ? 'RETRY' : 'Retry'}
        />
      )}
      {state === STATE.ERROR && error && campaignSession && (
        <p className="builder-campaign-download-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export default BuilderPage
