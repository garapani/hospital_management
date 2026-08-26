import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('account_roles')
export class AccountRole {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  accountId!: string;

  @Column()
  roleId!: string;

  @Column({ type: 'timestamptz', nullable: true })
  startDate!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endDate!: Date | null;

  @Column({ default: true })
  isActive!: boolean;
}
