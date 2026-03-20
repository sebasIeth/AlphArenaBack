import { Module, Global } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { SolanaSettlementService } from './solana-settlement.service';
import { SettlementRouterService } from './settlement-router.service';
import { X402VerifierService } from './x402-verifier.service';

@Global()
@Module({
  providers: [SettlementService, SolanaSettlementService, SettlementRouterService, X402VerifierService],
  exports: [SettlementService, SolanaSettlementService, SettlementRouterService, X402VerifierService],
})
export class SettlementModule {}
