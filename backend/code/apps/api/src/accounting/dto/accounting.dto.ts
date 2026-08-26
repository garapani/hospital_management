import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';
import type { AccountType } from '../entities/ledger-account.entity.js';

export class CreateAccountDto {
  @IsString()
  accountCode!: string;

  @IsString()
  name!: string;

  @IsIn(['Asset', 'Liability', 'Equity', 'Income', 'Expense'])
  type!: AccountType;

  @IsOptional()
  @IsString()
  parentAccountId?: string;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['Asset', 'Liability', 'Equity', 'Income', 'Expense'])
  type?: AccountType;

  @IsOptional()
  @IsString()
  parentAccountId?: string | null;
}

export class JournalLineDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  credit?: number;

  @IsOptional()
  @IsString()
  lineNarration?: string;
}

export class CreateJournalDto {
  @IsDateString()
  entryDate!: string;

  @IsOptional()
  @IsString()
  narration?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

export class ListJournalsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['Draft', 'Posted'])
  status?: 'Draft' | 'Posted';

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
