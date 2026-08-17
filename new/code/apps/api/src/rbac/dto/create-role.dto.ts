export class CreateRoleDto {
  name!: string;
  description!: string;
  priority!: number;
  isCrossTenant?: boolean;
}
