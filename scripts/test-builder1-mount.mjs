/**
 * Builder1 mount smoke — proves BuilderPage mounts without ReferenceError.
 * Uses happy-dom + Vite SSR module load + react-dom/client (no RTL/Jest).
 * Run: npm run test:builder1
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const builderPagePath = join(root, 'src/pages/Builder/BuilderPage.jsx')

function installHappyDom() {
  const window = new Window({
    url: 'http://localhost/#/builder',
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true
    }
  })

  globalThis.window = window
  globalThis.document = window.document
  globalThis.localStorage = window.localStorage
  globalThis.sessionStorage = window.sessionStorage
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
  globalThis.performance = window.performance
  globalThis.HTMLElement = window.HTMLElement
  globalThis.Node = window.Node
  globalThis.Element = window.Element

  const container = window.document.createElement('div')
  container.id = 'root'
  window.document.body.appendChild(container)

  return { window, container }
}

// --- Static regression: no orphaned campaign ZIP state ---
const builderPageSource = readFileSync(builderPagePath, 'utf8')
assert.doesNotMatch(builderPageSource, /\bcampaignZipState\b/)
assert.doesNotMatch(builderPageSource, /\bsetCampaignZipState\b/)
assert.doesNotMatch(builderPageSource, /BUILDER1_MSG_CAMPAIGN_COMPLETE/)
assert.doesNotMatch(builderPageSource, /handleDownloadCampaignZip/)
assert.match(builderPageSource, /resetFreshBuilder1Ui/)
assert.match(builderPageSource, /handleDownloadAdZip/)

const resetFreshBlock =
  builderPageSource.match(
    /const resetFreshBuilder1Ui = useCallback\(\(\) => \{[\s\S]*?\}, \[clearProgressJobTiming\]\)/
  )?.[0] ?? ''
assert.ok(resetFreshBlock.length > 0, 'resetFreshBuilder1Ui block not found')
assert.doesNotMatch(resetFreshBlock, /setCampaignZipState/)

// --- Runtime mount smoke ---
const paidEndpoints = [
  '/api/builder1-generate',
  '/api/builder1-generate-next',
  '/api/builder1-repair-physical',
  '/api/builder1-retry-image'
]
const fetchLog = []

globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  fetchLog.push({ url, method: init.method ?? 'GET' })
  for (const path of paidEndpoints) {
    if (url.includes(path)) {
      throw new Error(`Unexpected paid Builder1 call during mount: ${url}`)
    }
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, status: 'cancelled' }),
    text: async () => '{}'
  }
}

const { window, container } = installHappyDom()

const server = await createServer({
  root,
  plugins: [react()],
  server: { middlewareMode: true },
  logLevel: 'error',
  ssr: {
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime']
  }
})

try {
  const { default: BuilderPage } = await server.ssrLoadModule('/src/pages/Builder/BuilderPage.jsx')
  const { SecurityConfigContext } = await server.ssrLoadModule('/src/App.jsx')

  const reactRoot = createRoot(container)

  let mountError = null
  try {
    reactRoot.render(
      React.createElement(
        SecurityConfigContext.Provider,
        { value: { securityEnabled: false, securityConfigLoaded: true } },
        React.createElement(HashRouter, null, React.createElement(BuilderPage))
      )
    )
    await window.happyDOM.waitUntilComplete()
    await new Promise((resolve) => setTimeout(resolve, 50))
  } catch (err) {
    mountError = err
  }

  assert.equal(mountError, null, mountError?.stack ?? 'mount threw')

  const pageText = container.textContent || ''
  assert.match(pageText, /יוצר מודעות/, 'Builder1 title not rendered')
  assert.ok(
    pageText.includes('GENERATE') || container.querySelector('form') != null,
    'Builder1 initial form surface not renderable'
  )

  for (const call of fetchLog) {
    for (const path of paidEndpoints) {
      assert.ok(!call.url.includes(path), `paid endpoint called on mount: ${call.url}`)
    }
  }

  reactRoot.unmount()
} finally {
  await server.close()
  window.happyDOM.close()
}

console.log('test-builder1-mount.mjs: static + runtime mount smoke passed')
