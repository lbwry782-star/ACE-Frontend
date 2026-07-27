/**
 * Safe Builder2 form draft persistence (text fields only).
 */

export const BUILDER2_FORM_DRAFT_STORAGE_KEY = 'ace.builder2.formDraft.v1'

/**
 * @typedef {object} Builder2FormDraft
 * @property {string} productName
 * @property {string} productDescription
 * @property {boolean} [isProductNameAuto]
 * @property {string|null} [canonicalResolvedProductName]
 */

/**
 * @param {unknown} raw
 * @returns {Builder2FormDraft|null}
 */
export function parseBuilder2FormDraft(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    productName: String(raw.productName ?? ''),
    productDescription: String(raw.productDescription ?? ''),
    isProductNameAuto: Boolean(raw.isProductNameAuto),
    canonicalResolvedProductName:
      raw.canonicalResolvedProductName != null
        ? String(raw.canonicalResolvedProductName)
        : null
  }
}

/**
 * @param {Storage|null|undefined} storage
 */
export function readBuilder2FormDraft(storage = globalThis.localStorage) {
  if (!storage) return null
  try {
    const raw = storage.getItem(BUILDER2_FORM_DRAFT_STORAGE_KEY)
    if (!raw) return null
    return parseBuilder2FormDraft(JSON.parse(raw))
  } catch (_) {
    return null
  }
}

/**
 * @param {Partial<Builder2FormDraft>} draft
 * @param {Storage|null|undefined} storage
 */
export function writeBuilder2FormDraft(draft, storage = globalThis.localStorage) {
  if (!storage || !draft) return null
  const next = parseBuilder2FormDraft({
    productName: draft.productName ?? '',
    productDescription: draft.productDescription ?? '',
    isProductNameAuto: draft.isProductNameAuto ?? false,
    canonicalResolvedProductName: draft.canonicalResolvedProductName ?? null
  })
  if (!next) return null
  try {
    storage.setItem(BUILDER2_FORM_DRAFT_STORAGE_KEY, JSON.stringify(next))
  } catch (_) {
    return null
  }
  return next
}

/**
 * @param {Storage|null|undefined} storage
 */
export function clearBuilder2FormDraft(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(BUILDER2_FORM_DRAFT_STORAGE_KEY)
  } catch (_) {
    /* ignore */
  }
}
