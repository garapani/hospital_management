export class CreatePatientAddressDto {
  addressType?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export class CreatePatientKinDto {
  kinName!: string;
  relationship!: string;
  phoneNumber!: string;
  email?: string;
  address?: string;
}

export class CreatePatientDto {
  firstName!: string;
  middleName?: string;
  lastName!: string;
  gender!: string;
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
