import { BadRequestException } from '@nestjs/common';

export function requireParam(value: string | undefined, paramName: string): string {
  if (!value) {
    throw new BadRequestException(`${paramName} is required`);
  }
  return value;
}
