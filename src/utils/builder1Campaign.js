/**
 * Builder1 incremental campaign helpers (pure, testable).
 */

import {
  normalizeBuilder1AdCount,
  logBuilder1RequestAdCount,
  readRawBuilder1CampaignAdCount,
  BUILDER1_CAMPAIGN_AD_COUNT_KEY,
  BUILDER1_LEGACY_MAX_ADS_KEY,
  PREVIEW1_TIER_AD_COUNTS,
  preview1TierKeyToAdCount,
  saveBuilder1CampaignAdCount,
  readBuilder1CampaignAdCount,
  logBuilder1AdCount
} from './builder1CampaignCount.js'

export {
  normalizeBuilder1AdCount,
  parseStoredBuilder1AdCount,
  readRawBuilder1CampaignAdCount,
  resolveBuilder1InitialAdCount,
  getBuilder1GenerateButtonLabel,
  BUILDER1_CAMPAIGN_AD_COUNT_KEY,
  BUILDER1_LEGACY_MAX_ADS_KEY,
  PREVIEW1_TIER_AD_COUNTS,
  preview1TierKeyToAdCount,
  saveBuilder1CampaignAdCount,
  readBuilder1CampaignAdCount,
  logBuilder1AdCount,
  logBuilder1RequestAdCount
} from './builder1CampaignCount.js'

export const BUILDER1_SUPPORTED_FORMATS = new Set(['portrait', 'landscape', 'square'])
export const BUILDER1_SUPPORTED_LANGUAGES = new Set(['he', 'en'])
export const BUILDER1_PRODUCT_NAME_GENERATION_FAILED = 'product_name_generation_failed'
export const BUILDER1_MISSING_PRODUCT_DESCRIPTION = 'missing_product_description'
export const BUILDER1_IMAGE_COMPLIANCE_FAILED = 'image_compliance_failed'
export const BUILDER1_IMAGE_COMPLIANCE_UNAVAILABLE = 'image_compliance_unavailable'

export const BUILDER1_RETRY_MODE = Object.freeze({
  REVIEW_ONLY: 'review_only',
  IMAGE_ONLY: 'image_only',
  REPAIR_FROM_PHYSICAL: 'repair_from_physical'
})

const BUILDER1_RETRY_MODE_VALUES = new Set(Object.values(BUILDER1_RETRY_MODE))

export function trimBuilder1ProductName(raw) {
  return String(raw ?? '').trim()
}

export function trimBuilder1ProductDescription(raw) {
  return String(raw ?? '').trim()
}

/** Initial GENERATE: empty product name is allowed when description has content. */
export function validateBuilder1InitialSubmitInputs({ productName, productDescription }) {
  const trimmedName = trimBuilder1ProductName(productName)
  const trimmedDescription = trimBuilder1ProductDescription(productDescription)
  if (!trimmedDescription) {
    return { ok: false, error: BUILDER1_MISSING_PRODUCT_DESCRIPTION }
  }
  return { ok: true, productName: trimmedName, productDescription: trimmedDescription }
}

export function isBuilder1InitialSubmitBlocked({ productName, productDescription }) {
  return !trimBuilder1ProductName(productName) && !trimBuilder1ProductDescription(productDescription)
}

export function getBuilder1ProductDescriptionFieldMessage(language = 'he') {
  return language === 'en' ? 'Product description is required' : 'Product description is required'
}

export function getBuilder1ProductNameGenerationFailedMessage(language = 'he') {
  return language === 'en'
    ? 'Could not generate a product name from your description. Please enter a product name or provide a richer description.'
    : 'לא ניתן ליצור שם מוצר מהתיאור. הזינו שם מוצר או העשירו את התיאור.'
}

export function parseBuilder1ApiErrorCode(body, message) {
  if (typeof body?.error === 'string' && body.error.trim()) {
    return body.error.trim().toLowerCase()
  }
  if (typeof body?.code === 'string' && body.code.trim()) {
    return body.code.trim().toLowerCase()
  }
  const msg = String(message ?? body?.message ?? '').toLowerCase()
  if (msg.includes(BUILDER1_PRODUCT_NAME_GENERATION_FAILED)) {
    return BUILDER1_PRODUCT_NAME_GENERATION_FAILED
  }
  if (msg.includes(BUILDER1_MISSING_PRODUCT_DESCRIPTION)) {
    return BUILDER1_MISSING_PRODUCT_DESCRIPTION
  }
  if (msg.includes(BUILDER1_IMAGE_COMPLIANCE_FAILED)) {
    return BUILDER1_IMAGE_COMPLIANCE_FAILED
  }
  if (msg.includes(BUILDER1_IMAGE_COMPLIANCE_UNAVAILABLE)) {
    return BUILDER1_IMAGE_COMPLIANCE_UNAVAILABLE
  }
  return ''
}

export function isBuilder1ImageComplianceError(code) {
  const normalized = String(code ?? '').trim().toLowerCase()
  return (
    normalized === BUILDER1_IMAGE_COMPLIANCE_FAILED ||
    normalized === BUILDER1_IMAGE_COMPLIANCE_UNAVAILABLE
  )
}

export function getBuilder1ImageComplianceFailedMessage(language = 'he') {
  return language === 'en'
    ? 'The advertisement could not be approved. Please generate it again.'
    : 'לא ניתן לאשר את המודעה. נא ליצור אותה שוב.'
}

export function getBuilder1ImageComplianceUnavailableMessage(language = 'he') {
  return language === 'en'
    ? 'Image verification is temporarily unavailable. Please try again.'
    : 'אימות התמונה אינו זמין כרגע. נא לנסות שוב.'
}

export function getBuilder1ImageComplianceMessage(errorCode, language = 'he') {
  const code = String(errorCode ?? '').trim().toLowerCase()
  if (code === BUILDER1_IMAGE_COMPLIANCE_UNAVAILABLE) {
    return getBuilder1ImageComplianceUnavailableMessage(language)
  }
  if (code === BUILDER1_IMAGE_COMPLIANCE_FAILED) {
    return getBuilder1ImageComplianceFailedMessage(language)
  }
  return null
}

export function getBuilder1ComplianceRetryMismatchMessage(language = 'he') {
  return language === 'en'
    ? 'Could not retry this advertisement safely. Please try again.'
    : 'לא ניתן לנסות שוב את המודעה בצורה בטוחה. נא לנסות שוב.'
}

/**
 * @param {unknown} body
 * @returns {object|null}
 */
export function parseBuilder1RetryContext(body) {
  if (!body || typeof body !== 'object') return null
  const source =
    body.result && typeof body.result === 'object' && body.retryable == null
      ? body.result
      : body
  if (source.retryable !== true) return null

  const campaignId = String(source.campaignId ?? '').trim()
  const retryMode = String(source.retryMode ?? '').trim().toLowerCase()
  const retryAdIndex = Number(source.retryAdIndex)

  if (!campaignId || !BUILDER1_RETRY_MODE_VALUES.has(retryMode)) return null
  if (!Number.isInteger(retryAdIndex) || retryAdIndex < 1) return null

  return {
    retryable: true,
    campaignId,
    retryMode,
    retryAdIndex,
    planRevision: source.planRevision ?? null,
    planningComplete: source.planningComplete ?? null,
    imageGenerated: source.imageGenerated ?? null,
    complianceAvailable: source.complianceAvailable ?? null,
    preservedThroughStage: source.preservedThroughStage ?? null,
    userMessage:
      typeof source.userMessage === 'string' && source.userMessage.trim()
        ? source.userMessage.trim()
        : null,
    status: source.status ?? body.status ?? null,
    stage: source.stage ?? body.stage ?? null,
    error: parseBuilder1ApiErrorCode(source, source?.message) || null,
    generatedCount: source.generatedCount != null ? Number(source.generatedCount) : null,
    targetAdCount: source.targetAdCount != null ? Number(source.targetAdCount) : null,
    nextAdIndex: source.nextAdIndex != null ? Number(source.nextAdIndex) : null
  }
}

/**
 * @param {object|null|undefined} context
 * @param {object|null|undefined} session
 */
export function validateBuilder1RetryContext(context, session) {
  if (!context?.retryable) {
    return { ok: false, reason: 'not_retryable' }
  }

  const activeCampaignId = String(session?.campaignId ?? '').trim()
  if (!activeCampaignId || context.campaignId !== activeCampaignId) {
    return { ok: false, reason: 'campaign_mismatch' }
  }

  const storedTarget = normalizeBuilder1AdCount(session?.targetAdCount)
  if (context.targetAdCount != null) {
    const payloadTarget = normalizeBuilder1AdCount(context.targetAdCount)
    if (!Number.isFinite(payloadTarget) || payloadTarget !== storedTarget) {
      return { ok: false, reason: 'target_ad_count_mismatch' }
    }
  }

  if (context.generatedCount != null) {
    const generatedCount = context.generatedCount
    if (!Number.isInteger(generatedCount) || generatedCount < 0 || generatedCount > storedTarget) {
      return { ok: false, reason: 'invalid_generated_count' }
    }
    if (generatedCount !== Number(session?.generatedCount)) {
      return { ok: false, reason: 'generated_count_mismatch' }
    }
  }

  const retryAdIndex = context.retryAdIndex
  if (!Number.isInteger(retryAdIndex) || retryAdIndex < 1 || retryAdIndex > storedTarget) {
    return { ok: false, reason: 'invalid_retry_ad_index' }
  }
  if (retryAdIndex !== Number(session?.nextAdIndex)) {
    return { ok: false, reason: 'retry_ad_index_mismatch' }
  }

  return { ok: true }
}

export function getBuilder1RetryModeProgressLabel(retryMode, language = 'he') {
  const mode = String(retryMode ?? '').toLowerCase()
  if (mode === BUILDER1_RETRY_MODE.REVIEW_ONLY) {
    return language === 'en' ? 'Re-verifying the image…' : 'מאמתים מחדש את התמונה…'
  }
  if (mode === BUILDER1_RETRY_MODE.IMAGE_ONLY) {
    return language === 'en' ? 'Regenerating the advertisement…' : 'יוצרים מחדש את המודעה…'
  }
  if (mode === BUILDER1_RETRY_MODE.REPAIR_FROM_PHYSICAL) {
    return language === 'en' ? 'Repairing the advertisement plan…' : 'מתקנים את תוכנית המודעה…'
  }
  return language === 'en' ? 'Retrying…' : 'מנסים שוב…'
}

export function getBuilder1RetryErrorMessage(context, language = 'he') {
  if (
    context?.retryMode === BUILDER1_RETRY_MODE.REPAIR_FROM_PHYSICAL &&
    context?.userMessage
  ) {
    return context.userMessage
  }
  if (isBuilder1ImageComplianceError(context?.error)) {
    return getBuilder1ImageComplianceMessage(context.error, language)
  }
  return getBuilder1ComplianceRetryMismatchMessage(language)
}

/**
 * @param {unknown} body
 * @param {object|null|undefined} session
 * @param {'he'|'en'} [language='he']
 */
export function resolveBuilder1RetryErrorResponse(body, session, language = 'he') {
  const context = parseBuilder1RetryContext(body)
  if (!context) return null

  const validation = validateBuilder1RetryContext(context, session)
  if (!validation.ok) {
    return {
      ok: false,
      preserveCampaign: true,
      retryContext: null,
      message: getBuilder1ComplianceRetryMismatchMessage(language)
    }
  }

  return {
    ok: true,
    preserveCampaign: true,
    retryContext: context,
    message: getBuilder1RetryErrorMessage(context, language)
  }
}

/**
 * @param {{ campaignId: string, expectedNextIndex: number }} input
 */
export function buildBuilder1GenerateNextPayload({ campaignId, expectedNextIndex }) {
  return {
    campaignId: String(campaignId ?? '').trim(),
    expectedNextIndex: Number(expectedNextIndex)
  }
}

/**
 * Canonical repair payload for POST /api/builder1-repair-physical
 * @param {{ campaignId: string, retryAdIndex: number, planRevision?: unknown }} input
 */
export function buildBuilder1RepairPhysicalPayload({ campaignId, retryAdIndex, planRevision }) {
  const payload = {
    campaignId: String(campaignId ?? '').trim(),
    retryAdIndex: Number(retryAdIndex)
  }
  if (planRevision != null) {
    payload.planRevision = planRevision
  }
  return payload
}

/**
 * @deprecated Prefer parseBuilder1RetryContext — kept for legacy compliance tests.
 * @param {unknown} body
 */
export function parseBuilder1ComplianceRetryBody(body) {
  const context = parseBuilder1RetryContext(body)
  if (!context) return null
  return {
    error: context.error,
    campaignId: context.campaignId,
    nextAdIndex: context.retryAdIndex,
    generatedCount: context.generatedCount,
    targetAdCount: context.targetAdCount
  }
}

/**
 * @param {{ error: string, campaignId: string, nextAdIndex: number, generatedCount: number, targetAdCount: number }} payload
 * @param {object|null|undefined} session
 */
export function validateRetryableComplianceError(payload, session) {
  if (!payload) {
    return { ok: false, reason: 'not_compliance' }
  }
  return validateBuilder1RetryContext(
    {
      retryable: true,
      campaignId: payload.campaignId,
      retryMode: BUILDER1_RETRY_MODE.IMAGE_ONLY,
      retryAdIndex: payload.nextAdIndex,
      generatedCount: payload.generatedCount,
      targetAdCount: payload.targetAdCount,
      error: payload.error
    },
    session
  )
}

/**
 * @param {unknown} body
 * @param {object|null|undefined} session
 * @param {'he'|'en'} [language='he']
 * @returns {{ ok: boolean, preserveCampaign: true, message: string }|null}
 */
export function resolveBuilder1ComplianceRetryResponse(body, session, language = 'he') {
  return resolveBuilder1RetryErrorResponse(body, session, language)
}

export function resolveBuilder1GenerationFormError(err, language = 'he') {
  const code = String(err?.code ?? parseBuilder1ApiErrorCode(err?.body, err?.message) ?? '').toLowerCase()
  const lower = String(err?.message ?? '').toLowerCase()
  if (code === BUILDER1_PRODUCT_NAME_GENERATION_FAILED || lower.includes(BUILDER1_PRODUCT_NAME_GENERATION_FAILED)) {
    return { field: 'productName', message: getBuilder1ProductNameGenerationFailedMessage(language) }
  }
  if (code === BUILDER1_MISSING_PRODUCT_DESCRIPTION || lower.includes(BUILDER1_MISSING_PRODUCT_DESCRIPTION)) {
    return { field: 'productDescription', message: getBuilder1ProductDescriptionFieldMessage(language) }
  }
  return null
}

const INITIAL_STAGE_PROGRESS = Object.freeze({
  planning: 8,
  validating_strategy: 12,
  repairing_plan: 18,
  building_prompts: 28,
  generating_ad: 55,
  generating_images: 55,
  assembling_ad: 92,
  assembling_campaign: 92,
  done: 100
})

const NEXT_STAGE_PROGRESS = Object.freeze({
  preparing_ad: 15,
  generating_ad: 55,
  generating_images: 55,
  assembling_ad: 92,
  done: 100
})

const LAYOUT_TEMPLATE_MAP = Object.freeze({
  campaign_default: 'ad-card-layout-campaign_default',
  headline_below_visual: 'ad-card-layout-headline_below_visual',
  headline_above_visual: 'ad-card-layout-headline_above_visual',
  headline_left_visual_right: 'ad-card-layout-headline_left_visual_right',
  visual_left_headline_right: 'ad-card-layout-visual_left_headline_right'
})

const PLACEMENT_MAP = Object.freeze({
  bottom_left: 'bottom_left',
  bottomleft: 'bottom_left',
  'bottom-left': 'bottom_left',
  bottom_right: 'bottom_right',
  bottomright: 'bottom_right',
  'bottom-right': 'bottom_right',
  top_left: 'top_left',
  'top-left': 'top_left',
  top_center: 'top_center',
  'top-center': 'top_center',
  top_right: 'top_right',
  'top-right': 'top_right',
  center: 'center'
})

const HEADLINE_ALIGNMENT_MAP = Object.freeze({
  start: 'start',
  left: 'start',
  end: 'end',
  right: 'end',
  center: 'center'
})

const HEADLINE_TREATMENT_MAP = Object.freeze({
  plain: 'plain',
  bold: 'bold',
  shadow: 'shadow',
  outline: 'outline'
})

const COPY_SAFE_AREA_MAP = Object.freeze({
  standard: 'standard',
  compact: 'compact',
  generous: 'generous'
})

const BACKGROUND_TREATMENT_MAP = Object.freeze({
  none: 'none',
  solid: 'solid',
  gradient: 'gradient',
  vignette: 'vignette',
  soft_vignette: 'vignette'
})

const BORDER_TREATMENT_MAP = Object.freeze({
  none: 'none',
  thin: 'thin',
  rounded: 'rounded',
  frame: 'frame'
})

const RECURRING_DEVICE_MAP = Object.freeze({
  none: 'none',
  corner_accent: 'corner_accent',
  side_band: 'side_band',
  dot_grid: 'dot_grid'
})

const IMAGE_STYLE_MAP = Object.freeze({
  photo: 'photo',
  photographic: 'photo',
  illustration: 'illustration',
  illustrated: 'illustration',
  flat: 'flat',
  minimal: 'minimal'
})

const RECURRING_DEVICE_RULE_MAP = Object.freeze({
  always: 'always',
  first_ad_only: 'first_ad_only',
  all_ads: 'all_ads'
})

const DEFAULT_LAYOUT_CLASS = LAYOUT_TEMPLATE_MAP.campaign_default
const DEFAULT_PLACEMENT = 'bottom_left'
const DEFAULT_COPY_SAFE = 'standard'
const DEFAULT_BACKGROUND = 'none'
const DEFAULT_BORDER = 'none'
const DEFAULT_RECURRING_DEVICE = 'none'
const DEFAULT_HEADLINE_ALIGNMENT = 'start'
const DEFAULT_HEADLINE_TREATMENT = 'plain'

/** Minimal 1×1 PNG for dev mock */
const MOCK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** @param {unknown} raw */
function normalizeEnumKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/** @param {Record<string, string>} map @param {unknown} raw @param {string} fallback */
function mapEnum(map, raw, fallback) {
  const key = normalizeEnumKey(raw)
  return map[key] != null ? map[key] : fallback
}

/** @param {unknown} raw */
function normalizePlacement(raw) {
  const key = normalizeEnumKey(raw)
  return PLACEMENT_MAP[key] || null
}

/** @param {string} label @param {boolean} usedFallback */
function warnPresentationFallback(label, usedFallback) {
  if (!usedFallback) return
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(`[builder1Campaign] buildCampaignPresentation used fallback for ${label}`)
  }
}

/** @param {unknown} raw */
export function normalizeBuilder1FormatForApi(raw) {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/×/g, 'x')
  if (!key) return ''

  const map = {
    '1080x1536': 'portrait',
    '1536x1080': 'landscape',
    '1080x1080': 'square',
    vertical: 'portrait',
    horizontal: 'landscape',
    wide: 'landscape',
    portrait: 'portrait',
    landscape: 'landscape',
    square: 'square',
    '1024x1536': 'portrait',
    '1536x1024': 'landscape',
    '1024x1024': 'square'
  }
  if (map[key] != null) return map[key]

  const m = key.match(/^(\d+)x(\d+)$/)
  if (m) {
    const w = Number(m[1])
    const h = Number(m[2])
    if (w > 0 && h > 0) {
      if (w === h) return 'square'
      if (w < h) return 'portrait'
      return 'landscape'
    }
  }
  return ''
}

/** @param {unknown} value */
export function toBuilder1ImageSrc(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return ''
  }
  const normalized = value.trim()
  if (normalized.startsWith('data:image/')) {
    return normalized
  }
  return `data:image/png;base64,${normalized}`
}

/** @param {string} format */
export function getFormatRatioCss(format) {
  const f = String(format || '').trim().toLowerCase()
  if (f === 'portrait') return '1024 / 1536'
  if (f === 'square') return '1 / 1'
  if (f === 'landscape') return '1536 / 1024'
  return '1024 / 1536'
}

/** @param {unknown} raw */
export function sanitizeHexColor(raw) {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) {
    return null
  }
  const lower = v.toLowerCase()
  if (
    lower.includes('url(') ||
    lower.includes('expression(') ||
    lower.includes('var(') ||
    lower.includes(';')
  ) {
    return null
  }
  return v
}

/**
 * @param {object} campaign
 * @param {object} composition
 */
export function buildCampaignPresentation(campaign, composition) {
  const formatRaw = campaign?.format ?? composition?.format ?? 'portrait'
  const format = normalizeBuilder1FormatForApi(formatRaw) || 'portrait'

  const langRaw = String(campaign?.detectedLanguage ?? 'he').trim().toLowerCase()
  const language = BUILDER1_SUPPORTED_LANGUAGES.has(langRaw) ? langRaw : 'he'
  const direction = language === 'he' ? 'rtl' : 'ltr'

  const brandName = String(campaign?.productNameResolved ?? campaign?.productName ?? '').trim()
  const brandSlogan = String(composition?.brandSlogan ?? campaign?.brandSlogan ?? '').trim()

  const gg =
    composition?.graphicGenerator && typeof composition.graphicGenerator === 'object'
      ? composition.graphicGenerator
      : {}

  let usedFallback = false

  const layoutTemplateRaw = gg.layoutTemplate ?? gg.layout_template
  const layoutTemplateKey = normalizeEnumKey(layoutTemplateRaw)
  const layoutTemplateMapped = LAYOUT_TEMPLATE_MAP[layoutTemplateKey]
  if (layoutTemplateRaw != null && String(layoutTemplateRaw).trim() && !layoutTemplateMapped) {
    usedFallback = true
  }
  const layoutClass = layoutTemplateMapped || DEFAULT_LAYOUT_CLASS

  const headlinePlacementRaw = gg.headlinePlacement ?? gg.headline_placement
  const headlinePlacementNorm = normalizePlacement(headlinePlacementRaw)
  if (headlinePlacementRaw != null && String(headlinePlacementRaw).trim() && !headlinePlacementNorm) {
    usedFallback = true
  }
  const headlinePlacementClass = headlinePlacementNorm
    ? `ad-card-headline-placement-${headlinePlacementNorm}`
    : 'ad-card-headline-placement-top_center'

  const headlineAlignmentRaw = gg.headlineAlignment ?? gg.headline_align
  const headlineAlignmentNorm = mapEnum(
    HEADLINE_ALIGNMENT_MAP,
    headlineAlignmentRaw,
    DEFAULT_HEADLINE_ALIGNMENT
  )
  if (headlineAlignmentRaw != null && String(headlineAlignmentRaw).trim() && !HEADLINE_ALIGNMENT_MAP[normalizeEnumKey(headlineAlignmentRaw)]) {
    usedFallback = true
  }
  const headlineAlignmentClass = `ad-card-headline-align-${headlineAlignmentNorm}`

  const headlineTreatmentRaw = gg.headlineTreatment ?? gg.headline_treatment
  const headlineTreatmentNorm = mapEnum(
    HEADLINE_TREATMENT_MAP,
    headlineTreatmentRaw,
    DEFAULT_HEADLINE_TREATMENT
  )
  if (headlineTreatmentRaw != null && String(headlineTreatmentRaw).trim() && !HEADLINE_TREATMENT_MAP[normalizeEnumKey(headlineTreatmentRaw)]) {
    usedFallback = true
  }
  const headlineTreatmentClass = `ad-card-headline-treatment-${headlineTreatmentNorm}`

  const brandBlockRaw =
    gg.brandBlockPlacement ??
    gg.brand_block_placement ??
    gg.brandPlacement ??
    gg.brand_placement
  const brandPlacementNorm = normalizePlacement(brandBlockRaw) || DEFAULT_PLACEMENT
  if (brandBlockRaw != null && String(brandBlockRaw).trim() && !normalizePlacement(brandBlockRaw)) {
    usedFallback = true
  }
  const brandPlacementClass = `ad-card-brand-placement-${brandPlacementNorm}`

  const sloganPlacementRaw = gg.sloganPlacement ?? gg.slogan_placement
  const sloganPlacementNorm = normalizePlacement(sloganPlacementRaw) || brandPlacementNorm
  if (sloganPlacementRaw != null && String(sloganPlacementRaw).trim() && !normalizePlacement(sloganPlacementRaw)) {
    usedFallback = true
  }
  const sloganPlacementClass = `ad-card-slogan-placement-${sloganPlacementNorm}`

  const copySafeAreaRaw = gg.copySafeArea ?? gg.copy_safe_area
  const copySafeAreaNorm = mapEnum(COPY_SAFE_AREA_MAP, copySafeAreaRaw, DEFAULT_COPY_SAFE)
  if (copySafeAreaRaw != null && String(copySafeAreaRaw).trim() && !COPY_SAFE_AREA_MAP[normalizeEnumKey(copySafeAreaRaw)]) {
    usedFallback = true
  }
  const copySafeAreaClass = `ad-card-copy-safe-${copySafeAreaNorm}`

  const backgroundTreatmentRaw = gg.backgroundTreatment ?? gg.background_treatment
  const backgroundTreatmentNorm = mapEnum(
    BACKGROUND_TREATMENT_MAP,
    backgroundTreatmentRaw,
    DEFAULT_BACKGROUND
  )
  if (
    backgroundTreatmentRaw != null &&
    String(backgroundTreatmentRaw).trim() &&
    !BACKGROUND_TREATMENT_MAP[normalizeEnumKey(backgroundTreatmentRaw)]
  ) {
    usedFallback = true
  }
  const backgroundTreatmentClass = `ad-card-bg-${backgroundTreatmentNorm}`

  const borderTreatmentRaw = gg.borderTreatment ?? gg.border_treatment
  const borderTreatmentNorm = mapEnum(BORDER_TREATMENT_MAP, borderTreatmentRaw, DEFAULT_BORDER)
  if (
    borderTreatmentRaw != null &&
    String(borderTreatmentRaw).trim() &&
    !BORDER_TREATMENT_MAP[normalizeEnumKey(borderTreatmentRaw)]
  ) {
    usedFallback = true
  }
  const borderTreatmentClass = `ad-card-border-${borderTreatmentNorm}`

  const recurringDeviceRaw = gg.recurringGraphicDevice ?? gg.recurring_graphic_device
  const recurringDeviceNorm = mapEnum(
    RECURRING_DEVICE_MAP,
    recurringDeviceRaw,
    DEFAULT_RECURRING_DEVICE
  )
  if (
    recurringDeviceRaw != null &&
    String(recurringDeviceRaw).trim() &&
    !RECURRING_DEVICE_MAP[normalizeEnumKey(recurringDeviceRaw)]
  ) {
    usedFallback = true
  }
  const recurringGraphicDeviceClass = `ad-card-device-${recurringDeviceNorm}`

  const imageStyleRaw = gg.imageStyle ?? gg.image_style
  const imageStyleNorm = mapEnum(IMAGE_STYLE_MAP, imageStyleRaw, 'photo')
  if (imageStyleRaw != null && String(imageStyleRaw).trim() && !IMAGE_STYLE_MAP[normalizeEnumKey(imageStyleRaw)]) {
    usedFallback = true
  }
  const imageStyleClass = `ad-card-image-style-${imageStyleNorm}`

  const deviceRuleRaw = gg.recurringGraphicDeviceRule ?? gg.recurring_graphic_device_rule
  const deviceRuleNorm = mapEnum(RECURRING_DEVICE_RULE_MAP, deviceRuleRaw, 'all_ads')
  if (deviceRuleRaw != null && String(deviceRuleRaw).trim() && !RECURRING_DEVICE_RULE_MAP[normalizeEnumKey(deviceRuleRaw)]) {
    usedFallback = true
  }
  const recurringGraphicDeviceRule = deviceRuleNorm

  const cssVariables = {}
  const palette = gg.palette && typeof gg.palette === 'object' ? gg.palette : {}
  for (const [key, val] of Object.entries(palette)) {
    const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '')
    if (!safeKey) continue
    const color = sanitizeHexColor(val)
    if (color) {
      cssVariables[`--campaign-${safeKey}`] = color
    } else if (val != null && String(val).trim()) {
      usedFallback = true
    }
  }

  const accent = sanitizeHexColor(gg.accentColor ?? gg.accent ?? palette.primary)
  if (accent) {
    cssVariables['--campaign-accent'] = accent
  }

  const headlineColor = sanitizeHexColor(gg.headlineColor ?? gg.headline_color)
  if (headlineColor) {
    cssVariables['--campaign-headline-color'] = headlineColor
  } else if (gg.headlineColor != null || gg.headline_color != null) {
    usedFallback = true
  }

  const headlineMaxWidthPercent = Number(gg.headlineMaxWidthPercent ?? gg.headline_max_width_percent)
  if (Number.isFinite(headlineMaxWidthPercent) && headlineMaxWidthPercent > 0 && headlineMaxWidthPercent <= 100) {
    cssVariables['--campaign-headline-max-width'] = `${headlineMaxWidthPercent}%`
  } else if (gg.headlineMaxWidthPercent != null || gg.headline_max_width_percent != null) {
    usedFallback = true
  }

  if (usedFallback) {
    warnPresentationFallback('graphicGenerator fields', true)
  }

  return {
    format,
    language,
    direction,
    brandName,
    brandSlogan,
    formatRatioCss: getFormatRatioCss(format),
    safeMarginCss: 'clamp(16px, 3vw, 32px)',
    layoutClass,
    headlinePlacementClass,
    headlineAlignmentClass,
    headlineTreatmentClass,
    brandPlacementClass,
    sloganPlacementClass,
    copySafeAreaClass,
    backgroundTreatmentClass,
    borderTreatmentClass,
    recurringGraphicDeviceClass,
    imageStyleClass,
    recurringGraphicDeviceRule,
    cssVariables,
    usedFallback
  }
}

/**
 * @param {Array<{ index?: unknown }>} ads
 */
export function sortAdsByIndex(ads) {
  return [...ads].sort((a, b) => Number(a.index) - Number(b.index))
}

/**
 * @param {unknown} ad
 */
export function normalizeAdFromResponse(ad) {
  if (!ad || typeof ad !== 'object') {
    return { ok: false, error: 'response_contract_invalid', message: 'Invalid ad entry' }
  }

  const idx = Number(ad.index)
  if (!Number.isInteger(idx) || idx < 1) {
    return { ok: false, error: 'response_contract_invalid', message: 'Invalid ad index' }
  }

  const img = ad.imageBase64 ?? ad.image_base64 ?? ad.imageSrc ?? ad.image_src
  if (typeof img !== 'string' || !img.trim()) {
    return { ok: false, error: 'response_contract_invalid', message: `Missing imageBase64 for ad ${idx}` }
  }

  if (ad.headline != null && typeof ad.headline !== 'string') {
    return { ok: false, error: 'response_contract_invalid', message: `Invalid headline for ad ${idx}` }
  }

  const mt = ad.marketingText ?? ad.marketing_text
  if (mt != null && typeof mt !== 'string') {
    return { ok: false, error: 'response_contract_invalid', message: `Invalid marketingText for ad ${idx}` }
  }

  return {
    ok: true,
    ad: {
      index: idx,
      headline: ad.headline == null ? null : String(ad.headline).trim() || null,
      marketingText: String(mt ?? ''),
      imageSrc: toBuilder1ImageSrc(img)
    }
  }
}

/**
 * Extract a single ad from an incremental job result.
 * @param {unknown} result
 */
export function extractSingleAdFromResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, error: 'response_contract_invalid', message: 'Missing result object' }
  }

  if (result.ad && typeof result.ad === 'object') {
    return normalizeAdFromResponse(result.ad)
  }

  if (Array.isArray(result.ads)) {
    if (result.ads.length !== 1) {
      return {
        ok: false,
        error: 'response_contract_invalid',
        message: 'Expected exactly one ad in ads array'
      }
    }
    return normalizeAdFromResponse(result.ads[0])
  }

  return { ok: false, error: 'response_contract_invalid', message: 'Missing ad payload' }
}

/**
 * @param {unknown} result
 * @param {number} requestedAdCount
 */
export function validateInitialCampaignResponse(result, requestedAdCount) {
  if (!result || typeof result !== 'object') {
    return { ok: false, error: 'response_contract_invalid', message: 'Missing result object' }
  }
  if (result.ok !== true) {
    const err = result.error || 'generation_failed'
    return { ok: false, error: err, message: result.message || String(err) }
  }

  const campaignId = String(result.campaignId ?? result.campaign_id ?? '').trim()
  if (!campaignId) {
    return { ok: false, error: 'response_contract_invalid', message: 'Missing campaignId' }
  }

  if (!result.campaign || typeof result.campaign !== 'object') {
    return { ok: false, error: 'response_contract_invalid', message: 'Missing campaign object' }
  }
  if (!result.composition || typeof result.composition !== 'object') {
    return { ok: false, error: 'response_contract_invalid', message: 'Missing composition object' }
  }

  const campaign = result.campaign
  const productNameResolved = String(campaign.productNameResolved ?? '').trim()
  if (!productNameResolved) {
    return { ok: false, error: 'response_contract_invalid', message: 'Missing productNameResolved' }
  }

  const brandSlogan = String(campaign.brandSlogan ?? result.composition.brandSlogan ?? '').trim()
  if (!brandSlogan) {
    return { ok: false, error: 'response_contract_invalid', message: 'Missing brand slogan' }
  }

  const detectedLanguage = String(campaign.detectedLanguage ?? '').trim().toLowerCase()
  if (!BUILDER1_SUPPORTED_LANGUAGES.has(detectedLanguage)) {
    return { ok: false, error: 'response_contract_invalid', message: 'Unsupported detectedLanguage' }
  }

  const format = normalizeBuilder1FormatForApi(campaign.format ?? result.composition.format)
  if (!BUILDER1_SUPPORTED_FORMATS.has(format)) {
    return { ok: false, error: 'response_contract_invalid', message: 'Unsupported format' }
  }

  const targetAdCount = normalizeBuilder1AdCount(requestedAdCount)
  const adCount = Number(campaign.adCount)
  if (!Number.isInteger(adCount) || adCount < 2 || adCount > 4) {
    return { ok: false, error: 'response_contract_invalid', message: 'Invalid campaign.adCount' }
  }
  if (adCount !== targetAdCount) {
    return { ok: false, error: 'response_contract_invalid', message: 'campaign.adCount !== requestedAdCount' }
  }

  const extracted = extractSingleAdFromResult(result)
  if (!extracted.ok) {
    return extracted
  }
  if (extracted.ad.index !== 1) {
    return {
      ok: false,
      error: 'response_contract_invalid',
      message: 'Initial response must contain ad index 1'
    }
  }

  const nextAdIndexRaw = Number(result.nextAdIndex ?? result.next_ad_index ?? 2)
  const nextAdIndex =
    Number.isInteger(nextAdIndexRaw) && nextAdIndexRaw >= 2 && nextAdIndexRaw <= adCount + 1
      ? nextAdIndexRaw
      : 2

  const authoritative = parseAuthoritativeCampaignFieldsFromResult(result)

  return {
    ok: true,
    campaignId,
    campaign: {
      ...campaign,
      productNameResolved,
      brandSlogan,
      detectedLanguage,
      format,
      adCount
    },
    composition: {
      ...result.composition,
      brandSlogan: String(result.composition.brandSlogan ?? brandSlogan).trim(),
      format: normalizeBuilder1FormatForApi(result.composition.format) || format
    },
    ad: extracted.ad,
    ads: [extracted.ad],
    nextAdIndex: authoritative.nextAdIndex ?? nextAdIndex,
    targetAdCount,
    ...authoritative
  }
}

/** Alias for initial incremental validation. */
export const validateCampaignResponse = validateInitialCampaignResponse

/**
 * @param {unknown} result
 * @param {{ campaignId: string, expectedIndex: number }} ctx
 */
export function validateNextAdResponse(result, ctx) {
  if (!result || typeof result !== 'object') {
    return { ok: false, error: 'response_contract_invalid', message: 'Missing result object' }
  }
  if (result.ok !== true) {
    const err = result.error || 'generation_failed'
    return { ok: false, error: err, message: result.message || String(err) }
  }

  const expectedCampaignId = String(ctx?.campaignId ?? '').trim()
  const expectedIndex = Number(ctx?.expectedIndex)
  if (!expectedCampaignId) {
    return { ok: false, error: 'response_contract_invalid', message: 'Missing expected campaignId' }
  }
  if (!Number.isInteger(expectedIndex) || expectedIndex < 2) {
    return { ok: false, error: 'response_contract_invalid', message: 'Invalid expectedIndex' }
  }

  const responseCampaignId = String(result.campaignId ?? result.campaign_id ?? '').trim()
  if (!responseCampaignId) {
    return { ok: false, error: 'response_contract_invalid', message: 'Missing campaignId' }
  }
  if (responseCampaignId !== expectedCampaignId) {
    return {
      ok: false,
      error: 'response_contract_invalid',
      message: 'campaignId mismatch'
    }
  }

  const extracted = extractSingleAdFromResult(result)
  if (!extracted.ok) {
    return extracted
  }
  if (extracted.ad.index !== expectedIndex) {
    return {
      ok: false,
      error: 'response_contract_invalid',
      message: `Expected ad index ${expectedIndex}, received ${extracted.ad.index}`
    }
  }

  const authoritative = parseAuthoritativeCampaignFieldsFromResult(result)

  return {
    ok: true,
    campaignId: responseCampaignId,
    ad: extracted.ad,
    nextAdIndex: authoritative.nextAdIndex,
    ...authoritative
  }
}

/**
 * Read authoritative Backend campaign fields from a terminal result object.
 * Top-level result fields win over nested campaign metadata when present.
 * @param {unknown} result
 */
export function parseAuthoritativeCampaignFieldsFromResult(result) {
  if (!result || typeof result !== 'object') {
    return {
      campaignReady: false,
      deliveryReconstructible: false,
      campaignComplete: false,
      generatedCount: null,
      targetAdCount: null,
      nextAdIndex: null,
      canGenerateNext: null
    }
  }

  const nested =
    result.campaign && typeof result.campaign === 'object' ? result.campaign : null

  const readNullableBool = (camel, snake) => {
    for (const source of [result, nested]) {
      if (!source || typeof source !== 'object') continue
      if (source[camel] === true || source[snake] === true) return true
      if (source[camel] === false || source[snake] === false) return false
    }
    return null
  }

  const readBool = (camel, snake) => readNullableBool(camel, snake) === true

  const readNullableInt = (camel, snake) => {
    for (const source of [result, nested]) {
      if (!source || typeof source !== 'object') continue
      const raw = source[camel] ?? source[snake]
      if (raw == null) continue
      const n = Number(raw)
      if (Number.isInteger(n)) return n
    }
    return null
  }

  const canGenerateNext = readNullableBool('canGenerateNext', 'can_generate_next')
  const nextAdIndexRaw = result.nextAdIndex ?? result.next_ad_index ?? nested?.nextAdIndex ?? nested?.next_ad_index
  let nextAdIndex = null
  if (nextAdIndexRaw != null) {
    const n = Number(nextAdIndexRaw)
    nextAdIndex = Number.isInteger(n) ? n : null
  } else if (canGenerateNext === false) {
    nextAdIndex = null
  }

  return {
    campaignReady: readBool('campaignReady', 'campaign_ready'),
    deliveryReconstructible: readBool('deliveryReconstructible', 'delivery_reconstructible'),
    campaignComplete: readBool('campaignComplete', 'campaign_complete'),
    generatedCount: readNullableInt('generatedCount', 'generated_count'),
    targetAdCount: readNullableInt('targetAdCount', 'target_ad_count'),
    nextAdIndex,
    canGenerateNext,
    campaignReadyExplicit: readNullableBool('campaignReady', 'campaign_ready'),
    deliveryReconstructibleExplicit: readNullableBool(
      'deliveryReconstructible',
      'delivery_reconstructible'
    ),
    campaignCompleteExplicit: readNullableBool('campaignComplete', 'campaign_complete')
  }
}

/**
 * Merge authoritative Backend campaign fields into a session object.
 * Backend TRUE / explicit values win over stale local session values.
 * @param {object} session
 * @param {object} authoritative
 * @param {{ generatedCount?: number, nextAdIndex?: number|null, canGenerateNext?: boolean|null }} [derived]
 */
export function mergeAuthoritativeCampaignSessionFields(session, authoritative, derived = {}) {
  const targetAdCount = normalizeBuilder1AdCount(
    authoritative.targetAdCount ?? session?.targetAdCount ?? 2
  )
  const generatedCount =
    derived.generatedCount ??
    authoritative.generatedCount ??
    session?.generatedCount ??
    0

  let nextAdIndex = session?.nextAdIndex ?? null
  if (authoritative.nextAdIndex !== undefined) {
    nextAdIndex = authoritative.nextAdIndex
  } else if (derived.nextAdIndex !== undefined) {
    nextAdIndex = derived.nextAdIndex
  }

  let canGenerateNext = session?.canGenerateNext ?? false
  if (authoritative.canGenerateNext != null) {
    canGenerateNext = authoritative.canGenerateNext === true
  } else if (derived.canGenerateNext != null) {
    canGenerateNext = derived.canGenerateNext === true
  } else {
    canGenerateNext = generatedCount < targetAdCount
  }

  return {
    campaignReady:
      authoritative.campaignReadyExplicit === true
        ? true
        : authoritative.campaignReadyExplicit === false
          ? false
          : session?.campaignReady === true,
    deliveryReconstructible:
      authoritative.deliveryReconstructibleExplicit === true
        ? true
        : authoritative.deliveryReconstructibleExplicit === false
          ? false
          : session?.deliveryReconstructible === true,
    campaignComplete:
      authoritative.campaignCompleteExplicit === true
        ? true
        : authoritative.campaignCompleteExplicit === false
          ? false
          : session?.campaignComplete === true,
    generatedCount,
    targetAdCount,
    nextAdIndex,
    canGenerateNext
  }
}

/**
 * @param {object} session
 * @param {{ ok: true, campaignId: string, ad: object, nextAdIndex?: number }} validatedNext
 */
export function appendAdToSession(session, validatedNext) {
  if (!session || typeof session !== 'object') {
    return { ok: false, error: 'response_contract_invalid', message: 'Missing session' }
  }
  if (!validatedNext?.ok || !validatedNext.ad) {
    return { ok: false, error: 'response_contract_invalid', message: 'Invalid next-ad payload' }
  }

  const sessionCampaignId = String(session.campaignId ?? '').trim()
  if (!sessionCampaignId || sessionCampaignId !== String(validatedNext.campaignId ?? '').trim()) {
    return { ok: false, error: 'response_contract_invalid', message: 'campaignId mismatch' }
  }

  const existingAds = Array.isArray(session.ads) ? session.ads : []
  if (existingAds.some((ad) => Number(ad.index) === Number(validatedNext.ad.index))) {
    return { ok: false, error: 'response_contract_invalid', message: 'Duplicate ad index' }
  }

  const targetAdCount = normalizeBuilder1AdCount(session.targetAdCount)
  if (validatedNext.ad.index > targetAdCount) {
    return { ok: false, error: 'response_contract_invalid', message: 'Ad index exceeds targetAdCount' }
  }

  const ads = sortAdsByIndex([...existingAds, validatedNext.ad])
  const generatedCount = ads.length
  const authoritative = {
    ...validatedNext,
    generatedCount: validatedNext.generatedCount ?? generatedCount
  }
  const merged = mergeAuthoritativeCampaignSessionFields(session, authoritative, {
    generatedCount,
    nextAdIndex:
      validatedNext.nextAdIndex !== undefined
        ? validatedNext.nextAdIndex
        : generatedCount < normalizeBuilder1AdCount(session.targetAdCount)
          ? validatedNext.ad.index + 1
          : null,
    canGenerateNext:
      validatedNext.canGenerateNext != null
        ? validatedNext.canGenerateNext
        : generatedCount < normalizeBuilder1AdCount(session.targetAdCount)
  })

  return {
    ok: true,
    session: {
      ...session,
      ads,
      ...merged
    }
  }
}

/**
 * @param {{ ok: true, campaignId: string, campaign: object, composition: object, ad: object, nextAdIndex?: number }} validatedInitial
 * @param {number} [targetAdCount]
 */
export function createCampaignSessionFromInitial(validatedInitial, targetAdCount) {
  if (!validatedInitial?.ok) {
    return { ok: false, error: 'response_contract_invalid', message: 'Invalid initial campaign' }
  }

  const count = normalizeBuilder1AdCount(
    targetAdCount ?? validatedInitial.targetAdCount ?? validatedInitial.campaign?.adCount ?? 2
  )

  const nextAdIndex =
    validatedInitial.nextAdIndex != null && Number.isInteger(Number(validatedInitial.nextAdIndex))
      ? Number(validatedInitial.nextAdIndex)
      : 2

  const merged = mergeAuthoritativeCampaignSessionFields(
    {},
    validatedInitial,
    {
      generatedCount: 1,
      nextAdIndex,
      canGenerateNext:
        validatedInitial.canGenerateNext != null
          ? validatedInitial.canGenerateNext
          : count > 1
    }
  )

  return {
    ok: true,
    session: {
      campaignId: validatedInitial.campaignId,
      campaign: validatedInitial.campaign,
      composition: validatedInitial.composition,
      targetAdCount: count,
      ads: [validatedInitial.ad],
      ...merged
    }
  }
}

/**
 * @param {object} pollPayload
 * @param {number} previousProgress
 * @param {'initial'|'next'} [mode='initial']
 * @param {{ adIndex?: number, targetAdCount?: number }} [ctx]
 */
export function computeStageProgress(pollPayload, previousProgress = 0, mode = 'initial', ctx = {}) {
  const stage = String(pollPayload?.stage ?? '').trim().toLowerCase()
  if (stage === 'done' || pollPayload?.status === 'done') return 100

  const stageMap = mode === 'next' ? NEXT_STAGE_PROGRESS : INITIAL_STAGE_PROGRESS
  let next = stageMap[stage]

  if (next == null && stage === 'generating_images') {
    next = stageMap.generating_ad ?? stageMap.generating_images ?? 55
    const total = Number(ctx?.targetAdCount ?? pollPayload?.totalAds)
    const completed = Number(ctx?.adIndex ?? pollPayload?.completedAds)
    if (Number.isInteger(total) && total > 0 && Number.isFinite(completed) && completed >= 0) {
      const clampedCompleted = Math.min(completed, total)
      next = 30 + Math.round((clampedCompleted / total) * 60)
    }
  }

  if (next == null) {
    next = pollPayload?.status === 'running' ? Math.max(previousProgress, 5) : previousProgress
  }

  if (!Number.isFinite(next)) next = previousProgress
  next = Math.max(0, Math.min(100, next))
  if (previousProgress > 0 && next < previousProgress) {
    return previousProgress
  }
  return next
}

/**
 * @param {object} pollPayload
 * @param {'he'|'en'} [language='he']
 * @param {'initial'|'next'} [mode='initial']
 * @param {{ adIndex?: number, targetAdCount?: number }} [ctx]
 */
export function getStageLabel(pollPayload, language = 'he', mode = 'initial', ctx = {}) {
  const stage = String(pollPayload?.stage ?? '').trim().toLowerCase()
  const isHe = language === 'he'
  const adIndex = Number(ctx?.adIndex ?? pollPayload?.adIndex ?? pollPayload?.completedAds ?? 1)
  const targetAdCount = Number(ctx?.targetAdCount ?? pollPayload?.totalAds ?? pollPayload?.targetAdCount ?? 0)

  if (mode === 'next') {
    const n = Number.isInteger(adIndex) && adIndex > 0 ? adIndex : 1
    const total = Number.isInteger(targetAdCount) && targetAdCount > 0 ? targetAdCount : n

    if (stage === 'preparing_ad' || stage === 'building_prompts') {
      return isHe ? `מכין מודעה ${n} מתוך ${total}` : `Preparing ad ${n} of ${total}`
    }
    if (stage === 'generating_ad' || stage === 'generating_images') {
      return isHe ? `יוצר מודעה ${n} מתוך ${total}` : `Generating ad ${n} of ${total}`
    }
    if (stage === 'assembling_ad' || stage === 'assembling_campaign') {
      return isHe ? `מרכיב מודעה ${n} מתוך ${total}` : `Assembling ad ${n} of ${total}`
    }
    if (stage === 'done') {
      return isHe ? `מודעה ${n} מוכנה` : `Ad ${n} ready`
    }
    return isHe ? `יוצר מודעה ${n}…` : `Generating ad ${n}…`
  }

  if (stage === 'planning') {
    return isHe ? 'מתכנן את הקמפיין' : 'Planning the campaign'
  }
  if (stage === 'validating_strategy') {
    return isHe ? 'מאמת את האסטרטגיה' : 'Validating strategy'
  }
  if (stage === 'repairing_plan') {
    return isHe ? 'מדייק את הרעיון היצירתי' : 'Refining the campaign idea'
  }
  if (stage === 'building_prompts') {
    return isHe ? 'מכין את סדרת הוויזואל' : 'Preparing the visual series'
  }
  if (stage === 'generating_ad' || stage === 'generating_images') {
    const total = Number.isInteger(targetAdCount) && targetAdCount > 0 ? targetAdCount : 1
    return isHe ? `יוצר מודעה 1 מתוך ${total}` : `Generating ad 1 of ${total}`
  }
  if (stage === 'assembling_ad' || stage === 'assembling_campaign') {
    return isHe ? 'מרכיב את המודעה' : 'Assembling ad'
  }
  if (stage === 'done') {
    return isHe ? 'הקמפיין מוכן' : 'Campaign ready'
  }
  return isHe ? 'יוצר קמפיין…' : 'Generating campaign…'
}

/**
 * @param {unknown} result
 */
export function parseCampaignReadinessFromResult(result) {
  const fields = parseAuthoritativeCampaignFieldsFromResult(result)
  return {
    campaignReady: fields.campaignReady,
    deliveryReconstructible: fields.deliveryReconstructible
  }
}

/** @param {string} name */
export function sanitizeCampaignZipFilename(name) {
  const base = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80)
  return base ? `${base}-campaign.zip` : 'builder1-campaign.zip'
}

/**
 * @param {object} session
 */
export function buildCampaignServerZipRequest(session) {
  const campaignId = String(session?.campaignId ?? '').trim()
  return {
    scope: 'campaign_server',
    campaignId
  }
}

/**
 * @param {object} input
 * @param {number} [adCount=2]
 */
export function createDevMockInitialCampaign(input, adCount = 2) {
  const count = normalizeBuilder1AdCount(adCount)
  const format = normalizeBuilder1FormatForApi(input?.imageSize) || 'portrait'
  const productName = String(input?.productName ?? '').trim() || 'Demo Product'
  const brandSlogan = 'סלוגן דמו לקמפיין'
  const campaignId = `dev-mock-${Date.now()}`

  const ad = {
    index: 1,
    headline: 'כותרת דמו',
    marketingText: 'Marketing copy for ad 1 in dev mock campaign.',
    imageBase64: MOCK_PNG_BASE64
  }

  const validated = validateInitialCampaignResponse(
    {
      ok: true,
      campaignId,
      campaign: {
        productNameResolved: productName,
        brandSlogan,
        detectedLanguage: 'he',
        format,
        adCount: count
      },
      composition: {
        format,
        brandSlogan,
        graphicGenerator: {
          layoutTemplate: 'campaign_default',
          brandBlockPlacement: 'bottom-left',
          sloganPlacement: 'bottom-left',
          palette: { primary: '#112233', secondary: '#445566' }
        }
      },
      ad,
      nextAdIndex: count > 1 ? 2 : count + 1
    },
    count
  )

  return validated.ok
    ? { ...validated, isDevMock: true }
    : { ok: false, error: validated.error, message: validated.message, isDevMock: true }
}

/**
 * @param {object} session
 * @param {number} expectedIndex
 */
export function createDevMockNextAd(session, expectedIndex) {
  const idx = Number(expectedIndex)
  const campaignId = String(session?.campaignId ?? `dev-mock-${Date.now()}`).trim()

  const ad = {
    index: idx,
    headline: idx === 1 ? 'כותרת דמו' : null,
    marketingText: `Marketing copy for ad ${idx} in dev mock campaign.`,
    imageBase64: MOCK_PNG_BASE64
  }

  const targetAdCount = normalizeBuilder1AdCount(session?.targetAdCount ?? session?.campaign?.adCount ?? 2)
  const nextAdIndex = idx < targetAdCount ? idx + 1 : targetAdCount + 1

  return {
    ok: true,
    campaignId,
    ad,
    nextAdIndex,
    isDevMock: true
  }
}

/**
 * @param {unknown} errOrBody
 * @returns {{ rateLimited: boolean, retryAfterSeconds: number|null, code: string|null, message: string|null }}
 */
export function parseRateLimitError(errOrBody) {
  const body =
    errOrBody && typeof errOrBody === 'object' && errOrBody.body && typeof errOrBody.body === 'object'
      ? errOrBody.body
      : errOrBody

  const status = Number(errOrBody?.status ?? body?.status)
  const codeRaw = body?.code ?? body?.error ?? errOrBody?.code ?? errOrBody?.error
  const code = codeRaw != null ? String(codeRaw).trim().toLowerCase() : null
  const messageRaw = body?.message ?? errOrBody?.message ?? null
  const message = messageRaw != null ? String(messageRaw) : null

  const messageLower = String(message ?? '').toLowerCase()
  const rateLimited =
    status === 429 ||
    code === 'image_rate_limited' ||
    code === 'rate_limited' ||
    messageLower.includes('rate') ||
    messageLower.includes('too many')

  let retryAfterSeconds = null
  const retryRaw =
    body?.retryAfterSeconds ??
    body?.retry_after_seconds ??
    errOrBody?.retryAfterSeconds ??
    errOrBody?.retryAfter
  const retryNum = Number(retryRaw)
  if (Number.isFinite(retryNum) && retryNum >= 0) {
    retryAfterSeconds = Math.ceil(retryNum)
  }

  return {
    rateLimited,
    retryAfterSeconds,
    code,
    message
  }
}

export function toBuilder1ZipImageBase64(imageSrc) {
  if (typeof imageSrc !== 'string' || !imageSrc.trim()) {
    return ''
  }
  const normalized = imageSrc.trim()
  if (normalized.startsWith('data:image/')) {
    return normalized
  }
  return `data:image/png;base64,${normalized}`
}

/** Raw base64 payload for Builder1 ZIP API (no data-URI prefix). */
export function toBuilder1ApiImageBase64(imageSrc) {
  const dataUri = toBuilder1ZipImageBase64(imageSrc)
  if (!dataUri) return ''
  const commaIdx = dataUri.indexOf(',')
  return commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri
}

/** @param {unknown} text */
export function countMarketingWords(text) {
  return String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

/**
 * Development-only warning when marketing copy is not exactly 50 words.
 * @param {unknown} text
 * @param {number} [expected=50]
 */
export function warnMarketingTextWordCountInDev(text, expected = 50) {
  if (typeof import.meta !== 'undefined' && import.meta.env && !import.meta.env.DEV) {
    return
  }
  const count = countMarketingWords(text)
  if (count !== expected) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(
        `[builder1] marketingText word count is ${count}, expected exactly ${expected}`
      )
    }
  }
}

/** @param {number} index */
export function sanitizeSingleAdZipFilename(index) {
  const idx = Number(index)
  if (!Number.isInteger(idx) || idx < 1) {
    return 'ad-01.zip'
  }
  return `ad-${String(idx).padStart(2, '0')}.zip`
}

/**
 * @param {object} session
 * @param {object} ad
 */
export function buildSingleAdZipRequest(session, ad) {
  const campaignId = String(session?.campaignId ?? '').trim()
  const productNameResolved = String(session?.campaign?.productNameResolved ?? '').trim()
  const brandSlogan = String(
    session?.composition?.brandSlogan ?? session?.campaign?.brandSlogan ?? ''
  ).trim()

  return {
    scope: 'single_ad',
    campaignId,
    campaign: {
      productNameResolved,
      brandSlogan
    },
    ad: {
      index: Number(ad?.index),
      headline: ad?.headline == null ? null : String(ad.headline),
      marketingText: String(ad?.marketingText ?? ''),
      imageBase64: toBuilder1ApiImageBase64(ad?.imageSrc ?? '')
    }
  }
}

/**
 * @param {{ productName?: string, productDescription?: string, format: string, adCount: number }} input
 */
export function buildInitialGeneratePayload(input) {
  const { raw } = readRawBuilder1CampaignAdCount()
  const adCount = normalizeBuilder1AdCount(input?.adCount)
  logBuilder1RequestAdCount(raw, adCount)

  const format = normalizeBuilder1FormatForApi(input?.format)
  if (!format) {
    throw new Error('invalid_format')
  }

  return {
    productName: trimBuilder1ProductName(input?.productName),
    productDescription: String(input?.productDescription ?? ''),
    format,
    adCount
  }
}
