import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryColumn({ type: 'varchar' })
  hospitalId!: string;

  @Column()
  hospitalName!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: 'active' | 'suspended';

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  suspendedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;
}
