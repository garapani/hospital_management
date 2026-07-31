import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('beds')
export class Bed {
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

  @CreateDateColumn()
  createdAt!: Date;
}
