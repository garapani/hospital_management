import { BadRequestException } from '@nestjs/common';
import { requireParam } from './require-param.js';

describe('requireParam', () => {
  it('returns the value when present', () => {
    expect(requireParam('vendor-123', 'vendorId')).toBe('vendor-123');
  });

  it('throws BadRequestException when undefined', () => {
    expect(() => requireParam(undefined, 'vendorId')).toThrow(BadRequestException);
    expect(() => requireParam(undefined, 'vendorId')).toThrow('vendorId is required');
  });

  it('throws BadRequestException when an empty string', () => {
    expect(() => requireParam('', 'departmentId')).toThrow(BadRequestException);
    expect(() => requireParam('', 'departmentId')).toThrow('departmentId is required');
  });
});
