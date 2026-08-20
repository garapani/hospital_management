export class CreateTaskDto {
  admissionId!: string;
  taskType!: string;
  description!: string;
  dueAt?: string;
  assignedTo?: string;
}

export class ListTasksQueryDto {
  admissionId?: string;
}

export class CreateAdministrationDto {
  admissionId!: string;
  drugName!: string;
  dose!: string;
  route?: string;
  scheduledAt?: string;
  notes?: string;
}

export class ListAdministrationsQueryDto {
  admissionId?: string;
}

export class SkipAdministrationDto {
  notes?: string;
}
