import { Module } from '@nestjs/common';
import { FixedAssetsService } from './fixed-assets.service.js';
import { FixedAssetNumberGeneratorService } from './fixed-asset-number-generator.service.js';
import { FixedAssetsController } from './fixed-assets.controller.js';

@Module({
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService, FixedAssetNumberGeneratorService],
  exports: [FixedAssetsService],
})
export class FixedAssetsModule {}
