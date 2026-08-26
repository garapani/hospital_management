import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, IsNull, QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import { FractionRule, FractionEntry } from './entities/fraction.entity.js';

export interface CreateRuleInput {
  doctorId: string;
  departmentId?: string;
  fractionPercent: number;
}

export interface RecordEntryInput {
  invoiceId: string;
  doctorId: string;
  ruleId?: string;
  /** Deprecated — the share's base is always the invoice's own totalAmount, resolved
   *  server-side, never accepted from the caller (see recordEntry). */
  recordedBy?: string;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Fraction & Incentive (PRD Phase 5): doctor revenue-share rules and the per-invoice share entries
 * computed from them. `recordedBy` derives from the authenticated principal (Development-Standards
 * §25); the caller-supplied value is only a fallback for non-HTTP callers, and recording a share is
 * a money-relevant action where spoofing would be an audit-trail integrity breach.
 */
@Injectable()
export class FractionService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  // ---------- Rules ----------

  async createRule(input: CreateRuleInput): Promise<FractionRule> {
    if (
      !Number.isFinite(input.fractionPercent) ||
      input.fractionPercent <= 0 ||
      input.fractionPercent > 100
    ) {
      throw new BadRequestException('fractionPercent must be greater than 0 and at most 100');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const doctor = await manager.query(`SELECT id FROM accounts WHERE id = $1`, [input.doctorId]);
      if (doctor.length === 0) {
        throw new NotFoundException(`Doctor account ${input.doctorId} not found`);
      }

      // A doctor's default (null-department) share is single-valued: a second active default
      // rule would make the recordEntry fallback nondeterministic (code-review-findings
      // 2026-08-25 P2). Department-specific rules are unaffected — only the default is guarded.
      if (input.departmentId === undefined || input.departmentId === null) {
        const existing = await manager.query(
          `SELECT id FROM fraction_rules WHERE "doctorId" = $1 AND "departmentId" IS NULL AND "isActive" = true`,
          [input.doctorId],
        );
        if (existing.length > 0) {
          throw new ConflictException(
            `Doctor ${input.doctorId} already has an active default (null-department) fraction rule`,
          );
        }
      }

      const repository = manager.getRepository(FractionRule);
      try {
        return await repository.save(
          repository.create({
            doctorId: input.doctorId,
            departmentId: input.departmentId ?? null,
            fractionPercent: input.fractionPercent,
            isActive: true,
          }),
        );
      } catch (error) {
        // Race-safety backstop for the pre-check above (partial unique index, migration 0080).
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint ===
            'UQ_fraction_rules_active_default_per_doctor'
        ) {
          throw new ConflictException(
            `Doctor ${input.doctorId} already has an active default (null-department) fraction rule`,
          );
        }
        throw error;
      }
    });
  }

  async listRules(
    query: PaginationQueryDto & { doctorId?: string },
  ): Promise<PaginatedResponseDto<FractionRule>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(FractionRule).createQueryBuilder('rule');
      if (query.doctorId) {
        qb.andWhere('rule.doctorId = :doctorId', { doctorId: query.doctorId });
      }
      qb.orderBy('rule.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async deactivateRule(id: string): Promise<FractionRule> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(FractionRule);
      const rule = await repository.findOne({ where: { id } });
      if (!rule) {
        throw new NotFoundException(`Fraction rule ${id} not found`);
      }
      if (!rule.isActive) {
        throw new ConflictException(`Fraction rule ${id} is already deactivated`);
      }
      rule.isActive = false;
      return repository.save(rule);
    });
  }

  async reactivateRule(id: string): Promise<FractionRule> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(FractionRule);
      const rule = await repository.findOne({ where: { id } });
      if (!rule) {
        throw new NotFoundException(`Fraction rule ${id} not found`);
      }
      rule.isActive = true;
      return repository.save(rule);
    });
  }

  // ---------- Entries ----------

  async recordEntry(input: RecordEntryInput): Promise<FractionEntry> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      // baseAmount is never accepted from the caller: it was previously client-supplied and
      // never reconciled against the invoice, letting any fraction.manage holder mint an
      // arbitrary payout (code-review-findings-2026-08-25 P1). It's always the invoice's own
      // totalAmount, resolved server-side here, the same way InvoicesService.captureChargeForOrderItem
      // resolves price server-side rather than trusting the caller.
      const invoiceRows = await manager.query(`SELECT "totalAmount" FROM invoices WHERE id = $1`, [
        input.invoiceId,
      ]);
      if (invoiceRows.length === 0) {
        throw new NotFoundException(`Invoice ${input.invoiceId} not found`);
      }
      const baseAmount = Number(invoiceRows[0].totalAmount);

      // Idempotency: at most one fraction entry per (invoice, doctor) — a double-submitted or
      // retried request must not pay the same doctor twice for the same invoice
      // (code-review-findings-2026-08-25 P1). Backed by UQ_fraction_entries_invoice_doctor.
      const existingEntry = await manager.getRepository(FractionEntry).findOne({
        where: { invoiceId: input.invoiceId, doctorId: input.doctorId },
      });
      if (existingEntry) {
        throw new ConflictException(
          `A fraction entry already exists for doctor ${input.doctorId} on invoice ${input.invoiceId}`,
        );
      }

      let fractionPercent: number;
      if (input.ruleId) {
        const rule = await manager.getRepository(FractionRule).findOne({ where: { id: input.ruleId } });
        if (!rule) {
          throw new BadRequestException(`Fraction rule ${input.ruleId} not found`);
        }
        if (!rule.isActive) {
          throw new BadRequestException(`Fraction rule ${input.ruleId} is deactivated`);
        }
        if (rule.doctorId !== input.doctorId) {
          throw new BadRequestException(
            `Fraction rule ${input.ruleId} does not belong to doctor ${input.doctorId}`,
          );
        }
        fractionPercent = rule.fractionPercent;
      } else {
        // Deterministic default-rule lookup: newest active null-department rule wins (a doctor's
        // default share is single-valued — createRule now prevents a second one, but the
        // ordering keeps pre-existing ambiguity deterministic rather than arbitrary).
        const rule = await manager.getRepository(FractionRule).findOne({
          where: { doctorId: input.doctorId, departmentId: IsNull(), isActive: true },
          order: { createdAt: 'DESC' },
        });
        if (!rule) {
          throw new BadRequestException(`No active fraction rule for doctor ${input.doctorId}`);
        }
        fractionPercent = rule.fractionPercent;
      }

      const shareAmount = roundMoney((baseAmount * fractionPercent) / 100);

      try {
        return await manager.getRepository(FractionEntry).save(
          manager.getRepository(FractionEntry).create({
            invoiceId: input.invoiceId,
            doctorId: input.doctorId,
            fractionPercent,
            baseAmount,
            shareAmount,
            recordedBy: this.resolveActor(input.recordedBy),
          }),
        );
      } catch (error) {
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint ===
            'UQ_fraction_entries_invoice_doctor'
        ) {
          throw new ConflictException(
            `A fraction entry already exists for doctor ${input.doctorId} on invoice ${input.invoiceId}`,
          );
        }
        throw error;
      }
    });
  }

  async listEntries(
    query: PaginationQueryDto & { invoiceId?: string; doctorId?: string },
  ): Promise<PaginatedResponseDto<FractionEntry>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(FractionEntry).createQueryBuilder('entry');
      if (query.invoiceId) {
        qb.andWhere('entry.invoiceId = :invoiceId', { invoiceId: query.invoiceId });
      }
      if (query.doctorId) {
        qb.andWhere('entry.doctorId = :doctorId', { doctorId: query.doctorId });
      }
      qb.orderBy('entry.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getEntry(id: string): Promise<FractionEntry> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const entry = await manager.getRepository(FractionEntry).findOne({ where: { id } });
      if (!entry) {
        throw new NotFoundException(`Fraction entry ${id} not found`);
      }
      return entry;
    });
  }

  /**
   * Reverses a live share entry (invoice returned or cancelled) — the entry is voided so the
   * doctor is never paid a stale share (code-review-findings-2026-08-25 P2). The entry is a
   * snapshot by design; recomputing a partially-returned invoice's share onto the same entry is
   * a larger feature, so reversal is all-or-nothing.
   */
  async reverseEntry(id: string, actor?: string): Promise<FractionEntry> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(FractionEntry);
      const entry = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!entry) {
        throw new NotFoundException(`Fraction entry ${id} not found`);
      }
      if (entry.reversedAt) {
        throw new ConflictException(`Fraction entry ${id} is already reversed`);
      }
      entry.reversedAt = new Date();
      entry.reversedBy = this.resolveActor(actor) || null;
      return repository.save(entry);
    });
  }

  /**
   * Reverses every live entry for an invoice, in the caller's transaction (`manager`). Called by
   * the FractionReversalSubscriber when the source invoice is cancelled or returned — idempotent
   * (already-reversed entries are skipped), so repeated events are no-ops.
   */
  async reverseEntriesForInvoice(manager: EntityManager, invoiceId: string): Promise<void> {
    const repository = manager.getRepository(FractionEntry);
    const live = await repository.find({
      where: { invoiceId },
      lock: { mode: 'pessimistic_write' },
    });
    for (const entry of live) {
      if (entry.reversedAt) continue;
      entry.reversedAt = new Date();
      entry.reversedBy = this.resolveActor() || null;
      await repository.save(entry);
    }
  }
}
