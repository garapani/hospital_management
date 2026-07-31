import { Controller, Post, Patch, Get, Body, Param, UseGuards, Delete } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { EncountersService } from './encounters.service.js';
import { CreateNoteDto, UpdateNoteDto, CreateDiagnosisDto, CreatePrescriptionDto } from './dto/encounter.dto.js';

@Controller('encounters')
@UseGuards(PermissionGuard)
export class EncountersController {
  constructor(private readonly encountersService: EncountersService) {}

  // --- Clinical Notes ---
  @Post('notes')
  @RequirePermission('encounter.manage')
  async createNote(@Body() input: CreateNoteDto) {
    return this.encountersService.createNote(input);
  }

  @Patch('notes/:id')
  @RequirePermission('encounter.manage')
  async updateNote(@Param('id') id: string, @Body() input: UpdateNoteDto) {
    return this.encountersService.updateNote(id, input);
  }

  @Get('notes/patient/:patientId')
  @RequirePermission('encounter.read')
  async getNotesByPatient(@Param('patientId') patientId: string) {
    return this.encountersService.getNotesByPatient(patientId);
  }

  // --- Diagnoses ---
  @Post('diagnoses')
  @RequirePermission('encounter.manage')
  async createDiagnosis(@Body() input: CreateDiagnosisDto) {
    return this.encountersService.createDiagnosis({ ...input, isPrimary: input.isPrimary ?? false });
  }

  @Delete('diagnoses/:id')
  @RequirePermission('encounter.manage')
  async deleteDiagnosis(@Param('id') id: string) {
    await this.encountersService.deleteDiagnosis(id);
    return { success: true };
  }

  @Get('diagnoses/patient/:patientId')
  @RequirePermission('encounter.read')
  async getDiagnosesByPatient(@Param('patientId') patientId: string) {
    return this.encountersService.getDiagnosesByPatient(patientId);
  }

  // --- Prescriptions ---
  @Post('prescriptions')
  @RequirePermission('encounter.manage')
  async createPrescription(@Body() input: CreatePrescriptionDto) {
    return this.encountersService.createPrescription(input);
  }

  @Delete('prescriptions/:id')
  @RequirePermission('encounter.manage')
  async deletePrescription(@Param('id') id: string) {
    await this.encountersService.deletePrescription(id);
    return { success: true };
  }

  @Get('prescriptions/patient/:patientId')
  @RequirePermission('encounter.read')
  async getPrescriptionsByPatient(@Param('patientId') patientId: string) {
    return this.encountersService.getPrescriptionsByPatient(patientId);
  }
}
