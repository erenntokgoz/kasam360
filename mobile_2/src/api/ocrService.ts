import apiClient from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OcrScanResult {
  rawText: string;
  amount: number;        // integer — smallest currency unit (kuruş)
  amountDisplay: number; // float — for UI preview before confirming
  date: string | null;   // ISO date string or null if not detected
}

interface OcrScanResponse {
  success: boolean;
  message: string;
  data: OcrScanResult;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Sends a base64-encoded receipt image to the backend OCR endpoint.
 * Returns the extracted total amount (in cents) and date.
 *
 * @param base64Image - Base64-encoded image string (with or without data URI prefix)
 * @returns Parsed receipt data
 * @throws Error with server message on failure
 */
export const scanReceipt = async (base64Image: string): Promise<OcrScanResult> => {
  const { data } = await apiClient.post<OcrScanResponse>('/api/ocr/scan', {
    image: base64Image,
  });
  return data.data;
};
