import { Module } from '@nestjs/common';
import { AuditSubscriber } from './audit.subscriber.js';

@Module({
  providers: [AuditSubscriber],
  exports: [AuditSubscriber],
})
export class AuditEmitterModule {}
