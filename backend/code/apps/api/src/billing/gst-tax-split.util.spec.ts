import { splitGstTax } from './gst-tax-split.util.js';

describe('splitGstTax', () => {
  it('charges the full tax as IGST, with CGST and SGST both zero, when inter-state', () => {
    expect(splitGstTax(180, true)).toEqual({ cgstAmount: 0, sgstAmount: 0, igstAmount: 180 });
  });

  it('splits the tax 50/50 into CGST and SGST, with IGST zero, when intra-state', () => {
    expect(splitGstTax(180, false)).toEqual({ cgstAmount: 90, sgstAmount: 90, igstAmount: 0 });
  });

  it('returns all zeros for zero tax, either way', () => {
    expect(splitGstTax(0, true)).toEqual({ cgstAmount: 0, sgstAmount: 0, igstAmount: 0 });
    expect(splitGstTax(0, false)).toEqual({ cgstAmount: 0, sgstAmount: 0, igstAmount: 0 });
  });

  it('never lets CGST+SGST drift from the tax total on an odd-paise amount', () => {
    // splitGstTax is always called with a lineTax that's already been through roundMoney at the
    // call site (postChargeCapture/create() both round before splitting) — a 2-decimal input, not
    // an arbitrary float. cgstAmount rounds first, sgstAmount takes the residual, so the two always
    // sum back to exactly the input, never off by a paisa from rounding each side independently.
    const { cgstAmount, sgstAmount } = splitGstTax(90.35, false);
    expect(cgstAmount + sgstAmount).toBe(90.35);
  });

  it('the IGST amount on an inter-state line equals the CGST+SGST total a same-value intra-state line would carry', () => {
    const interState = splitGstTax(90.35, true);
    const intraState = splitGstTax(90.35, false);
    expect(interState.igstAmount).toBe(intraState.cgstAmount + intraState.sgstAmount);
  });
});
