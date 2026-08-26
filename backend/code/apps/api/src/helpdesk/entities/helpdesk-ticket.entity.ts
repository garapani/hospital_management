import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { SoftDeletableEntity } from '../../database/auditable.entity.js';

export type HelpdeskTicketPriority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type HelpdeskTicketStatus = 'Open' | 'InProgress' | 'Resolved' | 'Closed';

/**
 * Internal helpdesk ticket.
 */
@Entity('helpdesk_tickets')
export class HelpdeskTicket extends SoftDeletableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  ticketNumber!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', nullable: true })
  category!: string | null;

  @Column({ type: 'varchar', default: 'Medium' })
  priority!: HelpdeskTicketPriority;

  @Column({ type: 'varchar', default: 'Open' })
  status!: HelpdeskTicketStatus;

  /** The account that raised the ticket (see §25). */
  @Column({ type: 'uuid' })
  requesterAccountId!: string;

  @Column({ type: 'uuid', nullable: true })
  assigneeAccountId!: string | null;

  /** The account that resolved it (see §25). */
  @Column({ type: 'uuid', nullable: true })
  resolvedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt!: Date | null;
}
