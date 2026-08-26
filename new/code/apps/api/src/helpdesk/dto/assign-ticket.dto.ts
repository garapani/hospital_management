import { IsUUID } from 'class-validator';

export class AssignTicketDto {
  // uuid column — the read DTO already uses @IsUUID; the write path must match
  // (code-review-findings-2026-08-25 platform cross-cutting P3).
  @IsUUID()
  assigneeAccountId!: string;
}
