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
import { CreatePatientAddressDto, CreatePatientKinDto } from './create-patient.dto.js';

export class UpdatePatientDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @IsOptional()
  @IsString()
  @IsIn(['Male', 'Female', 'Other', 'Unknown'])
  gender?: string;

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
  governmentIdType?: string;

  @IsOptional()
  @IsString()
  governmentIdNumber?: string;

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
