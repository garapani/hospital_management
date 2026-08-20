import { SterilizationCycleStatus, SterilizationMethod } from '../entities/cssd.entity.js';

export class CreateInstrumentDto {
  code!: string;
  name!: string;
  category?: string;
  quantity?: number;
}

export class UpdateInstrumentDto {
  name?: string;
  category?: string;
  quantity?: number;
}

export class StartCycleDto {
  instrumentId!: string;
  method!: SterilizationMethod;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  operatedBy?: string;
}

export class CompleteCycleDto {
  sterileHours!: number;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  operatedBy?: string;
}

export class FailCycleDto {
  failureReason!: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  operatedBy?: string;
}

export class ListCyclesQueryDto {
  instrumentId?: string;
  status?: SterilizationCycleStatus;
}
