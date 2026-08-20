import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; importing the inventory module's transformer would create a ward-supply -> inventory
// edge, and importing billing's would create a ward-supply -> billing edge.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

/**
 * Ward (department) sub-store stock balance for one inventory item. Receipts (from the central
 * store / fulfilled requisitions) increment it; ward consumption decrements it.
 */
@Entity('ward_stock_balances')
@Unique(['departmentId', 'itemId'])
export class WardStockBalance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  departmentId!: string;

  @Column({ type: 'uuid' })
  itemId!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  availableQuantity!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

export type WardStockTransactionType = 'Receive' | 'Consume';

@Entity('ward_stock_transactions')
export class WardStockTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  departmentId!: string;

  @Column({ type: 'uuid' })
  itemId!: string;

  @Column({ type: 'varchar' })
  transactionType!: WardStockTransactionType;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  quantity!: number;

  @Column({ type: 'uuid', nullable: true })
  patientId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  admissionId!: string | null;

  /** Actor who performed the receive/consume (see §25). */
  @Column({ type: 'uuid' })
  performedBy!: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  performedAt!: Date;

  @Column({ type: 'text', nullable: true })
  remarks!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
