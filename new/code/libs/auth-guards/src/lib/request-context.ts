import { Injectable } from '@nestjs/common';
import { Request } from 'express';

export interface RequestContext {
  accountId?: string;
  hospitalId?: string;
  roles: string[];
  permissions: string[];
  patientId?: string;
}

function parseCsvHeader(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

@Injectable()
export class RequestContextFactory {
  fromRequest(req: Request): RequestContext {
    return {
      accountId: req.header('x-account-id') || undefined,
      hospitalId: req.header('x-tenant-id') || undefined,
      roles: parseCsvHeader(req.header('x-roles')),
      permissions: parseCsvHeader(req.header('x-permissions')),
      patientId: req.header('x-patient-id') || undefined,
    };
  }
}
