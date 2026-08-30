import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from './create-order.dto.js';

// code-review-findings-2026-08-25 orders P3: itemType was unconstrained free text — a typo
// silently orphaned an unbillable order line (never requisitioned by Lab/Radiology/Pharmacy,
// never billed). Now constrained to the only three values any workflow module recognizes.
describe('CreateOrderDto validation', () => {
  function dtoWith(itemType: string) {
    return plainToInstance(CreateOrderDto, {
      // v4-valid uuid — patientId is now @IsUUID (the §107 sweep), and version-0 fixtures like
      // ...000000000001 fail class-validator's uuid check.
      patientId: '00000000-0000-4000-8000-000000000001',
      items: [{ itemType, itemDescription: 'Something' }],
    });
  }

  it.each(['Lab', 'Radiology', 'Pharmacy'])('accepts itemType %s', async (itemType) => {
    const errors = await validate(dtoWith(itemType));
    expect(errors).toHaveLength(0);
  });

  it('rejects an unrecognized itemType', async () => {
    const errors = await validate(dtoWith('Labb'));
    expect(errors).not.toHaveLength(0);
  });
});
