/**
 * Canonical UI form sync from a hydrated Builder1 campaign session.
 */

import { resolveBuilder1CampaignFormat } from './builder1Campaign.js'

/**
 * @param {unknown} session
 */
export function readBuilder1ProductDescriptionFromSession(session) {
  const campaign = session?.campaign
  if (!campaign || typeof campaign !== 'object') return null
  const raw =
    campaign.productDescription ??
    campaign.product_description ??
    campaign.originalProductDescription ??
    campaign.original_product_description ??
    null
  if (raw == null) return null
  const trimmed = String(raw).trim()
  return trimmed || null
}

/**
 * Derive form field patches from hydrated campaign (does not blank existing values).
 * @param {unknown} session
 * @param {{ productName?: string, productDescription?: string, imageSize?: string }} [existingForm]
 */
export function deriveBuilder1FormSyncFromHydratedSession(session, existingForm = {}) {
  const campaign = session?.campaign ?? {}
  const patch = {}

  const productNameResolved = String(campaign.productNameResolved ?? campaign.productName ?? '').trim()
  if (productNameResolved) {
    patch.productName = productNameResolved
  }

  const format = resolveBuilder1CampaignFormat(session)
  if (format) {
    patch.imageSize = format
  }

  const descriptionFromSession = readBuilder1ProductDescriptionFromSession(session)
  if (descriptionFromSession) {
    patch.productDescription = descriptionFromSession
  }

  return patch
}

/**
 * Merge hydrated campaign values into existing form state without clearing preserved fields.
 * @param {{ productName?: string, productDescription?: string, imageSize?: string }} existingForm
 * @param {unknown} session
 */
export function mergeBuilder1FormWithHydratedSession(existingForm, session) {
  const patch = deriveBuilder1FormSyncFromHydratedSession(session, existingForm)
  const prev = existingForm ?? {}
  return {
    productName: patch.productName ?? prev.productName ?? '',
    productDescription:
      patch.productDescription ??
      (String(prev.productDescription ?? '').trim() ? prev.productDescription : ''),
    imageSize: patch.imageSize ?? prev.imageSize ?? ''
  }
}
