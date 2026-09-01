import { useState, useMemo } from 'react'
import ProgressBar from '../ProgressBar/ProgressBar'
import Builder1ProgressBar from '../ProgressBar/Builder1ProgressBar'
import { getAgentDisplayName } from '../../utils/agentDisplayName'
import './form.css'

/** First strong letter: Hebrew → rtl, Latin → ltr; empty or only weak chars → null (neutral). */
function detectFieldTextDirection(text) {
  const s = String(text ?? '')
  if (!s.trim()) return null
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0x0590 && c <= 0x05ff) return 'rtl'
    if (c >= 0xfb1d && c <= 0xfb4f) return 'rtl'
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return 'ltr'
  }
  return null
}

function ProductForm({
  formData,
  setFormData,
  onSubmit,
  fieldsLocked,
  buttonText,
  buttonDisabled,
  showSubmitButton = true,
  showProgress,
  progressActive,
  progressKey,
  progressPercent = null,
  stageLabel = '',
  progressMode = 'default',
  progressEstimatedDurationMs = 600000,
  progressOperationType,
  progressLanguage = 'he',
  progressJobStartMs = null,
  progressTaskSucceeded = false,
  progressTaskFailed = false,
  onProgressRevealReady,
  onProgressComplete,
  isProductNameAuto,
  onProductNameEdited,
  externalProductNameError = null,
  externalProductDescriptionError = null,
  onProductDescriptionEdited,
  skipSubmitValidation = false
}) {
  const [errors, setErrors] = useState({})

  const nameDir = useMemo(() => detectFieldTextDirection(formData.productName), [formData.productName])
  const descriptionDir = useMemo(() => detectFieldTextDirection(formData.productDescription), [formData.productDescription])

  const handleChange = (field, value) => {
    if (field === 'productName') {
      console.log('PRODUCT_NAME_SET_SOURCE=user_input value="' + String(value).replace(/"/g, '\\"') + '"')
      if (onProductNameEdited) onProductNameEdited()
    }
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }))
    }
  }

  const handleDescriptionChange = (value) => {
    if (onProductDescriptionEdited) onProductDescriptionEdited()
    setFormData(prev => ({ ...prev, productDescription: value }))
    if (errors.productDescription) {
      setErrors(prev => ({ ...prev, productDescription: null }))
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (skipSubmitValidation) {
      setErrors({})
      onSubmit(formData)
      return
    }
    const newErrors = {}
    if (!formData.productDescription.trim()) {
      newErrors.productDescription = 'Product description is required'
    }
    if (!formData.imageSize) {
      newErrors.imageSize = 'Image size is required'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }
    setErrors({})
    onSubmit(formData)
  }

  const isDisabled = fieldsLocked || buttonDisabled

  const nameInputStyle = {
    ...(isProductNameAuto
      ? {
          fontWeight: '700',
          letterSpacing: '0.02em',
          color: '#ffffff'
        }
      : {}),
    ...(nameDir === 'rtl' ? { textAlign: 'right' } : nameDir === 'ltr' ? { textAlign: 'left' } : {})
  }

  const descriptionInputStyle = {
    ...(descriptionDir === 'rtl' ? { textAlign: 'right' } : descriptionDir === 'ltr' ? { textAlign: 'left' } : {})
  }

  return (
    <form className="product-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="productName" className="product-form1-bilingual-label">
          <span className="product-form1-label-en">
            Product Name (leave blank and {getAgentDisplayName('en')} will create one for you)
          </span>
          <span className="product-form1-label-he" dir="rtl">
            שם המוצר (אפשר להשאיר ריק ו-{getAgentDisplayName('he')} ייצור שם עבורך)
          </span>
        </label>
        <input
          type="text"
          id="productName"
          className="ace-product-text-input"
          value={formData.productName}
          onChange={(e) => handleChange('productName', e.target.value)}
          disabled={isDisabled}
          placeholder="Enter product name"
          dir={nameDir || undefined}
          style={nameInputStyle}
        />
        {(errors.productName || externalProductNameError) && (
          <span className="error-message">{errors.productName || externalProductNameError}</span>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="productDescription" className="product-form1-bilingual-label">
          <span className="product-form1-label-en">Product Description *</span>
          <span className="product-form1-label-he" dir="rtl">תיאור המוצר *</span>
        </label>
        <textarea
          id="productDescription"
          className="ace-product-text-input"
          value={formData.productDescription}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          disabled={isDisabled}
          rows="6"
          placeholder="Enter detailed product description"
          dir={descriptionDir || undefined}
          style={descriptionInputStyle}
        />
        {(errors.productDescription || externalProductDescriptionError) && (
          <span className="error-message">
            {errors.productDescription || externalProductDescriptionError}
          </span>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="imageSize" className="product-form1-bilingual-label">
          <span className="product-form1-label-en">Size *</span>
          <span className="product-form1-label-he" dir="rtl">גודל *</span>
        </label>
        <select
          id="imageSize"
          value={formData.imageSize}
          onChange={(e) => handleChange('imageSize', e.target.value)}
          disabled={isDisabled}
        >
          <option value="">Select / בחר</option>
          <option value="portrait">אורכי / Portrait / 1080×1536</option>
          <option value="landscape">רוחבי / Landscape / 1536×1080</option>
          <option value="square">ריבועי / Square / 1080×1080</option>
        </select>
        {errors.imageSize && (
          <span className="error-message">{errors.imageSize}</span>
        )}
      </div>

      <div className={`form-actions${progressMode === 'builder1' ? ' form-actions--builder1' : ''}`}>
        {showSubmitButton ? (
          <button
            type="submit"
            className="submit-button"
            disabled={buttonDisabled}
          >
            {buttonText}
          </button>
        ) : null}
        {showProgress && progressMode !== 'builder1' ? (
          <ProgressBar
            key={progressKey}
            progressKey={progressKey}
            isActive={progressActive}
            progressPercent={progressPercent}
            stageLabel={stageLabel}
            onComplete={onProgressComplete}
          />
        ) : null}
      </div>
      {showProgress && progressMode === 'builder1' ? (
        <Builder1ProgressBar
          key={progressKey}
          progressKey={progressKey}
          visible={progressActive}
          estimatedDurationMs={progressEstimatedDurationMs}
          progressOperationType={progressOperationType}
          progressLanguage={progressLanguage}
          jobStartTimeMs={progressJobStartMs}
          stageLabel={stageLabel}
          taskSucceeded={progressTaskSucceeded}
          taskFailed={progressTaskFailed}
          onRevealReady={onProgressRevealReady}
        />
      ) : null}
    </form>
  )
}

export default ProductForm
