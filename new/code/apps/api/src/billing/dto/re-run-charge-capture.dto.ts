export class ReRunChargeCaptureDto {
  /** The completed order item whose charge was skipped or failed and should be re-attempted. */
  orderItemId!: string;
}
