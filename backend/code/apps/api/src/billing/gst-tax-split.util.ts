import { roundMoney } from './money.util.js';

export interface GstTaxSplit {
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
}

/**
 * Allocates a line's computed tax across the three GST ledger buckets. India GST law splits tax
 * 50/50 into CGST+SGST for an intra-state supply, or charges it entirely as IGST (no CGST/SGST)
 * for an inter-state one — same total rate either way, `isInterState` only changes which bucket(s)
 * receive it. `lineTax` is the already-computed tax amount (lineTaxable * taxPercent / 100); this
 * function only splits it, it doesn't compute the rate.
 */
export function splitGstTax(lineTax: number, isInterState: boolean): GstTaxSplit {
  if (isInterState) {
    return { cgstAmount: 0, sgstAmount: 0, igstAmount: roundMoney(lineTax) };
  }
  const cgstAmount = roundMoney(lineTax / 2);
  return { cgstAmount, sgstAmount: roundMoney(lineTax - cgstAmount), igstAmount: 0 };
}
