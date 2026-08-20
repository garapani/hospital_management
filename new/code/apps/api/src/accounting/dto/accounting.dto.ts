import { AccountType } from '../entities/ledger-account.entity.js';

export class CreateAccountDto {
  accountCode!: string;
  name!: string;
  type!: AccountType;
  parentAccountId?: string;
}

export class UpdateAccountDto {
  name?: string;
  type?: AccountType;
  parentAccountId?: string | null;
}

export class JournalLineDto {
  accountId!: string;
  debit?: number;
  credit?: number;
  lineNarration?: string;
}

export class CreateJournalDto {
  entryDate!: string;
  narration?: string;
  lines!: JournalLineDto[];
}

export class ListJournalsQueryDto {
  status?: 'Draft' | 'Posted';
  from?: string;
  to?: string;
}
