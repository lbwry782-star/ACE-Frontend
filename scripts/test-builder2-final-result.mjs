/**
 * Builder2 final result + ZIP download tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  buildBuilder2VideoResult,
  resolveBuilder2MarketingText,
  isBuilder2StatusCompleted
} from '../src/utils/builder2Status.js'
import {
  parseContentDispositionFilename,
  BUILDER2_ZIP_DEFAULT_FILENAME
} from '../src/services/api.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const videoAdCardSource = readFileSync(join(root, 'src/components/VideoAdCard/VideoAdCard.jsx'), 'utf8')
const videoAdCardCss = readFileSync(join(root, 'src/components/VideoAdCard/video-ad-card.css'), 'utf8')
const adCardCss = readFileSync(join(root, 'src/components/AdCard/adcard.css'), 'utf8')
const apiSource = readFileSync(join(root, 'src/services/api.js'), 'utf8')
const builder1PageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const statusSource = readFileSync(join(root, 'src/utils/builder2Status.js'), 'utf8')

const longMarketingText = 'מילה '.repeat(50).trim()

// A. Completed status propagation — marketingText preserved in final result
const payload = {
  status: 'done',
  videoUrl: 'https://cdn.example/final.mp4',
  marketingText: longMarketingText
}
assert.ok(isBuilder2StatusCompleted(payload))
assert.equal(resolveBuilder2MarketingText(payload), longMarketingText)
const built = buildBuilder2VideoResult(payload)
assert.equal(built.videoUrl, 'https://cdn.example/final.mp4')
assert.equal(built.marketingText, longMarketingText)
assert.doesNotMatch(statusSource, /generateMarketingText/)
assert.doesNotMatch(builder2PageSource, /generateMarketingText/)

// B. Rendering order — video, marketing text, download button
const videoIdx = videoAdCardSource.indexOf('ad-card-video-wrap')
const marketingIdx = videoAdCardSource.indexOf('ad-card-video-marketing-text')
const downloadIdx = videoAdCardSource.indexOf('ad-card-download')
assert.ok(videoIdx > 0 && marketingIdx > videoIdx, 'marketing text after video')
assert.ok(downloadIdx > marketingIdx, 'download after marketing text')

// C. Full text — no truncation helpers/CSS for Builder2 marketing copy
assert.equal(built.marketingText.length, longMarketingText.length)
assert.doesNotMatch(videoAdCardCss, /line-clamp|-webkit-line-clamp|text-overflow:\s*ellipsis/)
assert.doesNotMatch(
  videoAdCardSource.match(/marketingCopy[\s\S]{0,800}/)?.[0] ?? '',
  /\.slice\(|\.substring\(|wordCount|truncate/
)
assert.doesNotMatch(
  statusSource.match(/resolveBuilder2MarketingText[\s\S]{0,300}/)?.[0] ?? '',
  /\.slice\(|\.substring\(/
)

// D. Correct ZIP endpoint — POST builder2-download-zip, not legacy GET
assert.match(apiSource, /\/api\/builder2-download-zip/)
assert.match(videoAdCardSource, /downloadBuilder2Zip/)
assert.doesNotMatch(videoAdCardSource, /download-video-zip/)
assert.doesNotMatch(videoAdCardSource, /ace-backend-k1p6\.onrender\.com/)
assert.doesNotMatch(builder2PageSource, /download-video-zip/)

// E. Request body — exact jobId JSON
assert.match(
  apiSource,
  /JSON\.stringify\(\{\s*jobId: trimmedJobId\s*\}\)/
)

// F. Blob download — no browser navigation to backend
assert.match(apiSource, /response\.blob\(\)/)
assert.match(videoAdCardSource, /downloadBuilder2Zip/)
assert.match(videoAdCardSource, /URL\.createObjectURL/)
assert.match(videoAdCardSource, /URL\.revokeObjectURL/)
assert.doesNotMatch(videoAdCardSource, /window\.location/)
assert.doesNotMatch(videoAdCardSource, /window\.open/)
assert.doesNotMatch(
  videoAdCardSource.match(/handleDownload[\s\S]{0,1200}/)?.[0] ?? '',
  /a\.href\s*=\s*[`'"]https?:/
)

// G. Download failure — result stays visible, controlled error, retry
assert.match(videoAdCardSource, /downloadError/)
assert.match(videoAdCardSource, /setDownloadError/)
assert.match(videoAdCardSource, /role="alert"/)
assert.doesNotMatch(
  videoAdCardSource.match(/catch \(err\)[\s\S]{0,400}/)?.[0] ?? '',
  /setVideoSrc\(null\)|setMarketingText\(''\)/
)

// H. Missing marketingText — no premature download/render of marketing block
const incomplete = buildBuilder2VideoResult({
  status: 'done',
  videoUrl: 'https://cdn.example/v.mp4'
})
assert.equal(incomplete.marketingText, null)
assert.match(videoAdCardSource, /hasMarketingText \?/)
assert.match(videoAdCardSource, /!hasMarketingText/)

// Content-Disposition filename parsing + default fallback
assert.equal(parseContentDispositionFilename('attachment; filename="result.zip"'), 'result.zip')
assert.equal(BUILDER2_ZIP_DEFAULT_FILENAME, 'ace-builder2-video.zip')

// Builder1 isolation — legacy route may remain in Builder1 only
assert.doesNotMatch(builder1PageSource, /builder2-download-zip/)
assert.doesNotMatch(builder1PageSource, /downloadBuilder2Zip/)

console.log('builder2 final result tests passed')
