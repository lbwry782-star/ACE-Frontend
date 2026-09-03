/**
 * Builder1 explicit offline placeholder transport (Preview1→Builder1 test path only).
 * Active ONLY when Preview1 test is armed, valid checkout exists, and navigator.onLine === false.
 */

import JSZip from 'jszip'
import { createBuilder1RequestId } from './builder1RequestId.js'
import {
  normalizeBuilder1AdCount,
  normalizeBuilder1FormatForApi,
  countMarketingWords
} from './builder1Campaign.js'
import { PREVIEW1_TIER_AD_COUNTS } from './builder1CampaignCount.js'

export const BUILDER1_OFFLINE_PLACEHOLDER_PROGRESS_MS = 1500

/** Minimal 1×1 PNG for placeholder ads — no network fetch. */
const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const PLACEHOLDER_PNG_BYTES =
  typeof Buffer !== 'undefined'
    ? Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64')
    : Uint8Array.from(atob(PLACEHOLDER_PNG_BASE64), (c) => c.charCodeAt(0))

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

function buildPlaceholderAd(adIndex) {
  return {
    index: adIndex,
    headline: `PLACEHOLDER AD ${adIndex}`,
    marketingText: placeholderMarketingText(adIndex),
    imageBase64: PLACEHOLDER_PNG_BASE64,
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
  const ad = buildPlaceholderAd(adIndex)
  const terminal = buildTerminalFields(adIndex, adCount)
  const brandSlogan = 'PLACEHOLDER BRAND SLOGAN'
  const format = campaign.format

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
  const ad = buildPlaceholderAd(adIndex)
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

  const marketingText = placeholderMarketingText(adIndex)
  const zip = new JSZip()
  zip.file(`placeholder-ad-${adIndex}.png`, PLACEHOLDER_PNG_BYTES)
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
