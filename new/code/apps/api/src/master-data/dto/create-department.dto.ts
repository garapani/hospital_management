export class CreateDepartmentDto {
  departmentCode!: string;
  departmentName!: string;
  description?: string;
  isAppointmentApplicable?: boolean;
  parentDepartmentId?: string;
  roomNumber?: string;
  noticeText?: string;
}
