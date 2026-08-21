import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type BillingCycle = 'monthly' | 'annual';
export type SubscriptionStatus = 'active' | 'canceled';

/** Platform-side SaaS subscription for a hospital tenant (public schema — the tenant's contract
 *  with the platform, never visible to the hospital itself). */
@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  tenantId!: string;

  @Column({ type: 'varchar' })
  packageCode!: string;

  @Column({ type: 'varchar', length: 10 })
  billingCycle!: BillingCycle;

  /** Denormalized list price in ₹ for one cycle, fixed at subscribe time. */
  @Column({ type: 'int' })
  pricePerCycle!: number;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status!: SubscriptionStatus;

  @Column({ type: 'timestamptz' })
  currentPeriodStart!: Date;

  @Column({ type: 'timestamptz' })
  currentPeriodEnd!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
