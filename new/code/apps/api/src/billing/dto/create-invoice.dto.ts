export class CreateInvoiceItemDto {
  description!: string;
  hsnSacCode?: string;
  quantity?: number;
  unitPrice!: number;
  discountAmount?: number;
  taxPercent?: number;
  sourceOrderItemId?: string;
}

export class CreateInvoiceDto {
  patientId!: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  createdBy?: string;
  sourceAppointmentId?: string;
  sourceAdmissionId?: string;
  notes?: string;
  items!: CreateInvoiceItemDto[];
}
