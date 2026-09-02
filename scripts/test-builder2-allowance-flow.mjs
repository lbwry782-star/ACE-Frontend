/**
 * Builder2 allowance flow: initial/next, results order, per-job ZIP wiring tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  getBuilder2GenerateButtonLabel,
  isBuilder2GenerateButtonDisabled,
  isBuilder2AllowanceConsumed,
  upsertBuilder2CompletedVideo,
  parseBuilder2CompletedVideosFromStatus,
  mergeBuilder2AllowanceState
} from '../src/utils/builder2Allowance.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const apiSource = readFileSync(join(root, 'src/services/api.js'), 'utf8')
const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const videoAdCardSource = readFileSync(join(root, 'src/components/VideoAdCard/VideoAdCard.jsx'), 'utf8')

assert.match(apiSource, /targetVideoCount === 1 \|\| targetVideoCount === 2/)
assert.match(apiSource, /body\.targetVideoCount = targetVideoCount/)
assert.match(builder2PageSource, /targetVideoCount/)

assert.match(builder2PageSource, /videoAllowanceId/)
assert.match(builder2PageSource, /mergeBuilder2AllowanceState/)
assert.match(builder2PageSource, /allowanceLockedRef/)

assert.equal(getBuilder2GenerateButtonLabel({ consumed: true }), 'CONSUMED')
assert.equal(getBuilder2GenerateButtonLabel({ canGenerateNext: true }), 'GENERATE AGAIN')

assert.match(apiSource, /\/api\/generate-video-next/)
assert.match(apiSource, /async function generateVideoNext/)
assert.match(apiSource, /JSON\.stringify\(\{\s*videoAllowanceId: allowanceId\s*\}\)/)
assert.doesNotMatch(
  apiSource.match(/async function generateVideoNext[\s\S]*?\n\}/)?.[0] ?? '',
  /productName|productDescription/
)
assert.match(builder2PageSource, /generateVideoNext/)
assert.match(builder2PageSource, /generateNextInFlightRef/)

const generateNextBlock =
  builder2PageSource.match(/if \(isGenerateNext\) \{[\s\S]{0,500}/)?.[0] ?? ''
assert.doesNotMatch(generateNextBlock, /generateVideo\(/)

assert.match(builder2PageSource, /generateNextInFlightRef\.current/)

assert.equal(
  isBuilder2AllowanceConsumed({
    targetVideoCount: 2,
    generatedVideoCount: 2,
    canGenerateNext: false,
    consumed: true
  }),
  true
)
assert.equal(
  isBuilder2GenerateButtonDisabled({
    consumed: true,
    canGenerateNext: false
  }),
  true
)

let videos = []
videos = upsertBuilder2CompletedVideo(videos, {
  videoIndex: 1,
  jobId: 'job-1',
  videoUrl: 'https://example/v1.mp4',
  marketingText: 'text one'
})
videos = upsertBuilder2CompletedVideo(videos, {
  videoIndex: 2,
  jobId: 'job-2',
  videoUrl: 'https://example/v2.mp4',
  marketingText: 'text two'
})
assert.equal(videos.length, 2)
assert.equal(videos[0].videoIndex, 1)
assert.equal(videos[1].videoIndex, 2)
assert.notEqual(videos[0].jobId, videos[1].jobId)

const parsed = parseBuilder2CompletedVideosFromStatus({
  videos: [
    { videoIndex: 2, jobId: 'job-2', videoUrl: 'u2', marketingText: 'm2', status: 'done' },
    { videoIndex: 1, jobId: 'job-1', videoUrl: 'u1', marketingText: 'm1', status: 'done' }
  ]
})
assert.equal(parsed[0].videoIndex, 1)
assert.equal(parsed[1].videoIndex, 2)

assert.match(builder2PageSource, /completedVideos\.map/)
assert.match(builder2PageSource, /upsertBuilder2CompletedVideo/)
assert.doesNotMatch(
  builder2PageSource.match(/if \(!isGenerateNext\)[\s\S]{0,400}/)?.[0] ?? '',
  /resetFreshFormFields\(\)/
)

assert.notEqual(videos[0].marketingText, videos[1].marketingText)

assert.match(apiSource, /JSON\.stringify\(\{\s*jobId: trimmedJobId\s*\}\)/)
assert.match(videoAdCardSource, /downloadBuilder2Zip\(\{\s*jobId: downloadJobId/)
assert.match(videoAdCardSource, /propJobId/)
assert.match(builder2PageSource, /jobId=\{video\.jobId\}/)
assert.match(videoAdCardSource, /downloadLoading/)
assert.doesNotMatch(
  videoAdCardSource.match(/handleDownload[\s\S]{0,800}/)?.[0] ?? '',
  /generateVideo|generateVideoNext/
)

const merged = mergeBuilder2AllowanceState(null, {
  videoAllowanceId: 'allow-1',
  targetVideoCount: 2,
  videoIndex: 1,
  generatedVideoCount: 1,
  remainingVideoCount: 1,
  canGenerateNext: true,
  consumed: false
})
assert.equal(merged.videoAllowanceId, 'allow-1')
assert.equal(merged.canGenerateNext, true)

assert.match(videoAdCardSource, /await downloadBuilder2Zip/)

console.log('test-builder2-allowance-flow.mjs: passed')
