import { Module } from '@nestjs/common';
import { EncountersService } from './encounters.service.js';
import { EncountersController } from './encounters.controller.js';

@Module({
  controllers: [EncountersController],
  providers: [EncountersService],
})
export class EncountersModule {}
