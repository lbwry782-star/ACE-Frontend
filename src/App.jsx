import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import { createContext, useEffect, useState } from 'react'
import Header from './components/Header/Header'
import Footer from './components/Footer/Footer'
import PreviewPage from './pages/Preview/PreviewPage'
import Preview2Page from './pages/Preview2/Preview2Page'
import UnderConstructionPage from './pages/UnderConstruction/UnderConstructionPage'
import BuilderPage from './pages/Builder/BuilderPage'
import Builder2Page from './pages/Builder2/Builder2Page'
import PaymentReturnPage from './pages/PaymentReturn/PaymentReturnPage'
import DemoPage from './pages/Demo/DemoPage'
import DemoPage2 from './pages/Demo2/DemoPage2'
import {
  getSecurityConfigSnapshot,
  isSecurityEnabled,
  loadSecurityConfig,
  subscribeSecurityConfig
} from './services/securityConfig'
import { buildBuilder1PaymentReturnHash } from './utils/builder1Checkout.js'
import {
  buildBuilder2PaymentReturnHash,
  readActiveBuilder2VideoCheckoutId
} from './utils/builder2VideoCheckout.js'

/** @typedef {import('./services/securityConfig.js').SecurityConfigStatus} SecurityConfigStatus */

export const SecurityConfigContext = createContext({
  status: 'loading',
  securityEnabled: false,
  securityConfigLoaded: false,
  securityConfigError: false,
  error: null
})

function App() {
  const [securityConfig, setSecurityConfig] = useState(() => getSecurityConfigSnapshot())

  useEffect(() => {
    void loadSecurityConfig()
    return subscribeSecurityConfig(setSecurityConfig)
  }, [])

  // Legacy payment return (security OFF only) — secure flow uses #/payment-return
  useEffect(() => {
    if (isSecurityEnabled()) return
    if (securityConfig.status === 'loading') return

    const ssFlag = sessionStorage.getItem('ace_payment_return_pending')
    const lsFlag = localStorage.getItem('ace_payment_return_pending')
    const hash = window.location.hash || ''
    const isAlreadyInBuilder = hash.includes('builder')

    if (!isAlreadyInBuilder && (ssFlag === '1' || lsFlag === '1')) {
      sessionStorage.removeItem('ace_payment_return_pending')
      localStorage.removeItem('ace_payment_return_pending')
      const builder2CheckoutId = readActiveBuilder2VideoCheckoutId(sessionStorage)
      window.location.hash = builder2CheckoutId
        ? buildBuilder2PaymentReturnHash(sessionStorage)
        : buildBuilder1PaymentReturnHash(sessionStorage)
      return
    }

    if (hash.includes('/builder') || hash.includes('fromPayment=1')) {
      return
    }

    let hasSidInUrl = false
    if (window.location.hash && window.location.hash.includes('?')) {
      const hashParts = window.location.hash.split('?')
      const hashQuery = hashParts[1]
      const hashParams = new URLSearchParams(hashQuery)
      if (hashParams.get('sid')) {
        hasSidInUrl = true
        return
      }
    }
    if (window.location.search) {
      const searchParams = new URLSearchParams(window.location.search)
      if (searchParams.get('sid') || searchParams.get('fromPayment') === '1') {
        return
      }
    }

    if (!hasSidInUrl) {
      localStorage.removeItem('sid')
      sessionStorage.removeItem('sid')
      localStorage.removeItem('entitlementSid')
      sessionStorage.removeItem('entitlementSid')
      localStorage.removeItem('paymentSid')
      sessionStorage.removeItem('paymentSid')

      const localStorageKeysToRemove = []
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i)
        if (key && key.toLowerCase().includes('sid')) {
          localStorageKeysToRemove.push(key)
        }
      }
      localStorageKeysToRemove.forEach((key) => localStorage.removeItem(key))

      const sessionStorageKeysToRemove = []
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i)
        if (key && key.toLowerCase().includes('sid')) {
          sessionStorageKeysToRemove.push(key)
        }
      }
      sessionStorageKeysToRemove.forEach((key) => sessionStorage.removeItem(key))
    }
  }, [securityConfig.status])

  const contextValue = {
    status: securityConfig.status,
    securityEnabled: securityConfig.securityEnabled === true,
    securityConfigLoaded: securityConfig.securityConfigLoaded,
    securityConfigError: securityConfig.status === 'error',
    error: securityConfig.error ?? null
  }

  return (
    <SecurityConfigContext.Provider value={contextValue}>
      <Router>
        <div className="app">
          <Header />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<UnderConstructionPage />} />
              <Route path="/preview" element={<PreviewPage />} />
              <Route path="/preview1" element={<PreviewPage />} />
              <Route path="/preview2" element={<Preview2Page />} />
              <Route path="/payment-return" element={<PaymentReturnPage />} />
              <Route path="/builder" element={<BuilderPage />} />
              <Route path="/builder2" element={<Builder2Page />} />
              <Route path="/demo" element={<DemoPage />} />
              <Route path="/demo2" element={<DemoPage2 />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </Router>
    </SecurityConfigContext.Provider>
  )
}

export default App
