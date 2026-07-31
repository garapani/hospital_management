import { Injectable, Logger } from '@nestjs/common';
import { AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';

@Injectable()
export class LoggingAuditEventPublisher implements AuditEventPublisher {
  private readonly logger = new Logger(LoggingAuditEventPublisher.name);

  async publish(event: AuditEvent): Promise<void> {
    this.logger.log(JSON.stringify(event));
  }
}
