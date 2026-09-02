import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { startBuilder1Preview1Checkout } from '../../utils/builder1Checkout.js'
import { preview1TierKeyToAdCount } from '../../utils/builder1CampaignCount.js'
import './preview.css'
import './Preview1Explain.css'

const BASE_URL = import.meta.env.BASE_URL

const PREVIEW1_EXPLAIN_DEFAULT_SRC = `${BASE_URL}assets/${encodeURIComponent('כפתור_הסבר.png')}`
const PREVIEW1_EXPLAIN_HOVER_SRC = `${BASE_URL}assets/${encodeURIComponent('כפתור_הסבר_HOVER.png')}`

const MOBILE_LAYOUT_MQ = '(max-width: 768px)'
const MOBILE_NAV_DELAY_MS = 1000

/** Preview1 tier keys → iCount payment URLs */
const PREVIEW1_PAYMENT_URLS = {
  '1': 'https://app.icount.co.il/m/78df1',
  '2': 'https://app.icount.co.il/m/477e6',
  '5': 'https://app.icount.co.il/m/f7c25'
}

const PREVIEW1_ASSETS = [
  {
    key: '5',
    defaultSrc: `${BASE_URL}assets/5.png`,
    hoverSrc: `${BASE_URL}assets/Hover5.png`,
    lines: [
      '● 4 מודעות ב-65 ש"ח',
      '● 16.25 ש"ח למודעה',
      '● טקסט שיווקי בן 50 מילים לכל מודעה',
      '● מיועד לקמפיין בן 4 מודעות'
    ]
  },
  {
    key: '2',
    defaultSrc: `${BASE_URL}assets/2.png`,
    hoverSrc: `${BASE_URL}assets/Hover2.png`,
    lines: [
      '● 3 מודעות ב-55 ש"ח',
      '● טקסט שיווקי בן 50 מילים לכל סרטון',
      '● אפשרות השוואה ובחירה בין 3 מודעות'
    ]
  },
  {
    key: '1',
    defaultSrc: `${BASE_URL}assets/1.png`,
    hoverSrc: `${BASE_URL}assets/Hover1.png`,
    lines: ['● 2 מודעות ב-45 ש"ח', '● טקסט שיווקי בן 50 מילים']
  }
]

function usePreview1MobileLayout() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(MOBILE_LAYOUT_MQ).matches
  )

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_LAYOUT_MQ)
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return isMobile
}

function PreviewPage() {
  const isMobile = usePreview1MobileLayout()
  const [mobileActiveKey, setMobileActiveKey] = useState(null)
  const navigateLockRef = useRef(false)
  const navigateTimeoutRef = useRef(null)

  useEffect(() => {
    return () => {
      if (navigateTimeoutRef.current) clearTimeout(navigateTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isMobile) {
      if (navigateTimeoutRef.current) {
        clearTimeout(navigateTimeoutRef.current)
        navigateTimeoutRef.current = null
      }
      navigateLockRef.current = false
      setMobileActiveKey(null)
    }
  }, [isMobile])

  const goToPayment = (assetKey) => {
    const adCount = preview1TierKeyToAdCount(assetKey)
    if (adCount != null) {
      startBuilder1Preview1Checkout(adCount)
    }
    const url = PREVIEW1_PAYMENT_URLS[assetKey]
    if (url) window.location.href = url
  }

  const handleMobileTap = (key) => {
    if (navigateLockRef.current) return
    navigateLockRef.current = true
    setMobileActiveKey(key)
    navigateTimeoutRef.current = setTimeout(() => {
      navigateTimeoutRef.current = null
      goToPayment(key)
    }, MOBILE_NAV_DELAY_MS)
  }

  return (
    <div className="preview-page">
      <div className="preview1-explain-slot">
        <div className="preview1-explain-wrap">
          <span className="preview1-explain-warn" dir="rtl">
            נא לא לרענן את הדף!
          </span>
          <Link
            to="/demo2"
            className="preview1-explain-trigger"
            aria-label="הסבר"
          >
            <span className="preview1-explain-visual">
              <img
                src={PREVIEW1_EXPLAIN_DEFAULT_SRC}
                alt=""
                className="preview1-explain-img preview1-explain-img--default"
              />
              <img
                src={PREVIEW1_EXPLAIN_HOVER_SRC}
                alt=""
                className="preview1-explain-img preview1-explain-img--hover"
              />
            </span>
          </Link>
        </div>
      </div>
      <div className={`preview-asset-row${isMobile ? ' preview-asset-row--mobile' : ''}`}>
        {PREVIEW1_ASSETS.map(({ key, defaultSrc, hoverSrc, lines }) => (
          <div key={key} className="preview-asset-group">
            <button
              type="button"
              className="preview-asset-trigger"
              onClick={() => (isMobile ? handleMobileTap(key) : goToPayment(key))}
            >
              <span className="preview-asset-visual">
                {isMobile ? (
                  <img
                    src={mobileActiveKey === key ? hoverSrc : defaultSrc}
                    alt=""
                    className="preview-asset-img preview-asset-img--mobile"
                  />
                ) : (
                  <>
                    <img
                      src={defaultSrc}
                      alt=""
                      className="preview-asset-img preview-asset-img--default"
                    />
                    <img
                      src={hoverSrc}
                      alt=""
                      className="preview-asset-img preview-asset-img--hover"
                    />
                  </>
                )}
              </span>
            </button>
            <div className="preview-asset-desc" dir="rtl">
              {lines.map((line, i) => (
                <p key={i} className="preview-asset-desc-line">
                  {line}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default PreviewPage
