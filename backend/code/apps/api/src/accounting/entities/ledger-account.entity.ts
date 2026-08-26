import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { SoftDeletableEntity } from '../../database/auditable.entity.js';

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';
export const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];

/**
 * Chart of accounts entry. Hierarchical via parentAccountId; the tree's depth is not enforced
 * (a two-level tree is the practical norm for a hospital).
 */
@Entity('ledger_accounts')
export class LedgerAccount extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  accountCode!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  type!: AccountType;

  @Column({ type: 'uuid', nullable: true })
  parentAccountId!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
