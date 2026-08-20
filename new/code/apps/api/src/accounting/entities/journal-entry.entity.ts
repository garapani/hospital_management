import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; importing the billing module's transformer would create an accounting -> billing edge.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

export type JournalStatus = 'Draft' | 'Posted';

@Entity('journal_entries')
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  journalNumber!: string;

  @Column({ type: 'date' })
  entryDate!: string;

  @Column({ type: 'text', nullable: true })
  narration!: string | null;

  @Column({ type: 'varchar', default: 'Draft' })
  status!: JournalStatus;

  /** Actor who created the entry (Draft). */
  @Column({ type: 'uuid' })
  createdBy!: string;

  /** Actor who posted it; null until posted. */
  @Column({ type: 'uuid', nullable: true })
  postedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('journal_lines')
export class JournalLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  journalId!: string;

  @Column({ type: 'uuid' })
  accountId!: string;

  /** Exactly one of debit/credit is non-zero per line. */
  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  debit!: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  credit!: number;

  @Column({ type: 'text', nullable: true })
  lineNarration!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
