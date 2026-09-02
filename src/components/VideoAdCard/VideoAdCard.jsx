import { useState, useEffect } from 'react'
import { downloadBuilder2Zip } from '../../services/api'
import '../AdCard/adcard.css'
import './video-ad-card.css'

/**
 * Builder2 result card: final video + backend marketing copy + Download ZIP.
 */
function VideoAdCard({
  attemptNumber: _attemptNumber,
  jobId: propJobId,
  videoSrc: propVideoSrc,
  marketingText: propMarketingText,
  headline: propHeadline,
  headlineText: propHeadlineText,
  overlayHeadline: propOverlayHeadline,
  productNameResolved: propProductNameResolved,
  placeholderLabel,
  isGenerating,
  onPlaybackError
}) {
  const [videoSrc, setVideoSrc] = useState(propVideoSrc || null)
  const [marketingText, setMarketingText] = useState(propMarketingText ?? '')
  const [headline, setHeadline] = useState(propHeadline ?? '')
  const [downloadLoading, setDownloadLoading] = useState(false)
  const [downloadError, setDownloadError] = useState(null)

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
  const marketingCopy = marketingText == null ? '' : String(marketingText)
  const hasMarketingText = marketingCopy.length > 0
  const downloadJobId = String(propJobId ?? '').trim()
  const canDownload =
    !isGenerating && !downloadLoading && !!videoUrl && hasMarketingText && !!downloadJobId

  const handleDownload = async () => {
    if (!canDownload) return
    if (!downloadJobId) return

    setDownloadLoading(true)
    setDownloadError(null)
    try {
      const { blob, filename } = await downloadBuilder2Zip({
        jobId: downloadJobId
      })
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : 'Download failed. Please try again.'
      setDownloadError(message)
    } finally {
      setDownloadLoading(false)
    }
  }

  return (
    <div className="ad-card">
      {placeholderLabel ? (
        <p className="ad-card-placeholder-label" dir="ltr" aria-label="Test placeholder marker">
          {placeholderLabel}
        </p>
      ) : null}
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
      {hasMarketingText ? (
        <div className="ad-card-text ad-card-video-marketing-text" dir="auto">
          <p dir="auto">
            <bdi>{marketingCopy}</bdi>
          </p>
        </div>
      ) : null}
      {baseHeadline ? (
        <div className="ad-card-video-headline" dir="auto">
          <div className="ad-card-video-headline-product">
            <bdi>{productLine || split.first}</bdi>
          </div>
          <div className="ad-card-video-headline-text">
            <bdi>{restLine}</bdi>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className="ad-card-download"
        onClick={handleDownload}
        disabled={isGenerating || !videoUrl || !hasMarketingText || !downloadJobId || downloadLoading}
      >
        {downloadLoading ? 'Downloading…' : 'DOWNLOAD ZIP להורדה'}
      </button>
      {downloadError ? (
        <p className="ad-card-download-error" dir="auto" role="alert">
          {downloadError}
        </p>
      ) : null}
    </div>
  )
}

export default VideoAdCard
