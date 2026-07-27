import { useState, useEffect } from 'react'
import { generateMarketingText } from '../../utils/marketingText'
import '../AdCard/adcard.css'
import './video-ad-card.css'

/**
 * Builder2 result card: video + ~50-word marketing copy + Download ZIP (same behavior as AdCard).
 */
function VideoAdCard({
  attemptNumber,
  videoSrc: propVideoSrc,
  marketingText: propMarketingText,
  headline: propHeadline,
  headlineText: propHeadlineText,
  overlayHeadline: propOverlayHeadline,
  productNameResolved: propProductNameResolved,
  isGenerating,
  onPlaybackError
}) {
  const [videoSrc, setVideoSrc] = useState(propVideoSrc || null)
  const [marketingText, setMarketingText] = useState(propMarketingText ?? generateMarketingText(attemptNumber))
  const [headline, setHeadline] = useState(propHeadline ?? '')
  const [downloadLoading, setDownloadLoading] = useState(false)

  useEffect(() => {
    if (propVideoSrc) setVideoSrc(propVideoSrc)
  }, [propVideoSrc])
  useEffect(() => {
    if (propMarketingText != null) setMarketingText(propMarketingText)
  }, [propMarketingText])
  useEffect(() => {
    if (propHeadline != null) setHeadline(propHeadline)
  }, [propHeadline])

  const safe = (v) => (v == null ? '' : String(v).trim())
  const splitHeadline = (raw) => {
    const text = safe(raw)
    if (!text) return { first: '', rest: '' }
    const commaIdx = text.indexOf(',')
    const spaceIdx = text.search(/\s/)
    if (commaIdx !== -1 && (spaceIdx === -1 || commaIdx < spaceIdx)) {
      return {
        first: text.slice(0, commaIdx).trim(),
        rest: text.slice(commaIdx + 1).trim()
      }
    }
    if (spaceIdx !== -1) {
      return {
        first: text.slice(0, spaceIdx).trim(),
        rest: text.slice(spaceIdx + 1).trim()
      }
    }
    return { first: text, rest: '' }
  }

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const removeDuplicateProductPrefix = (text, productName) => {
    const t = safe(text)
    const p = safe(productName)
    if (!t || !p) return t
    const re = new RegExp(`^\\s*${escapeRegExp(p)}\\s*([,:\\-–—|]\\s*)?`, 'i')
    return t.replace(re, '').trim()
  }

  const baseHeadline = safe(propOverlayHeadline) || safe(headline)
  const split = splitHeadline(baseHeadline)
  const productLine = safe(propProductNameResolved) || split.first
  const restFromApi = safe(propHeadlineText)
  const restSource = restFromApi || split.rest
  const restLine = removeDuplicateProductPrefix(restSource, productLine) || '\u00A0'

  const videoUrl = String(videoSrc ?? '').trim()
  const hasMarketingText = Boolean(String(marketingText ?? '').trim())
  const canDownload = !isGenerating && !downloadLoading && !!videoUrl && hasMarketingText

  const handleDownload = async () => {
    if (!canDownload) return
    if (!videoUrl || !marketingText) {
      console.log('DOWNLOAD_ZIP_MISSING_DATA', { videoUrl, marketingText })
      return
    }

    setDownloadLoading(true)
    try {
      const backendBase = 'https://ace-backend-k1p6.onrender.com'
      const url = `${backendBase}/api/download-video-zip?videoUrl=${encodeURIComponent(videoUrl)}&text=${encodeURIComponent(marketingText)}`

      console.log('DOWNLOAD_ZIP_URL', url)

      const a = document.createElement('a')
      a.href = url
      a.download = 'ace-video-ad.zip'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } finally {
      setDownloadLoading(false)
    }
  }

  return (
    <div className="ad-card">
      {videoSrc && (
        <div className="ad-card-video-wrap">
          <video
            className="ad-card-video"
            src={videoSrc}
            controls
            playsInline
            preload="metadata"
            onError={() => {
              if (onPlaybackError) onPlaybackError()
            }}
          >
            Your browser does not support the video tag.
          </video>
        </div>
      )}
      {baseHeadline && (
        <div className="ad-card-video-headline" dir="auto">
          <div className="ad-card-video-headline-product">
            <bdi>{productLine || split.first}</bdi>
          </div>
          <div className="ad-card-video-headline-text">
            <bdi>{restLine}</bdi>
          </div>
        </div>
      )}
      <div className="ad-card-text ad-card-video-marketing-text" dir="auto">
        <p dir="auto">
          <bdi>{marketingText}</bdi>
        </p>
      </div>
      <button
        type="button"
        className="ad-card-download"
        onClick={handleDownload}
        disabled={isGenerating || !videoUrl || !marketingText || downloadLoading}
      >
        {downloadLoading ? 'Downloading…' : 'DOWNLOAD ZIP להורדה'}
      </button>
    </div>
  )
}

export default VideoAdCard
