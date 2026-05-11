const vision = require('@google-cloud/vision');

/**
 * Google Cloud Vision OCR Controller
 * ──────────────────────────────────────────────────────────────────────────────
 * Receives a base64-encoded receipt image, extracts text via Google Vision,
 * then parses out the highest monetary value (Total) and a date using strict
 * regex patterns.
 *
 * Amount is returned as an integer in the smallest currency unit (cents/kuruş)
 * to maintain consistency with the Transaction model.
 */

// Initialise Vision client — reads GOOGLE_APPLICATION_CREDENTIALS from env
const client = new vision.ImageAnnotatorClient();

// ─── Regex Patterns ──────────────────────────────────────────────────────────

/**
 * Matches monetary values in common receipt formats:
 *   ₺1.234,56  |  $1,234.56  |  1234.56  |  1.234,56  |  1234,56
 * Captures the full numeric string including delimiters.
 */
const MONEY_REGEX =
  /[₺$€£]?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\b|\b(\d+[.,]\d{2})\b/g;

/**
 * Matches dates in common receipt formats:
 *   DD/MM/YYYY  |  DD-MM-YYYY  |  DD.MM.YYYY
 *   YYYY/MM/DD  |  YYYY-MM-DD  |  YYYY.MM.DD
 *   MM/DD/YYYY  (ambiguous — we prefer DD/MM/YYYY for TR locale)
 */
const DATE_REGEX =
  /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b|\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalises a captured monetary string to a float.
 * Turkish receipts use 1.234,56  (dot = thousands, comma = decimal).
 * US/EN receipts use 1,234.56   (comma = thousands, dot = decimal).
 */
const parseMonetaryValue = (raw) => {
  if (!raw) return 0;

  const trimmed = raw.replace(/[₺$€£\s]/g, '');

  // Detect Turkish format:  digits DOT digits COMMA digits
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(trimmed)) {
    return parseFloat(trimmed.replace(/\./g, '').replace(',', '.'));
  }

  // Detect EN format:  digits COMMA digits DOT digits
  if (/^\d{1,3}(,\d{3})+\.\d{2}$/.test(trimmed)) {
    return parseFloat(trimmed.replace(/,/g, ''));
  }

  // Simple: 1234,56  or  1234.56
  return parseFloat(trimmed.replace(',', '.'));
};

/**
 * Normalises a regex date match into an ISO date string.
 * Returns null if date is invalid.
 */
const parseDateMatch = (match) => {
  let day, month, year;

  if (match[4]) {
    // YYYY-MM-DD format
    year = parseInt(match[4], 10);
    month = parseInt(match[5], 10);
    day = parseInt(match[6], 10);
  } else {
    // DD/MM/YYYY format (Turkish locale default)
    day = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
    year = parseInt(match[3], 10);
  }

  // Handle 2-digit years
  if (year < 100) {
    year += year < 50 ? 2000 : 1900;
  }

  // Basic validity check
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
};

// ─── Controller ──────────────────────────────────────────────────────────────

/**
 * @route   POST /api/ocr/scan
 * @access  Private (JWT required)
 * @body    { image: string }  — base64-encoded image (no data URI prefix)
 */
const scanReceipt = async (req, res, next) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ success: false, message: 'Görüntü verisi (base64) gereklidir.' });

    const base64Clean = image.replace(/^data:image\/\w+;base64,/, '');

    const [result] = await client.textDetection({ image: { content: base64Clean } });
    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      return res.status(422).json({
        success: false,
        message: 'Görüntüde metin tespit edilemedi.',
        data: { rawText: null, amount: null, date: null },
      });
    }

    const rawText = detections[0].description;
    let highestAmount = 0;
    let match;

    const moneyRegex = new RegExp(MONEY_REGEX.source, MONEY_REGEX.flags);
    while ((match = moneyRegex.exec(rawText)) !== null) {
      const captured = match[1] || match[2];
      const value = parseMonetaryValue(captured);
      if (value > highestAmount) highestAmount = value;
    }

    const amountCents = Math.round(highestAmount * 100);
    let extractedDate = null;
    const dateRegex = new RegExp(DATE_REGEX.source, DATE_REGEX.flags);

    while ((match = dateRegex.exec(rawText)) !== null) {
      const parsed = parseDateMatch(match);
      if (parsed) { extractedDate = parsed; break; }
    }

    return res.status(200).json({
      success: true,
      message: 'Fiş başarıyla tarandı.',
      data: {
        rawText,
        amount: amountCents,
        amountDisplay: highestAmount,
        date: extractedDate,
      },
    });
  } catch (err) {
    if (err.code) return res.status(502).json({ success: false, message: `Google Vision API hatası: ${err.message}` });
    next(err);
  }
};

module.exports = { scanReceipt };
