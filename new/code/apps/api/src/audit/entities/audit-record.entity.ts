import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_records')
export class AuditRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tableName!: string;

  @Column()
  recordId!: string;

  @Column({ type: 'varchar', length: 20 })
  action!: 'create' | 'update' | 'delete';

  @Column({ type: 'varchar', nullable: true })
  changedByAccountId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  correlationId!: string | null;

  @Column({ type: 'jsonb' })
  diff!: unknown;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;
}
