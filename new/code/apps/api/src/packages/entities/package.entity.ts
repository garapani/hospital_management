import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** A SaaS package (public-schema catalog row, like roles/permissions). See package-catalog.ts. */
@Entity('packages')
export class Package {
  @PrimaryColumn({ type: 'varchar' })
  code!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb' })
  modules!: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
