import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

// Mirrored locally (mirror-don't-extract): numeric columns come back from node-postgres as
// strings; importing the billing module's transformer would create an accounting -> billing edge.
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

export type JournalStatus = 'Draft' | 'Posted';

@Entity('journal_entries')
export class JournalEntry extends SoftDeletableEntity {
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

  /** Actor who posted it; null until posted. */
  @Column({ type: 'uuid', nullable: true })
  postedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  /**
   * Set only on journals created by AccountingService.postAutoJournal (automatic billing
   * postings). Null for manually-created journals. The pair is unique (partial index, migration
   * 0058) — the idempotency mechanism for auto-posting: postAutoJournal looks up an existing
   * journal by this pair before inserting a new one.
   */
  @Column({ type: 'varchar', length: 40, nullable: true })
  sourceType!: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceId!: string | null;
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
