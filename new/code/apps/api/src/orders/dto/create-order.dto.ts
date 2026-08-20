export class CreateOrderItemDto {
  itemType!: string;
  itemDescription!: string;
  priority?: string;
}

export class CreateOrderDto {
  patientId!: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  orderedBy?: string;
  sourceAppointmentId?: string;
  sourceAdmissionId?: string;
  notes?: string;
  items!: CreateOrderItemDto[];
}
