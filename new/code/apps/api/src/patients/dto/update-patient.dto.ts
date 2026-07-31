import { CreatePatientAddressDto, CreatePatientKinDto } from './create-patient.dto.js';

export class UpdatePatientDto {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  gender?: string;
  dateOfBirth?: string;
  age?: string;
  phoneNumber?: string;
  email?: string;
  bloodGroup?: string;
  governmentIdType?: string;
  governmentIdNumber?: string;
  addresses?: CreatePatientAddressDto[];
  kins?: CreatePatientKinDto[];
  allowDuplicate?: boolean;
}
