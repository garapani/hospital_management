import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AuditExclude } from '@hospital/audit-emitter';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('accounts')
export class Account extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  accountType!: 'staff' | 'patient';

  @Column()
  displayName!: string;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ default: false })
  needsPasswordUpdate!: boolean;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @Column({ type: 'varchar', unique: true, nullable: true })
  username!: string | null;

  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  @AuditExclude()
  passwordHash!: string | null;

  @Column({ type: 'varchar', nullable: true })
  phoneNumber!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  phoneVerifiedAt!: Date | null;

  /** Set iff accountType === 'patient': the one Patient record this portal account may access. */
  @Column({ type: 'uuid', nullable: true })
  patientId!: string | null;

  /** Optional staff ward assignment — when set, Nursing/Vitals actions are scoped to this ward
   *  (see tenant-context's getWardId()). Null means unrestricted (today's tenant-wide access). */
  @Column({ type: 'uuid', nullable: true })
  wardId!: string | null;
}
