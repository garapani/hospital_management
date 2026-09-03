import { IsObject, IsOptional, IsString } from 'class-validator';
import type { DenominationCounts, ModeDeclaredTotals } from '../entities/cashier-shift.entity.js';

export class CloseShiftDto {
  /** e.g. `{ "500": 10, "200": 5, "100": 3 }` — validated against the known denomination set and
   *  non-negative-integer counts in CashierShiftService.closeShift, not here. */
  @IsObject()
  cashDenominationCounts!: DenominationCounts;

  /** e.g. `{ "Card": 5000, "UPI": 8400 }` */
  @IsOptional()
  @IsObject()
  modeDeclaredTotals?: ModeDeclaredTotals;

  @IsOptional()
  @IsString()
  notes?: string;
}
