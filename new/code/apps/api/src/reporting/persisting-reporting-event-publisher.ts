import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ReportingEvent } from './entities/reporting-event.entity.js';

@Injectable()
export class PersistingReportingEventPublisher {
  private readonly logger = new Logger(PersistingReportingEventPublisher.name);

  async publish(eventData: Partial<ReportingEvent>, manager: EntityManager): Promise<void> {
    try {
      const event = manager.getRepository(ReportingEvent).create(eventData);
      await manager.getRepository(ReportingEvent).save(event);
    } catch (error) {
      this.logger.error(
        `Failed to persist reporting event ${eventData.eventType} for entity ${eventData.entityId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
