import { IsNumber } from 'class-validator';

export class RunDepreciationDto {
  /** 1-12. */
  @IsNumber()
  month!: number;

  /** Valid 4-digit year. */
  @IsNumber()
  year!: number;
}
