/**
 * Canonical Builder1 campaign ad-count storage (Preview1 → Builder1).
 */

import { resolveBuilder1CheckoutAdCount } from './builder1Checkout.js'

/** Primary storage key for selected campaign size (2–4 ads). */
export const BUILDER1_CAMPAIGN_AD_COUNT_KEY = 'ace_builder1_campaign_ad_count'

/** Legacy key — read once for migration, then removed. */
export const BUILDER1_LEGACY_MAX_ADS_KEY = 'ace_builder1_max_ads'

/** Preview1 payment tier asset keys → planned ad count. */
export const PREVIEW1_TIER_AD_COUNTS = Object.freeze({
  '1': 2,
  '2': 3,
  '5': 4
})

/**
 * Parse a stored string at the storage boundary.
 * @param {unknown} raw
 * @returns {number|null} Integer 2–4, or null when invalid/missing.
 */
export function parseStoredBuilder1AdCount(raw) {
  if (raw == null) return null
  const text = String(raw).trim()
  if (!text) return null
  const parsed = Number(text)
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 4) {
    return null
  }
  return parsed
}

/**
 * @param {unknown} value
 * @returns {number} Integer 2–4, or 2 when invalid.
 */
export function normalizeBuilder1AdCount(value) {
  const parsed = parseStoredBuilder1AdCount(value)
  return parsed ?? 2
}

/**
 * @param {unknown} tierKey Preview1 asset key ('1' | '2' | '5').
 * @returns {number|null}
 */
export function preview1TierKeyToAdCount(tierKey) {
  const key = String(tierKey ?? '').trim()
  if (Object.prototype.hasOwnProperty.call(PREVIEW1_TIER_AD_COUNTS, key)) {
    return PREVIEW1_TIER_AD_COUNTS[key]
  }
  return null
}

/**
 * @param {number} normalized
 */
function migrateBuilder1CampaignAdCount(normalized) {
  const value = String(normalized)
  try {
    localStorage.setItem(BUILDER1_CAMPAIGN_AD_COUNT_KEY, value)
    sessionStorage.setItem(BUILDER1_CAMPAIGN_AD_COUNT_KEY, value)
    localStorage.removeItem(BUILDER1_LEGACY_MAX_ADS_KEY)
    sessionStorage.removeItem(BUILDER1_LEGACY_MAX_ADS_KEY)
  } catch (_) {
    /* ignore quota / privacy mode */
  }
}

/**
 * Read raw stored value from all supported locations (canonical first).
 * @returns {{ raw: string|null, source: string|null }}
 */
export function readRawBuilder1CampaignAdCount() {
  const storages = [
    ['localStorage', localStorage],
    ['sessionStorage', sessionStorage]
  ]
  const keys = [BUILDER1_CAMPAIGN_AD_COUNT_KEY, BUILDER1_LEGACY_MAX_ADS_KEY]

  for (const [storageName, storage] of storages) {
    if (!storage) continue
    for (const key of keys) {
      try {
        const val = storage.getItem(key)
        if (val != null && String(val).trim() !== '') {
          return { raw: String(val).trim(), source: `${storageName}:${key}` }
        }
      } catch (_) {
        /* ignore */
      }
    }
  }
  return { raw: null, source: null }
}

/**
 * Persist selected campaign ad count (numeric 2–4).
 * @param {unknown} count
 */
export function saveBuilder1CampaignAdCount(count) {
  const normalized = normalizeBuilder1AdCount(count)
  migrateBuilder1CampaignAdCount(normalized)
  logBuilder1AdCount('BUILDER1_SELECTED_AD_COUNT', normalized)
  return normalized
}

/**
 * Read stored campaign ad count; migrates legacy values into the canonical key.
 * Falls back to 2 only when no valid value exists in any storage location.
 * @returns {number}
 */
export function readBuilder1CampaignAdCount() {
  const { raw, source } = readRawBuilder1CampaignAdCount()
  const parsed = parseStoredBuilder1AdCount(raw)
  const normalized = parsed ?? 2

  if (parsed != null) {
    migrateBuilder1CampaignAdCount(parsed)
  }

  if (typeof console !== 'undefined' && console.info) {
    console.info(
      `BUILDER1_SELECTED_AD_COUNT raw=${raw ?? 'null'} source=${source ?? 'default'} normalized=${normalized}`
    )
  }

  return normalized
}

/**
 * Resolve ad count for the initial generate request.
 * Uses an already-locked session target when present, otherwise checkout-scoped selection.
 * @param {{ targetAdCount?: number|null, checkoutId?: string|null, search?: string, hash?: string }} [ctx]
 * @returns {number}
 */
export function resolveBuilder1InitialAdCount(ctx = {}) {
  return resolveBuilder1CheckoutAdCount(ctx).adCount
}

/**
 * @param {string} label
 * @param {number} count
 */
export function logBuilder1AdCount(label, count) {
  if (typeof console !== 'undefined' && console.info) {
    console.info(`${label}=${count}`)
  }
}

/**
 * Log outgoing API adCount with raw + normalized values.
 * @param {unknown} raw
 * @param {number} normalized
 */
export function logBuilder1RequestAdCount(raw, normalized) {
  if (typeof console !== 'undefined' && console.info) {
    console.info(
      `BUILDER1_REQUEST_AD_COUNT rawAdCount=${raw ?? 'null'} normalizedAdCount=${normalizeBuilder1AdCount(normalized)}`
    )
  }
}

/**
 * Main Builder1 generate button label.
 * @param {{ hasGeneratedAds?: boolean, canGenerateNext?: boolean, campaignComplete?: boolean, retryable?: boolean }} ctx
 * @returns {'GENERATE'|'GENERATE AGAIN'|'CONSUMED'|'RETRY'}
 */
export function getBuilder1GenerateButtonLabel(ctx) {
  if (ctx?.retryable) {
    return 'RETRY'
  }
  if (ctx?.campaignComplete) {
    return 'CONSUMED'
  }
  if (ctx?.hasGeneratedAds && ctx?.canGenerateNext) {
    return 'GENERATE AGAIN'
  }
  return 'GENERATE'
}
