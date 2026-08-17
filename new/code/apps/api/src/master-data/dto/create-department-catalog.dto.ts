export class CreateDepartmentCatalogDto {
  departmentCode!: string;
  departmentName!: string;
  description!: string | null;
  isAppointmentApplicable!: boolean;
}
