import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditColumnsSubscriber } from './audit-columns.subscriber.js';

@Injectable()
export class AuditColumnsWiringService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditColumnsSubscriber: AuditColumnsSubscriber,
  ) {}

  onModuleInit(): void {
    this.dataSource.subscribers.push(this.auditColumnsSubscriber);
  }
}
