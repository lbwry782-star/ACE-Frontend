import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import { createContext, useEffect, useState } from 'react'
import Header from './components/Header/Header'
import Footer from './components/Footer/Footer'
import PreviewPage from './pages/Preview/PreviewPage'
import Preview2Page from './pages/Preview2/Preview2Page'
import UnderConstructionPage from './pages/UnderConstruction/UnderConstructionPage'
import BuilderPage from './pages/Builder/BuilderPage'
import Builder2Page from './pages/Builder2/Builder2Page'
import DemoPage from './pages/Demo/DemoPage'
import DemoPage2 from './pages/Demo2/DemoPage2'
import { fetchSecurityConfig } from './services/api'
import { buildBuilder1PaymentReturnHash } from './utils/builder1Checkout.js'
import {
  buildBuilder2PaymentReturnHash,
  readActiveBuilder2VideoCheckoutId
} from './utils/builder2VideoCheckout.js'

// Backend security config; default true (secure) until fetched. Consumed by App and BuilderPage.
export const SecurityConfigContext = createContext({
  securityEnabled: true,
  securityConfigLoaded: false
})

function App() {
  const [securityConfig, setSecurityConfig] = useState({
    securityEnabled: true,
    securityConfigLoaded: false
  })

  // Fetch backend security config once at app startup
  useEffect(() => {
    console.log('[SECURITY_CONFIG_TRACE] initial', {
      securityEnabled: true,
      securityConfigLoaded: false
    })
    console.log('[SECURITY_CONFIG_TRACE] fetch start')
    fetchSecurityConfig()
      .then((config) => {
        console.log('[SECURITY_CONFIG_TRACE] resolved payload', config)
        setSecurityConfig({
          securityEnabled: config.securityEnabled,
          securityConfigLoaded: true
        })
      })
      .catch(() => {
        console.log('[SECURITY_CONFIG_TRACE] fetch rejected — fallback secure true')
        setSecurityConfig({
          securityEnabled: true,
          securityConfigLoaded: true
        })
      })
  }, [])

  // Clean sid-related data on app initialization - ONLY if security enabled and no sid in URL
  useEffect(() => {
    if (!securityConfig.securityEnabled) return
    const ssFlag = sessionStorage.getItem('ace_payment_return_pending')
    const lsFlag = localStorage.getItem('ace_payment_return_pending')
    // Detect lawful return from iCount: not already in Builder + payment flag present (handles hash/query variations)
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
    // Do not clean when already on Builder or URL has lawful marker (e.g. second run after we set hash, or Strict Mode remount)
    if (hash.includes('/builder') || hash.includes('fromPayment=1')) {
      return
    }
    // First, check if there's a sid or fromPayment in URL (first-time entry after payment)
    let hasSidInUrl = false
    if (window.location.hash && window.location.hash.includes('?')) {
      const hashParts = window.location.hash.split('?')
      const hashQuery = hashParts[1]
      const hashParams = new URLSearchParams(hashQuery)
      if (hashParams.get('sid')) {
        hasSidInUrl = true
        // This is first-time entry after payment - don't clean storage yet
        // BuilderPage will handle saving sid to runtime and cleaning URL
        return
      }
    }
    // Payment redirect may put params in search only (?fromPayment=1#/builder) — don't clean yet
    if (window.location.search) {
      const searchParams = new URLSearchParams(window.location.search)
      if (searchParams.get('sid') || searchParams.get('fromPayment') === '1') {
        return
      }
    }

    // Only clean storage if there's NO sid in URL (REFRESH / TAB / INCOGNITO scenario)
    if (!hasSidInUrl) {
      // Remove sid from all persistent storage
      localStorage.removeItem('sid')
      sessionStorage.removeItem('sid')
      
      // Remove any related keys that might exist
      localStorage.removeItem('entitlementSid')
      sessionStorage.removeItem('entitlementSid')
      localStorage.removeItem('paymentSid')
      sessionStorage.removeItem('paymentSid')
      
      // Clean any other potential sid-related keys from localStorage
      const localStorageKeysToRemove = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.toLowerCase().includes('sid')) {
          localStorageKeysToRemove.push(key)
        }
      }
      localStorageKeysToRemove.forEach(key => localStorage.removeItem(key))
      
      // Clean any other potential sid-related keys from sessionStorage
      const sessionStorageKeysToRemove = []
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)
        if (key && key.toLowerCase().includes('sid')) {
          sessionStorageKeysToRemove.push(key)
        }
      }
      sessionStorageKeysToRemove.forEach(key => sessionStorage.removeItem(key))
    }
  }, [securityConfig.securityEnabled])

  // PREVIEW ROUTE NOTE:
  // The Preview page was moved from "/" to "/preview".
  // Root "/" is reserved for the Under Construction page.
  // To restore the original flow later:
  // 1. change "/" back to Preview
  // 2. remove "/preview" if no longer needed
  // 3. update redirects if needed

  return (
    <SecurityConfigContext.Provider value={securityConfig}>
    <Router>
      <div className="app">
        <Header />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<UnderConstructionPage />} />
            <Route path="/preview" element={<PreviewPage />} />
            <Route path="/preview1" element={<PreviewPage />} />
            <Route path="/preview2" element={<Preview2Page />} />
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

