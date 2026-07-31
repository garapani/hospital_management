import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditSubscriber } from '@hospital/audit-emitter';

@Injectable()
export class AuditWiringService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditSubscriber: AuditSubscriber,
  ) {}

  onModuleInit(): void {
    this.dataSource.subscribers.push(this.auditSubscriber);
  }
}
