import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

/**
 * Sterile instrument catalog entry.
 */
@Entity('cssd_instruments')
export class CssdInstrument extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  code!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  category!: string | null;

  @Column({ type: 'int', default: 0 })
  quantity!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}

export type SterilizationCycleStatus = 'InProgress' | 'Completed' | 'Failed';
export type SterilizationMethod = 'Steam' | 'ETO' | 'Chemical';

/**
 * One sterilization cycle for an instrument (batch). A completed cycle has a sterileExpiryAt —
 * instruments are sterile until then.
 */
@Entity('cssd_sterilization_cycles')
export class CssdSterilizationCycle extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  instrumentId!: string;

  @Column({ type: 'varchar' })
  method!: SterilizationMethod;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'varchar', default: 'InProgress' })
  status!: SterilizationCycleStatus;

  /** Instruments are sterile until this time; null while InProgress/Failed. */
  @Column({ type: 'timestamptz', nullable: true })
  sterileExpiryAt!: Date | null;

  /** Actor who operated the cycle (see §25). */
  @Column({ type: 'uuid' })
  operatedBy!: string;

  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;
}
