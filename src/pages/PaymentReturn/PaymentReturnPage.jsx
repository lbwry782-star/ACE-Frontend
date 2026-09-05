import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  isSecurityConfigError,
  isSecurityConfigLoading,
  isSecurityEnabled,
  subscribeSecurityConfig
} from '../../services/securityConfig.js'
import { fetchPaymentCheckoutStatus } from '../../services/paymentsApi.js'
import {
  readSecureCheckoutRecord,
  secureCheckoutMatchesStatus
} from '../../utils/secureCheckout.js'
import { builderToRouteHash } from '../../utils/secureCheckoutOffers.js'
import { initSecureCheckoutTabLock } from '../../utils/secureCheckoutTabLock.js'
import './PaymentReturnPage.css'

const POLL_INTERVAL_MS = 1500
const POLL_MAX_MS = 60000
const HOME_PATH = '/'

const PHASE = {
  LOADING_CONFIG: 'loading_config',
  CONFIG_ERROR: 'config_error',
  MISSING_SESSION: 'missing_session',
  VERIFYING: 'verifying',
  TIMEOUT: 'timeout',
  REJECTED: 'rejected',
  NAVIGATING: 'navigating'
}

function cleanProviderReturnParams() {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    const stripKeys = [
      'ace_checkout_id',
      'docnum',
      'doctype',
      'sum',
      'currency',
      'confirmation',
      'confirmation_code',
      'card',
      'cardnum',
      'cardtype'
    ]
    let changed = false
    for (const key of stripKeys) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key)
        changed = true
      }
    }
    const hash = url.hash || ''
    if (hash.includes('?')) {
      const [path, query] = hash.split('?')
      const params = new URLSearchParams(query)
      for (const key of stripKeys) {
        if (params.has(key)) {
          params.delete(key)
          changed = true
        }
      }
      const nextQuery = params.toString()
      url.hash = nextQuery ? `${path}?${nextQuery}` : path
    }
    if (changed) {
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
  } catch (_) {
    /* ignore URL cleanup failures */
  }
}

function normalizeCheckoutStatus(payload) {
  const raw = String(payload?.status ?? payload?.checkoutStatus ?? payload?.state ?? '')
    .trim()
    .toLowerCase()
  if (['paid', 'complete', 'completed', 'success'].includes(raw)) return 'paid'
  if (['bound', 'active', 'in_use'].includes(raw)) return 'bound'
  if (['pending', 'processing', 'awaiting_payment', 'awaiting_confirmation'].includes(raw)) {
    return 'pending'
  }
  if (['expired', 'rejected', 'failed', 'cancelled', 'canceled', 'error'].includes(raw)) {
    return 'terminal'
  }
  return raw || 'unknown'
}

function PaymentReturnPage() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState(PHASE.LOADING_CONFIG)
  const [message, setMessage] = useState('')
  const pollAbortRef = useRef(false)
  const startedRef = useRef(false)

  const redirectHome = useCallback(
    (homeMessage) => {
      navigate(HOME_PATH, { replace: true, state: { aceMessage: homeMessage } })
    },
    [navigate]
  )

  const navigateToBuilder = useCallback(
    (builder) => {
      const hash = builderToRouteHash(builder)
      if (!hash) {
        redirectHome('לא ניתן להמשיך — נתוני הצעה לא תקינים.')
        return
      }
      setPhase(PHASE.NAVIGATING)
      window.location.hash = hash.replace(/^#/, '')
    },
    [redirectHome]
  )

  const verifyCheckout = useCallback(
    async ({ allowPolling }) => {
      const stored = readSecureCheckoutRecord()
      if (!stored) {
        setPhase(PHASE.MISSING_SESSION)
        setMessage('לא נמצאו פרטי תשלום בחלון זה.')
        return
      }

      setPhase(PHASE.VERIFYING)
      setMessage('מאמת את התשלום…')

      const startedAt = Date.now()
      pollAbortRef.current = false

      while (!pollAbortRef.current) {
        const result = await fetchPaymentCheckoutStatus({
          checkoutId: stored.checkoutId,
          browserToken: stored.browserToken
        })

        if (pollAbortRef.current) return

        if (!result.ok) {
          setPhase(PHASE.REJECTED)
          setMessage('לא ניתן לאמת את התשלום. נסו שוב.')
          return
        }

        const statusKind = normalizeCheckoutStatus(result.data)
        if (!secureCheckoutMatchesStatus(stored, result.data)) {
          setPhase(PHASE.REJECTED)
          setMessage('נתוני התשלום אינם תואמים. לא ניתן להמשיך.')
          return
        }

        if (statusKind === 'paid') {
          navigateToBuilder(stored.builder)
          return
        }

        if (statusKind === 'bound') {
          navigateToBuilder(stored.builder)
          return
        }

        if (statusKind === 'terminal') {
          setPhase(PHASE.REJECTED)
          setMessage('התשלום לא אושר. לא ניתן להמשיך לבונה.')
          return
        }

        if (!allowPolling) {
          setPhase(PHASE.REJECTED)
          setMessage('התשלום עדיין בבדיקה.')
          return
        }

        if (Date.now() - startedAt >= POLL_MAX_MS) {
          setPhase(PHASE.TIMEOUT)
          setMessage('התשלום עדיין בבדיקה.')
          return
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
    },
    [navigateToBuilder]
  )

  useEffect(() => {
    cleanProviderReturnParams()
  }, [])

  useEffect(() => {
    const run = () => {
      if (isSecurityConfigLoading()) {
        setPhase(PHASE.LOADING_CONFIG)
        return
      }
      if (isSecurityConfigError()) {
        setPhase(PHASE.CONFIG_ERROR)
        setMessage('שירות האבטחה אינו זמין. לא ניתן לאמת תשלום.')
        return
      }
      if (!isSecurityEnabled()) {
        redirectHome('מסלול תשלום זה פעיל רק במצב אבטחה.')
        return
      }
      if (startedRef.current) return
      startedRef.current = true

      const stored = readSecureCheckoutRecord()
      if (stored) {
        initSecureCheckoutTabLock(stored.checkoutId, () => {
          redirectHome('התשלום פתוח בחלון אחר.')
        })
      }

      void verifyCheckout({ allowPolling: true })
    }

    run()
    return subscribeSecurityConfig(run)
  }, [redirectHome, verifyCheckout])

  useEffect(() => {
    return () => {
      pollAbortRef.current = true
    }
  }, [])

  if (phase === PHASE.MISSING_SESSION) {
    return (
      <div className="payment-return-page" dir="rtl">
        <h1>אימות תשלום</h1>
        <p>{message}</p>
        <button type="button" onClick={() => redirectHome(message)}>
          חזרה לדף הבית
        </button>
      </div>
    )
  }

  if (phase === PHASE.CONFIG_ERROR || phase === PHASE.REJECTED) {
    return (
      <div className="payment-return-page" dir="rtl">
        <h1>אימות תשלום</h1>
        <p>{message}</p>
        <button type="button" onClick={() => redirectHome(message)}>
          חזרה לדף הבית
        </button>
      </div>
    )
  }

  if (phase === PHASE.TIMEOUT) {
    return (
      <div className="payment-return-page" dir="rtl">
        <h1>אימות תשלום</h1>
        <p>{message}</p>
        <button
          type="button"
          onClick={() => {
            startedRef.current = false
            void verifyCheckout({ allowPolling: true })
          }}
        >
          בדיקת סטטוס שוב
        </button>
        <button type="button" className="payment-return-secondary" onClick={() => redirectHome(message)}>
          חזרה לדף הבית
        </button>
      </div>
    )
  }

  return (
    <div className="payment-return-page" dir="rtl">
      <h1>אימות תשלום</h1>
      <p>{message || 'מאמת את התשלום…'}</p>
    </div>
  )
}

export default PaymentReturnPage
