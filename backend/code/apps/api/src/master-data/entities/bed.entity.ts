import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('beds')
export class Bed extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  wardId!: string;

  @Column()
  bedNumber!: string;

  @Column({ type: 'varchar', nullable: true })
  bedType!: string | null;

  @Column({ type: 'varchar', default: 'Available' })
  status!: string; // 'Available' | 'Occupied' | 'Maintenance'

  @Column({ default: true })
  isActive!: boolean;
}
