import { IsString } from 'class-validator';

export class SetTenantPackageDto {
  @IsString()
  packageCode!: string;
}
