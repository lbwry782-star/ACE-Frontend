import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import '../Preview/preview.css'
import './Preview2Page.css'

const BASE_URL = import.meta.env.BASE_URL

const PREVIEW2_EXPLAIN_DEFAULT_SRC = `${BASE_URL}assets/${encodeURIComponent('כפתור_הסבר.png')}`
const PREVIEW2_EXPLAIN_HOVER_SRC = `${BASE_URL}assets/${encodeURIComponent('כפתור_הסבר_HOVER.png')}`

const MOBILE_LAYOUT_MQ = '(max-width: 768px)'
const MOBILE_NAV_DELAY_MS = 1000
/** Preview2 tier keys → iCount payment URLs */
const PREVIEW2_PAYMENT_URLS = {
  '1': 'https://app.icount.co.il/m/8ca25',
  '2': 'https://app.icount.co.il/m/0a7c0',
  '5': 'https://app.icount.co.il/m/c87e3'
}

const PREVIEW2_ASSETS = [
  {
    key: '5',
    defaultSrc: `${BASE_URL}assets/8.png`,
    hoverSrc: `${BASE_URL}assets/Hover8.png`,
    lines: [
      '● 4 סרטונים ב-120 ש"ח',
      '● 30 ש"ח לסרטון',
      '● טקסט שיווקי בן 50 מילים לכל סרטון',
      '● מיועד לקמפיין בן 4 סרטונים (זמן עריכה - כשעתיים)'
    ]
  },
  {
    key: '2',
    defaultSrc: `${BASE_URL}assets/7.png`,
    hoverSrc: `${BASE_URL}assets/Hover7.png`,
    lines: [
      '● 3 סרטונים ב-100 ש"ח',
      '● טקסט שיווקי בן 50 מילים לכל סרטון',
      '● אפשרות השוואה ובחירה בין שלושה סרטונים'
    ]
  },
  {
    key: '1',
    defaultSrc: `${BASE_URL}assets/6.png`,
    hoverSrc: `${BASE_URL}assets/Hover6.png`,
    lines: ['● 2 סרטונים ב-80 ש"ח', '● טקסט שיווקי בן 50 מילים']
  }
]

function usePreview2MobileLayout() {
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

function Preview2Page() {
  const isMobile = usePreview2MobileLayout()
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
    const url = PREVIEW2_PAYMENT_URLS[assetKey]
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
      <div className="preview2-explain-slot">
        <div className="preview2-explain-wrap">
          <span className="preview2-explain-warn" dir="rtl">
            נא לא לרענן את הדף!
          </span>
          <Link
            to="/demo"
            className="preview2-explain-trigger"
            aria-label="הסבר"
          >
            <span className="preview2-explain-visual">
              <img
                src={PREVIEW2_EXPLAIN_DEFAULT_SRC}
                alt=""
                className="preview2-explain-img preview2-explain-img--default"
              />
              <img
                src={PREVIEW2_EXPLAIN_HOVER_SRC}
                alt=""
                className="preview2-explain-img preview2-explain-img--hover"
              />
            </span>
          </Link>
        </div>
      </div>
      <div className={`preview-asset-row${isMobile ? ' preview-asset-row--mobile' : ''}`}>
        {PREVIEW2_ASSETS.map(({ key, defaultSrc, hoverSrc, lines }) => (
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

export default Preview2Page
