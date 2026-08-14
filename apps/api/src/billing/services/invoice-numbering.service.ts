import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { TenantConnectionService } from '../../database/tenant-connection.service';

@Injectable()
export class InvoiceNumberingService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly tenantConnection: TenantConnectionService,
    private readonly dataSource: DataSource
  ) {}

  /**
   * Generates the next invoice number based on financial year sequences.
   * Uses a raw SQL query with RETURNING to ensure atomicity and prevent race conditions.
   */
  async generateInvoiceNumber(financialYearStart: string): Promise<string> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const queryRunner = manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Atomic increment using raw SQL for performance and locking
        const result = await queryRunner.query(
          `INSERT INTO invoice_sequences (financial_year_start, current_value) 
           VALUES ($1, 1) 
           ON CONFLICT (financial_year_start) 
           DO UPDATE SET current_value = invoice_sequences.current_value + 1 
           RETURNING current_value`,
          [financialYearStart]
        );

        const sequenceValue = result[0].current_value;
        const prefix = 'INV';
        const yearSuffix = financialYearStart.substring(2, 4); // e.g., "24" from "2024-04-01"
        
        await queryRunner.commitTransaction();
        return `${prefix}-${yearSuffix}-${String(sequenceValue).padStart(6, '0')}`;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    });
  }

  /**
   * Calculates the financial year start date for a given transaction date.
   * Assuming financial year starts April 1st (common in many jurisdictions).
   * Adjust logic if your region uses Jan 1st or July 1st.
   */
  getFinancialYearStart(transactionDate: Date = new Date()): string {
    const year = transactionDate.getFullYear();
    const month = transactionDate.getMonth() + 1; // 0-indexed

    // If month is Jan(1), Feb(2), Mar(3), it belongs to previous year's FY
    if (month < 4) {
      return `${year - 1}-04-01`;
    }
    return `${year}-04-01`;
  }
}
