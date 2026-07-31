import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('wards')
export class Ward {
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

  @CreateDateColumn()
  createdAt!: Date;
}
