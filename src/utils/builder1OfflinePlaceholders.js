/**
 * Builder1 explicit offline placeholder transport (Preview1→Builder1 test path only).
 * Active ONLY when Preview1 test is armed, valid checkout exists, and navigator.onLine === false.
 */

import JSZip from 'jszip'
import { createBuilder1RequestId } from './builder1RequestId.js'
import {
  normalizeBuilder1AdCount,
  normalizeBuilder1FormatForApi,
  countMarketingWords,
  getBuilder1FormatDimensions,
  BUILDER1_FORMAT_DIMENSIONS
} from './builder1Campaign.js'
import { PREVIEW1_TIER_AD_COUNTS } from './builder1CampaignCount.js'

export const BUILDER1_OFFLINE_PLACEHOLDER_PROGRESS_MS = 1500

/** @deprecated Use BUILDER1_FORMAT_DIMENSIONS from builder1Campaign.js */
export const BUILDER1_OFFLINE_PLACEHOLDER_DIMENSIONS = BUILDER1_FORMAT_DIMENSIONS

/** Distinct full-frame test fills per ad index [R,G,B]. */
const BUILDER1_PLACEHOLDER_FILL_RGB = Object.freeze({
  1: [185, 28, 28],
  2: [29, 78, 216],
  3: [21, 128, 61],
  4: [161, 98, 7]
})

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

/** @type {Map<string, string>} base64 cache */
const placeholderImageBase64Cache = new Map()

/** @type {Map<string, Uint8Array>} bytes cache */
const placeholderImageBytesCache = new Map()

const VALID_PREVIEW1_OFFLINE_AD_COUNTS = new Set(Object.values(PREVIEW1_TIER_AD_COUNTS))

/** @type {((ctx?: object) => boolean) | null} */
let preview1PlaceholderActiveCheck = null

/** @type {Map<string, object>} */
const offlineJobs = new Map()

/** @type {Map<string, object>} */
const offlineCampaigns = new Map()

/**
 * @param {(ctx?: object) => boolean} fn
 */
export function registerPreview1PlaceholderActiveCheck(fn) {
  preview1PlaceholderActiveCheck = fn
}

/**
 * @param {{ navigatorOnline?: boolean, hash?: string, search?: string }} [ctx]
 */
export function isBuilder1OfflinePlaceholderTransportActive(ctx = {}) {
  return preview1PlaceholderActiveCheck?.(ctx) === true
}

/**
 * @param {unknown} adCount
 */
export function isValidPreview1OfflineTestAdCount(adCount) {
  return VALID_PREVIEW1_OFFLINE_AD_COUNTS.has(normalizeBuilder1AdCount(adCount))
}

export function resetBuilder1OfflinePlaceholderRuntime() {
  offlineJobs.clear()
  offlineCampaigns.clear()
  placeholderImageBase64Cache.clear()
  placeholderImageBytesCache.clear()
}

/** @type {{ deflateSync?: Function, inflateSync?: Function } | null} */
let nodeZlibForTests = null

/** Test-only injection so Node regression tests can encode/decode PNG bytes. */
export function __setBuilder1PlaceholderNodeZlibForTests(zlib) {
  nodeZlibForTests = zlib
}

/**
 * @param {unknown} format
 */
export function getBuilder1OfflinePlaceholderDimensions(format) {
  return getBuilder1FormatDimensions(format)
}

function placeholderFillRgb(adIndex) {
  const idx = Number(adIndex)
  return BUILDER1_PLACEHOLDER_FILL_RGB[idx] ?? BUILDER1_PLACEHOLDER_FILL_RGB[1]
}

function makeCrcTable() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}

const CRC_TABLE = makeCrcTable()

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeU32BE(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type)
  const chunk = new Uint8Array(4 + typeBytes.length + data.length + 4)
  writeU32BE(chunk, 0, data.length)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  const crcInput = chunk.subarray(4, 8 + data.length)
  writeU32BE(chunk, 8 + data.length, crc32(crcInput))
  return chunk
}

function encodeSolidRgbPng(width, height, rgb) {
  const [r, g, b] = rgb
  const rowSize = 1 + width * 3
  const raw = new Uint8Array(height * rowSize)
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowSize
    raw[rowOffset] = 0
    for (let x = 0; x < width; x += 1) {
      const px = rowOffset + 1 + x * 3
      raw[px] = r
      raw[px + 1] = g
      raw[px + 2] = b
    }
  }

  const deflateSync = nodeZlibForTests?.deflateSync
  if (typeof deflateSync !== 'function') {
    throw new Error('Node zlib not available for placeholder PNG encoding')
  }
  const compressed = deflateSync(raw)

  const ihdr = new Uint8Array(13)
  writeU32BE(ihdr, 0, width)
  writeU32BE(ihdr, 4, height)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const idat = compressed instanceof Uint8Array ? compressed : new Uint8Array(compressed)
  const parts = [PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function paintPlaceholderCanvas(ctx, width, height, adIndex) {
  const [r, g, b] = placeholderFillRgb(adIndex)
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const fontSize = Math.max(24, Math.round(Math.min(width, height) * 0.06))
  ctx.font = `bold ${fontSize}px sans-serif`
  ctx.fillText(`PLACEHOLDER AD #${adIndex}`, width / 2, height / 2)
}

/**
 * @param {unknown} format
 * @param {number} adIndex
 */
export function createBuilder1PlaceholderPngBytes(format, adIndex) {
  const normalizedFormat = normalizeBuilder1FormatForApi(format) || 'portrait'
  const cacheKey = `${normalizedFormat}:${adIndex}`
  if (placeholderImageBytesCache.has(cacheKey)) {
    return placeholderImageBytesCache.get(cacheKey)
  }

  const { width, height } = getBuilder1OfflinePlaceholderDimensions(normalizedFormat)

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx) {
      paintPlaceholderCanvas(ctx, width, height, adIndex)
      const dataUrl = canvas.toDataURL('image/png')
      const base64 = dataUrl.split(',')[1] ?? ''
      const binary =
        typeof Buffer !== 'undefined'
          ? Buffer.from(base64, 'base64')
          : Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary)
      placeholderImageBytesCache.set(cacheKey, bytes)
      placeholderImageBase64Cache.set(cacheKey, base64)
      return bytes
    }
  }

  const bytes = encodeSolidRgbPng(width, height, placeholderFillRgb(adIndex))
  placeholderImageBytesCache.set(cacheKey, bytes)
  const base64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(bytes).toString('base64')
      : btoa(String.fromCharCode(...bytes))
  placeholderImageBase64Cache.set(cacheKey, base64)
  return bytes
}

/**
 * @param {unknown} format
 * @param {number} adIndex
 */
export function createBuilder1PlaceholderImageBase64(format, adIndex) {
  const normalizedFormat = normalizeBuilder1FormatForApi(format) || 'portrait'
  const cacheKey = `${normalizedFormat}:${adIndex}`
  if (placeholderImageBase64Cache.has(cacheKey)) {
    return placeholderImageBase64Cache.get(cacheKey)
  }
  createBuilder1PlaceholderPngBytes(normalizedFormat, adIndex)
  return placeholderImageBase64Cache.get(cacheKey) ?? ''
}

/**
 * @param {Uint8Array|Buffer} pngBytes
 */
export function parseBuilder1PlaceholderPngDimensions(pngBytes) {
  const bytes = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes)
  if (bytes.length < 24) return null
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null
  }
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
  if (!width || !height) return null
  return { width, height }
}

/**
 * @param {Uint8Array|Buffer} pngBytes
 */
function collectPngIdatBytes(pngBytes) {
  const view = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes)
  let offset = 8
  const idatParts = []
  while (offset + 8 <= view.length) {
    const length =
      (view[offset] << 24) |
      (view[offset + 1] << 16) |
      (view[offset + 2] << 8) |
      view[offset + 3]
    const type = String.fromCharCode(view[offset + 4], view[offset + 5], view[offset + 6], view[offset + 7])
    const data = view.subarray(offset + 8, offset + 8 + length)
    if (type === 'IDAT') idatParts.push(data)
    offset += 12 + length
    if (type === 'IEND') break
  }
  const combined = new Uint8Array(idatParts.reduce((sum, part) => sum + part.length, 0))
  let writeAt = 0
  for (const part of idatParts) {
    combined.set(part, writeAt)
    writeAt += part.length
  }
  return combined
}

/**
 * Verify every RGB pixel matches the expected solid fill (full canvas painted).
 * @param {Uint8Array|Buffer} pngBytes
 * @param {unknown} format
 * @param {number} adIndex
 */
export function assertBuilder1PlaceholderPngFullyPainted(pngBytes, format, adIndex) {
  const dims = parseBuilder1PlaceholderPngDimensions(pngBytes)
  const expected = getBuilder1OfflinePlaceholderDimensions(format)
  if (!dims || dims.width !== expected.width || dims.height !== expected.height) {
    throw new Error(
      `Placeholder PNG dimensions invalid: got ${dims?.width}x${dims?.height}, expected ${expected.width}x${expected.height}`
    )
  }

  const inflateSync = nodeZlibForTests?.inflateSync
  if (typeof inflateSync !== 'function') {
    throw new Error('Node zlib not available for placeholder PNG verification')
  }

  const inflated = inflateSync(collectPngIdatBytes(pngBytes))
  const raw = inflated instanceof Uint8Array ? inflated : new Uint8Array(inflated)
  const { width, height } = dims
  const rowSize = 1 + width * 3
  if (raw.length !== height * rowSize) {
    throw new Error(`Placeholder PNG row data length invalid: ${raw.length} !== ${height * rowSize}`)
  }

  const [r, g, b] = placeholderFillRgb(adIndex)
  const samplePoints = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width / 2), Math.floor(height / 2)]
  ]

  for (const [x, y] of samplePoints) {
    const px = y * rowSize + 1 + x * 3
    if (raw[y * rowSize] !== 0) {
      throw new Error(`Unexpected PNG filter byte at row ${y}`)
    }
    if (raw[px] !== r || raw[px + 1] !== g || raw[px + 2] !== b) {
      throw new Error(`Unpainted pixel at (${x},${y}): got ${raw[px]},${raw[px + 1]},${raw[px + 2]}`)
    }
  }

  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 16))) {
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 16))) {
      const px = y * rowSize + 1 + x * 3
      if (raw[px] !== r || raw[px + 1] !== g || raw[px + 2] !== b) {
        throw new Error(`Unpainted pixel at (${x},${y})`)
      }
    }
  }
}

export const BUILDER1_PLACEHOLDER_MARKETING_TEXT_1 =
  'Placeholder marketing text number one for Builder1 offline testing only alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november'

export const BUILDER1_PLACEHOLDER_MARKETING_TEXT_2 =
  'Placeholder marketing text number two for Builder1 offline testing only hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform'

export const BUILDER1_PLACEHOLDER_MARKETING_TEXT_3 =
  'Placeholder marketing text number three for Builder1 offline testing only hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform'

export const BUILDER1_PLACEHOLDER_MARKETING_TEXT_4 =
  'Placeholder marketing text number four for Builder1 offline testing only hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform'

function placeholderMarketingText(adIndex) {
  if (adIndex === 4) return BUILDER1_PLACEHOLDER_MARKETING_TEXT_4
  if (adIndex === 3) return BUILDER1_PLACEHOLDER_MARKETING_TEXT_3
  if (adIndex === 2) return BUILDER1_PLACEHOLDER_MARKETING_TEXT_2
  return BUILDER1_PLACEHOLDER_MARKETING_TEXT_1
}

function buildPlaceholderAd(adIndex, format = 'portrait') {
  return {
    index: adIndex,
    headline: `PLACEHOLDER AD ${adIndex}`,
    marketingText: placeholderMarketingText(adIndex),
    imageBase64: createBuilder1PlaceholderImageBase64(format, adIndex),
    isPlaceholder: true
  }
}

function baseComposition(format, brandSlogan) {
  return {
    format,
    brandSlogan,
    graphicGenerator: {
      layoutTemplate: 'campaign_default',
      brandBlockPlacement: 'bottom-left',
      sloganPlacement: 'bottom-left',
      palette: { primary: '#112233', secondary: '#445566' }
    }
  }
}

function buildTerminalFields(adIndex, adCount) {
  const isLast = adIndex >= adCount
  return {
    targetAdCount: adCount,
    generatedCount: adIndex,
    canGenerateNext: !isLast,
    campaignReady: isLast,
    deliveryReconstructible: isLast,
    nextAdIndex: isLast ? adCount + 1 : adIndex + 1
  }
}

function buildInitialTerminalResult(campaign, adIndex) {
  const adCount = campaign.adCount
  const format = campaign.format
  const ad = buildPlaceholderAd(adIndex, format)
  const terminal = buildTerminalFields(adIndex, adCount)
  const brandSlogan = 'PLACEHOLDER BRAND SLOGAN'

  return {
    ok: true,
    campaignId: campaign.campaignId,
    campaign: {
      productNameResolved: campaign.productNameResolved,
      brandSlogan,
      detectedLanguage: 'he',
      format,
      adCount
    },
    composition: baseComposition(format, brandSlogan),
    ad,
    ...terminal,
    isPlaceholder: true
  }
}

function buildNextTerminalResult(campaign, adIndex) {
  const ad = buildPlaceholderAd(adIndex, campaign.format)
  const terminal = buildTerminalFields(adIndex, campaign.adCount)
  return {
    ok: true,
    campaignId: campaign.campaignId,
    ad,
    ...terminal,
    isPlaceholder: true
  }
}

function mutationAccepted(jobId, campaignId) {
  return {
    response: { ok: true, status: 202 },
    payload: { ok: true, jobId, campaignId }
  }
}

/**
 * @param {object} body
 */
export async function offlineBuilder1Generate(body = {}) {
  if (!isBuilder1OfflinePlaceholderTransportActive()) {
    throw new Error('offline_mode_inactive')
  }

  const adCount = normalizeBuilder1AdCount(body?.adCount)
  const format = normalizeBuilder1FormatForApi(body?.format) || 'portrait'
  const productName = String(body?.productName ?? '').trim() || 'Placeholder Product'
  const campaignId = createBuilder1RequestId()
  const jobId = createBuilder1RequestId()

  offlineCampaigns.set(campaignId, {
    campaignId,
    adCount,
    format,
    productNameResolved: productName,
    generatedAds: []
  })

  offlineJobs.set(jobId, {
    jobId,
    campaignId,
    operation: 'initial',
    adIndex: 1,
    status: 'pending',
    startedAt: Date.now()
  })

  return mutationAccepted(jobId, campaignId)
}

/**
 * @param {object} body
 */
export async function offlineBuilder1GenerateNext(body = {}) {
  if (!isBuilder1OfflinePlaceholderTransportActive()) {
    throw new Error('offline_mode_inactive')
  }

  const campaignId = String(body?.campaignId ?? '').trim()
  const expectedIndex = Number(body?.expectedNextIndex ?? body?.expected_next_index)
  const campaign = offlineCampaigns.get(campaignId)
  if (!campaign) {
    return {
      response: { ok: false, status: 400 },
      payload: { ok: false, error: 'unknown_campaign' }
    }
  }

  const jobId = createBuilder1RequestId()
  offlineJobs.set(jobId, {
    jobId,
    campaignId,
    operation: 'next',
    adIndex: expectedIndex,
    status: 'pending',
    startedAt: Date.now()
  })

  return mutationAccepted(jobId, campaignId)
}

/**
 * @param {string} jobId
 */
export async function offlineBuilder1FetchStatus(jobId) {
  if (!isBuilder1OfflinePlaceholderTransportActive()) {
    throw new Error('offline_mode_inactive')
  }

  const job = offlineJobs.get(String(jobId ?? '').trim())
  if (!job) {
    return {
      response: { ok: false, status: 404 },
      payload: { status: 'error', error: 'job_not_found' }
    }
  }

  const elapsed = Date.now() - (Number(job.startedAt) || Date.now())
  if (job.status !== 'done' && elapsed < BUILDER1_OFFLINE_PLACEHOLDER_PROGRESS_MS) {
    return {
      response: { ok: true, status: 200 },
      payload: { status: 'running', stage: 'generating_ad' }
    }
  }

  const campaign = offlineCampaigns.get(job.campaignId)
  if (!campaign) {
    return {
      response: { ok: false, status: 404 },
      payload: { status: 'error', error: 'unknown_campaign' }
    }
  }

  const result =
    job.operation === 'initial'
      ? buildInitialTerminalResult(campaign, job.adIndex)
      : buildNextTerminalResult(campaign, job.adIndex)

  job.status = 'done'
  job.result = result
  campaign.generatedAds.push(job.adIndex)

  return {
    response: { ok: true, status: 200 },
    payload: { status: 'done', result }
  }
}

/**
 * @param {object} body
 */
export async function offlineBuilder1DownloadZip(body = {}) {
  if (!isBuilder1OfflinePlaceholderTransportActive()) {
    throw new Error('offline_mode_inactive')
  }

  const adIndex = Number(body?.ad?.index)
  if (!Number.isInteger(adIndex) || adIndex < 1) {
    throw new Error('Missing ad index')
  }

  const campaignId = String(body?.campaignId ?? '').trim()
  const campaign = campaignId ? offlineCampaigns.get(campaignId) : null
  const format = campaign?.format ?? 'portrait'
  const marketingText = placeholderMarketingText(adIndex)
  const zip = new JSZip()
  zip.file(`placeholder-ad-${adIndex}.png`, createBuilder1PlaceholderPngBytes(format, adIndex))
  zip.file('marketing-text.txt', marketingText)

  const useNodeBuffer = typeof Buffer !== 'undefined' && typeof document === 'undefined'
  const blob = await zip.generateAsync({ type: useNodeBuffer ? 'nodebuffer' : 'blob' })

  if (useNodeBuffer) {
    return new Response(blob, {
      status: 200,
      headers: { 'Content-Type': 'application/zip' }
    })
  }

  if (typeof Response !== 'undefined') {
    return new Response(blob, {
      status: 200,
      headers: { 'Content-Type': 'application/zip' }
    })
  }

  return { ok: true, blob, filename: `builder1-placeholder-ad-${adIndex}.zip` }
}

export function assertBuilder1PlaceholderMarketingTexts() {
  const texts = [
    BUILDER1_PLACEHOLDER_MARKETING_TEXT_1,
    BUILDER1_PLACEHOLDER_MARKETING_TEXT_2,
    BUILDER1_PLACEHOLDER_MARKETING_TEXT_3,
    BUILDER1_PLACEHOLDER_MARKETING_TEXT_4
  ]
  for (let i = 0; i < texts.length; i += 1) {
    const count = countMarketingWords(texts[i])
    if (count !== 50) {
      throw new Error(`Builder1 placeholder word count invalid for ad ${i + 1}: ${count}`)
    }
  }
}
