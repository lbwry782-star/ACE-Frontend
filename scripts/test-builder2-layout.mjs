/**
 * Builder2 always-visible form and public UI policy tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILDER2_FORM_DRAFT_STORAGE_KEY,
  writeBuilder2FormDraft,
  clearBuilder2FormDraft
} from '../src/utils/builder2FormDraft.js'
import {
  BUILDER2_MSG_GENERIC_FAILURE,
  getBuilder2SafeFailureMessage
} from '../src/utils/builder2Status.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const builder2PageSource = readFileSync(join(root, 'src/pages/Builder2/Builder2Page.jsx'), 'utf8')
const productForm2Source = readFileSync(join(root, 'src/components/Form/ProductForm2.jsx'), 'utf8')
const builder1PageSource = readFileSync(join(root, 'src/pages/Builder/BuilderPage.jsx'), 'utf8')
const apiSource = readFileSync(join(root, 'src/services/api.js'), 'utf8')

class MemoryStorage {
  constructor() {
    this.map = new Map()
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null
  }
  setItem(key, value) {
    this.map.set(key, String(value))
  }
  removeItem(key) {
    this.map.delete(key)
  }
}

const storage = new MemoryStorage()

// 1–6. Form always mounted — no conditional unmount
assert.doesNotMatch(builder2PageSource, /showEmptyForm/)
assert.doesNotMatch(builder2PageSource, /showForm\s*=/)
assert.match(builder2PageSource, /<ProductForm2/)
assert.doesNotMatch(
  builder2PageSource.match(/return\s*\([\s\S]*?<\/div>\s*\)/)?.[0] ?? '',
  /\?\s*\(\s*<ProductForm2/
)
assert.doesNotMatch(productForm2Source, /Builder2ProgressBar/)
assert.match(builder2PageSource, /builder2-progress-section/)
assert.match(builder2PageSource, /builder-results/)

const builder2TitleBlock =
  builder2PageSource.match(/<div className="builder-title-block">[\s\S]*?<\/div>/)?.[0] ?? ''
assert.match(builder2TitleBlock, /יוצר וידאו/)
assert.match(builder2TitleBlock, /אין לרענן את הדף!/)
assert.ok(
  builder2TitleBlock.indexOf('יוצר וידאו') < builder2TitleBlock.indexOf('אין לרענן את הדף!'),
  'refresh warning must appear below the Builder2 title'
)
assert.match(builder2PageSource, /builder2-warning/)

// 7. Form fields start empty; legacy draft is not restored on mount
assert.equal(BUILDER2_FORM_DRAFT_STORAGE_KEY, 'ace.builder2.formDraft.v1')
writeBuilder2FormDraft(
  { productName: 'Ace Shoe', productDescription: 'Comfortable running shoe' },
  storage
)
assert.doesNotMatch(builder2PageSource, /readBuilder2FormDraft/)
assert.doesNotMatch(builder2PageSource, /writeBuilder2FormDraft/)
assert.match(builder2PageSource, /EMPTY_FORM_DATA/)
assert.match(builder2PageSource, /useState\(EMPTY_FORM_DATA\)/)
assert.match(builder2PageSource, /clearBuilder2FormDraft\(\)/)
clearBuilder2FormDraft(storage)

// 8. Active job + cancellation gate cannot duplicate submit
assert.match(builder2PageSource, /readBuilder2CurrentJob\(\)\?\.jobId/)
assert.match(builder2PageSource, /cancellationGate !== 'ready'/)
assert.match(builder2PageSource, /submitDisabled/)

// 9–10. Progress and result are additive sections
assert.match(builder2PageSource, /showProgressBar\s*\?/)
assert.match(builder2PageSource, /completedVideos\.length/)

// 11–13. No still-processing public messaging
assert.doesNotMatch(builder2PageSource, /Still processing/i)
assert.doesNotMatch(builder2PageSource, /still_processing/i)
assert.doesNotMatch(builder2PageSource, /STILL PROCESSING/)
assert.doesNotMatch(builder2PageSource, /BUILDER2_MSG_RESUME_IN_PROGRESS/)
assert.doesNotMatch(builder2PageSource, /POLL_LONG_RUNNING/)

// 14. Resume button absent from public UI
assert.doesNotMatch(builder2PageSource, /builder2-resume-button/)
assert.doesNotMatch(builder2PageSource, /BUILDER2_MSG_RESUME/)
assert.doesNotMatch(productForm2Source, /המשך מאותה נקודה/)

// Backend resume client remains available internally; page uses cancel on refresh
assert.match(apiSource, /resumeBuilder2Job/)
assert.match(apiSource, /cancelBuilder2Job/)
assert.doesNotMatch(builder2PageSource, /resumeBuilder2Job/)
assert.match(builder2PageSource, /cancelBuilder2Job/)

// 15. Internal failure codes mapped to safe message
assert.equal(
  getBuilder2SafeFailureMessage({ failureReason: 'builder2_winner_development_failed' }),
  BUILDER2_MSG_GENERIC_FAILURE
)
assert.equal(
  getBuilder2SafeFailureMessage({ error: 'builder2_creator_invalid_candidate' }),
  BUILDER2_MSG_GENERIC_FAILURE
)
assert.doesNotMatch(
  getBuilder2SafeFailureMessage({ failureReason: 'builder2_judge_invalid_response' }),
  /builder2_/
)

// 16–18. Dismiss / mount reset form to empty fresh state; refresh is reset (no new-video button)
assert.match(builder2PageSource, /resetFreshFormFields/)
assert.match(
  builder2PageSource.match(/handleDismissFailure[\s\S]{0,400}/)?.[0] ?? '',
  /resetFreshFormFields/
)
assert.match(builder2PageSource, /resetFreshGenerationUi/)
assert.doesNotMatch(builder2PageSource, /handleStartNewVideo/)
assert.match(builder2PageSource, /clearBuilder2FormDraft/)

// 19–21. In-session job tracking + polling preserved; refresh cancels instead of restore
assert.match(builder2PageSource, /readBuilder2CurrentJob/)
assert.match(builder2PageSource, /readBuilder2ActiveJob/)
assert.match(builder2PageSource, /pollGenerationRef/)
assert.match(builder2PageSource, /reconcileBuilder2JobTiming/)

// 22. Builder1 unchanged
assert.doesNotMatch(builder1PageSource, /builder2FormDraft|builder2-progress-section/i)

// Fields read-only only while actively processing
assert.match(builder2PageSource, /fieldsReadOnly/)
assert.match(productForm2Source, /fieldsReadOnly/)

console.log('builder2 layout tests passed')
