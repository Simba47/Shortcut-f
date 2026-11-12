// The arithmetic and wording of an invoice: GST split, financial year, invoice number, states.
// Pure (no imports from the app) so it can be tested on its own (invoice.test.ts).

export interface TaxSplit { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number }

/**
 * GST that is already inside the price: `amountPaise` is what the customer paid. Within the state
 * the tax is shared by CGST and SGST (the odd paisa goes to SGST), between states it is all IGST.
 * The parts always add up to the amount paid.
 */
export function splitTax(amountPaise: number, ratePercent: number, intraState: boolean): TaxSplit {
  if (!(ratePercent > 0)) return { taxablePaise: amountPaise, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: amountPaise }
  const taxable = Math.round((amountPaise * 100) / (100 + ratePercent))
  const tax = amountPaise - taxable
  if (!intraState) return { taxablePaise: taxable, cgstPaise: 0, sgstPaise: 0, igstPaise: tax, totalPaise: amountPaise }
  const cgst = Math.floor(tax / 2)
  return { taxablePaise: taxable, cgstPaise: cgst, sgstPaise: tax - cgst, igstPaise: 0, totalPaise: amountPaise }
}

/** The Indian financial year (April to March, by Indian time) a moment falls in, like "2026-27" */
export function fiscalYear(at: Date): string {
  const ist = new Date(at.getTime() + 5.5 * 3600 * 1000)
  const y = ist.getUTCFullYear(), month = ist.getUTCMonth() // 0 = January
  const start = month >= 3 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

export function formatInvoiceNo(fy: string, n: number): string {
  return `SC/${fy}/${String(n).padStart(6, '0')}`
}

/** GST state codes (the first two digits of a GSTIN) */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
}

export function stateName(code: string | null | undefined): string {
  if (!code) return ''
  return GST_STATES[code] ?? code
}

/** A GSTIN in capitals, or null when it is not 15 letters and digits */
export function normalizeGstin(raw: string | null | undefined): string | null {
  const g = (raw ?? '').trim().toUpperCase()
  return /^[0-9]{2}[A-Z0-9]{13}$/.test(g) ? g : null
}

/** 259900 → "2,599.00" (Indian digit grouping) */
export function amountInRupees(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
