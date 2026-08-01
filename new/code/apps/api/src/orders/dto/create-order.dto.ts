export class CreateOrderItemDto {
  itemType!: string;
  itemDescription!: string;
  priority?: string;
}

export class CreateOrderDto {
  patientId!: string;
  orderedBy!: string;
  sourceAppointmentId?: string;
  sourceAdmissionId?: string;
  notes?: string;
  items!: CreateOrderItemDto[];
}
