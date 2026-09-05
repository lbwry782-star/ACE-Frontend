/**
 * Server-authoritative offer codes — frontend must not invent prices or counts.
 */

/** @typedef {'builder1'|'builder2'} SecureCheckoutBuilder */

/** Preview1 tier asset keys → offer codes */
export const PREVIEW1_TIER_TO_OFFER_CODE = Object.freeze({
  '1': 'b1-2',
  '2': 'b1-3',
  '5': 'b1-4'
})

/** Preview2 tier asset keys → offer codes */
export const PREVIEW2_TIER_TO_OFFER_CODE = Object.freeze({
  '1': 'b2-1',
  '2': 'b2-2'
})

/** @param {unknown} offerCode */
export function normalizeSecureOfferCode(offerCode) {
  const code = String(offerCode ?? '').trim().toLowerCase()
  if (!code) return ''
  if (['b1-2', 'b1-3', 'b1-4', 'b2-1', 'b2-2'].includes(code)) return code
  return ''
}

/** @param {unknown} offerCode @returns {SecureCheckoutBuilder|null} */
export function offerCodeToBuilder(offerCode) {
  const code = normalizeSecureOfferCode(offerCode)
  if (code.startsWith('b1-')) return 'builder1'
  if (code.startsWith('b2-')) return 'builder2'
  return null
}

/** @param {unknown} builder @returns {'#/builder'| '#/builder2'|null} */
export function builderToRouteHash(builder) {
  const b = String(builder ?? '').trim().toLowerCase()
  if (b === 'builder1') return '#/builder'
  if (b === 'builder2') return '#/builder2'
  return null
}

/** @param {unknown} offerCode @returns {number|null} */
export function expectedQuantityFromOfferCode(offerCode) {
  const map = {
    'b1-2': 2,
    'b1-3': 3,
    'b1-4': 4,
    'b2-1': 1,
    'b2-2': 2
  }
  const code = normalizeSecureOfferCode(offerCode)
  return map[code] ?? null
}
