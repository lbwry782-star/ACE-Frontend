import { useState } from 'react'
import Builder2ProgressBar from '../ProgressBar/Builder2ProgressBar'
import { getAgentDisplayName } from '../../utils/agentDisplayName'
import './form.css'

/** Hebrew letters (Unicode BMP). Empty → LTR until user types. */
const HEBREW_LETTERS_RE = /[\u0590-\u05FF]/

function detectInputDirection(value) {
  const s = value == null ? '' : String(value)
  if (!s.trim()) return 'ltr'
  return HEBREW_LETTERS_RE.test(s) ? 'rtl' : 'ltr'
}

/** Builder2: same as ProductForm but without image/video size (fixed server-side). */
function ProductForm2({
  formData,
  setFormData,
  onSubmit,
  fieldsLocked,
  buttonText,
  buttonDisabled,
  showProgress,
  progressActive,
  progressKey,
  progressTiming,
  progressStageLabel = '',
  progressTaskSucceeded,
  progressTaskFailed,
  onProgressRevealReady,
  isProductNameAuto,
  boldResolvedProductName,
  onProductNameEdited
}) {
  const [errors, setErrors] = useState({})

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

  const handleSubmit = (e) => {
    e.preventDefault()
    const newErrors = {}
    if (!formData.productDescription.trim()) {
      newErrors.productDescription = 'Product description is required'
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }
    setErrors({})
    onSubmit(formData)
  }

  const isDisabled = fieldsLocked || buttonDisabled
  /* Bold area driven by canonical string from parent — avoids isProductNameAuto / effect races */
  const showBoldResolvedFieldArea = !!(boldResolvedProductName && String(boldResolvedProductName).trim())

  const productNameDir = showBoldResolvedFieldArea
    ? detectInputDirection(boldResolvedProductName)
    : detectInputDirection(formData.productName)
  const productDescriptionDir = detectInputDirection(formData.productDescription)

  const nameAlign = productNameDir === 'rtl' ? 'right' : 'left'
  const descAlign = productDescriptionDir === 'rtl' ? 'right' : 'left'

  return (
    <form className="product-form product-form-b2" onSubmit={handleSubmit}>
      <div className="form-group">
        <label className="product-form2-bilingual-label" htmlFor="productName-b2">
          <span className="product-form2-label-en">
            Product Name (leave blank and {getAgentDisplayName('en')} will create one for you)
          </span>
          <span className="product-form2-label-he" dir="rtl">
            שם המוצר (ניתן להשאיר ריק — {getAgentDisplayName('he')} ייצור בשבילך)
          </span>
        </label>
        {showBoldResolvedFieldArea ? (
          <div
            id="productName-b2"
            className="product-form-name-resolved-display ace-product-text-input"
            dir={productNameDir}
            aria-live="polite"
            aria-readonly="true"
            style={{
              fontWeight: 800,
              color: '#ffffff',
              fontSize: '18px',
              textAlign: nameAlign
            }}
          >
            {boldResolvedProductName}
          </div>
        ) : (
          <input
            type="text"
            id="productName-b2"
            className="ace-product-text-input"
            value={formData.productName}
            onChange={(e) => handleChange('productName', e.target.value)}
            disabled={isDisabled}
            placeholder="Enter product name"
            dir={productNameDir}
            style={{ textAlign: nameAlign }}
          />
        )}
        {errors.productName && (
          <span className="error-message">{errors.productName}</span>
        )}
      </div>

      <div className="form-group">
        <label className="product-form2-bilingual-label" htmlFor="productDescription-b2">
          <span className="product-form2-label-en">Product Description *</span>
          <span className="product-form2-label-he" dir="rtl">
            תיאור המוצר *
          </span>
        </label>
        <textarea
          id="productDescription-b2"
          className="ace-product-text-input"
          value={formData.productDescription}
          onChange={(e) => handleChange('productDescription', e.target.value)}
          disabled={isDisabled}
          rows="6"
          placeholder="Enter detailed product description"
          dir={productDescriptionDir}
          style={{ textAlign: descAlign }}
        />
        {errors.productDescription && (
          <span className="error-message">{errors.productDescription}</span>
        )}
      </div>

      <div className="form-actions form-actions--builder2">
        <button
          type="submit"
          className="submit-button"
          disabled={buttonDisabled}
        >
          {buttonText}
        </button>
      </div>
      {showProgress && !progressTaskFailed ? (
        <Builder2ProgressBar
          key={progressKey}
          progressKey={progressKey}
          visible={progressActive}
          progressTiming={progressTiming}
          progressStageLabel={progressStageLabel}
          taskSucceeded={progressTaskSucceeded}
          taskFailed={progressTaskFailed}
          onRevealReady={onProgressRevealReady}
        />
      ) : null}
    </form>
  )
}

export default ProductForm2
