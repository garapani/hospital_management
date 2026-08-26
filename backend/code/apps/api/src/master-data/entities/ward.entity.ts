import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';

@Entity('wards')
export class Ward extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  wardCode!: string;

  @Column()
  wardName!: string;

  @Column({ type: 'varchar', nullable: true })
  wardType!: string | null;

  @Column({ type: 'int', nullable: true })
  bedCapacity!: number | null;

  @Column({ default: true })
  isActive!: boolean;
}
