import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { Admission } from '../admissions/entities/admission.entity.js';
import { Appointment } from '../appointments/entities/appointment.entity.js';
import { NotificationsService } from './notifications.service.js';
import { CreateNotificationDto } from './dto/create-notification.dto.js';

@Injectable()
export class NotificationsSubscriber implements EntitySubscriberInterface {
  private readonly logger = new Logger(NotificationsSubscriber.name);

  private readonly eventCatalog = new Map<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (...args: any[]) => object,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (entity: any) => CreateNotificationDto | null
  >([
    [
      Admission,
      (entity: Admission) => ({
        recipientAccountId: entity.admittingDoctorId,
        title: 'New Patient Admission',
        message: `You have been assigned as the admitting doctor for a new admission (ward ${entity.wardId}, bed ${entity.bedId}).`,
        type: 'info',
      }),
    ],
    [
      Appointment,
      (entity: Appointment) => {
        // Walk-in/self-service bookings can omit a doctor at creation time — nobody to notify yet.
        if (!entity.doctorId) return null;
        return {
          recipientAccountId: entity.doctorId,
          title: 'New Appointment Scheduled',
          message: `Appointment scheduled with ${entity.firstName} ${entity.lastName} on ${entity.appointmentDate} at ${entity.appointmentTime}.`,
          type: 'info',
        };
      },
    ],
  ]);

  constructor(
    dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {
    dataSource.subscribers.push(this);
  }

  // Deliberately does NOT use `event.manager` (the business transaction). NotificationsService.create()
  // opens its own transaction via TenantConnectionService.runInTenantSchema(), which means a
  // notification could commit before the business write does — a rollback of the outer
  // admission/appointment transaction after this point would leave an orphaned notification. That's
  // the accepted tradeoff, deliberately in the opposite direction of ReportingSubscriber's: writing
  // through event.manager instead would make the notification atomic with the business row, but
  // would let a notification-code failure abort a patient admission, which is worse.
  async afterInsert(event: InsertEvent<any>) {
    if (!event.metadata || typeof event.metadata.target !== 'function') return;

    const buildNotification = this.eventCatalog.get(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      event.metadata.target as new (...args: any[]) => object,
    );
    if (!buildNotification) return;

    try {
      const dto = buildNotification(event.entity);
      if (!dto) return;
      await this.notificationsService.create(dto);
    } catch (error) {
      this.logger.error(
        `Failed to create notification for ${event.metadata.target}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
