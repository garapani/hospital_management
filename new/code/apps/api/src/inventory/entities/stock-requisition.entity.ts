import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('stock_requisitions')
export class StockRequisition extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) departmentId!: string;
  @Column({ type: 'uuid' }) requestedBy!: string;
  @Column({ type: 'varchar', unique: true }) requisitionNumber!: string;
  @Column({ type: 'varchar', default: 'Pending' }) status!: string;
  // 'Pending' | 'PartiallyFulfilled' | 'Fulfilled' | 'Cancelled'
  @Column({ type: 'text', nullable: true }) notes!: string | null;
  @Column({ type: 'text', nullable: true }) cancelReason!: string | null;
}
