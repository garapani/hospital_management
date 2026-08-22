import { IsIn } from 'class-validator';

export class SubscribeTenantDto {
  @IsIn(['monthly', 'annual'])
  billingCycle!: 'monthly' | 'annual';
}
