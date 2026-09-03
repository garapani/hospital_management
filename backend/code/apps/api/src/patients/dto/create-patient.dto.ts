import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class CreatePatientAddressDto {
  @IsOptional()
  @IsString()
  addressType?: string;

  @IsOptional()
  @IsString()
  streetAddress?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  // 2-digit GST state code, e.g. '27' — used for GST place-of-supply (CGST+SGST vs IGST)
  // determination, distinct from the free-text `state` above.
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}$/, { message: 'stateCode must be a 2-digit GST state code' })
  stateCode?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  country?: string;
}

export class CreatePatientKinDto {
  @IsString()
  kinName!: string;

  @IsString()
  relationship!: string;

  @IsString()
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class CreatePatientDto {
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsString()
  @IsIn(['Male', 'Female', 'Other', 'Unknown'])
  gender!: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  age?: string;

  @IsOptional()
  @Matches(/^[0-9]{10}$/, { message: 'phoneNumber must be a 10-digit number' })
  phoneNumber?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'Unknown'])
  bloodGroup?: string;

  @IsOptional()
  @IsString()
  allergies?: string;

  @IsOptional()
  @IsString()
  governmentIdType?: string;

  @IsOptional()
  @IsString()
  governmentIdNumber?: string;

  @IsOptional()
  @IsString()
  insuranceProvider?: string;

  @IsOptional()
  @IsString()
  insurancePolicyNumber?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePatientAddressDto)
  addresses?: CreatePatientAddressDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePatientKinDto)
  kins?: CreatePatientKinDto[];

  @IsOptional()
  @IsBoolean()
  allowDuplicate?: boolean;
}
