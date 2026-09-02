/**
 * Preview2 two-offer layout and payment mapping tests.
 * Run: npm run test:builder2
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const preview2Source = readFileSync(join(root, 'src/pages/Preview2/Preview2Page.jsx'), 'utf8')
const preview2Css = readFileSync(join(root, 'src/pages/Preview2/Preview2Page.css'), 'utf8')
const preview1Source = readFileSync(join(root, 'src/pages/Preview/PreviewPage.jsx'), 'utf8')
const pkg = readFileSync(join(root, 'package.json'), 'utf8')

const PAYMENT_URL_2 =
  'https://app.icount.co.il/m/0a7c0/c6937615p17u6a98a23?utm_source=iCount&utm_medium=paypage&utm_campaign=23'
const PAYMENT_URL_1 =
  'https://app.icount.co.il/m/8ca25/c6937615p12u6a98a2e?utm_source=iCount&utm_medium=paypage&utm_campaign=18'

// 1–3. 8.png tier removed; exactly two offers remain
assert.doesNotMatch(preview2Source, /8\.png/)
assert.doesNotMatch(preview2Source, /Hover8\.png/)
assert.doesNotMatch(preview2Source, /4 סרטונים ב-120/)
assert.doesNotMatch(preview2Source, /3 סרטונים ב-100/)
assert.doesNotMatch(preview2Source, /c87e3/)
const assetBlocks = preview2Source.match(/defaultSrc:/g) ?? []
assert.equal(assetBlocks.length, 2)

// 4–7. 6.png = 2-video offer
assert.match(preview2Source, /defaultSrc: `\$\{BASE_URL\}assets\/6\.png`/)
assert.match(preview2Source, /hoverSrc: `\$\{BASE_URL\}assets\/Hover6\.png`/)
assert.match(preview2Source, /● 2 סרטונים ב-140 ש"ח/)
assert.match(preview2Source, /● טקסט שיווקי בן 50 מילים לכל סרטון/)
assert.match(preview2Source, /● אפשרות השוואה ובחירה בין שני סרטונים/)
assert.match(preview2Source, new RegExp(`'2': '${PAYMENT_URL_2.replace(/\?/g, '\\?')}'`))
assert.match(preview2Source, /videoCount: 2/)

// 8–11. 7.png = 1-video offer
assert.match(preview2Source, /defaultSrc: `\$\{BASE_URL\}assets\/7\.png`/)
assert.match(preview2Source, /hoverSrc: `\$\{BASE_URL\}assets\/Hover7\.png`/)
assert.match(preview2Source, /● סרטון אחד ב-80 ש"ח/)
assert.match(preview2Source, /● טקסט שיווקי בן 50 מילים/)
assert.match(preview2Source, new RegExp(`'1': '${PAYMENT_URL_1.replace(/\?/g, '\\?')}'`))
assert.match(preview2Source, /videoCount: 1/)

// 12. centered two-option layout modifier
assert.match(preview2Source, /preview-asset-row--preview2-two/)
assert.match(preview2Css, /preview-asset-row--preview2-two/)
assert.match(preview2Css, /justify-content:\s*center/)
assert.doesNotMatch(preview2Css, /grid-template-columns:\s*repeat\(3/)

// 13. Preview1 unchanged
assert.match(preview1Source, /PREVIEW1_ASSETS/)
assert.match(preview1Source, /assets\/5\.png/)
assert.doesNotMatch(preview1Source, /140 ש"ח/)

assert.match(pkg, /test-preview2-offers\.mjs/)

console.log('test-preview2-offers.mjs: Preview2 two-offer regression passed')
