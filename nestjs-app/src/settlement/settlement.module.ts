import { Module, Global } from '@nestjs/common';
import { SettlementService } from './settlement.service';

@Global()
@Module({
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
