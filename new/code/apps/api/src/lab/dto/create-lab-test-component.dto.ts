export class CreateLabTestComponentDto {
  name!: string;
  unit?: string;
  referenceRangeLow?: number;
  referenceRangeHigh?: number;
  referenceRangeText?: string;
  displaySequence?: number;
}
