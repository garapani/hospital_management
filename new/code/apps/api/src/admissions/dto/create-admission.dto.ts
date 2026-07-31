export class CreateAdmissionDto {
  patientId!: string;
  admissionSource!: string;
  sourceAppointmentId?: string;
  sourceTriageEntryId?: string;
  admittingDoctorId!: string;
  bedId!: string;
}
