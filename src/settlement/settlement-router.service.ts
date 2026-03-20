import { Injectable, Logger } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { SolanaSettlementService } from './solana-settlement.service';

/**
 * Chain-agnostic facade that routes settlement operations to the
 * appropriate chain-specific service (EVM or Solana).
 */
@Injectable()
export class SettlementRouterService {
  private readonly logger = new Logger(SettlementRouterService.name);

  constructor(
    private readonly evmSettlement: SettlementService,
    private readonly solanaSettlement: SolanaSettlementService,
  ) {}

  /**
   * Returns token decimals for the given chain.
   * EVM chains use 18 decimals (USDC on Base), Solana reads from mint (typically 6 or 9).
   */
  getTokenDecimals(chain: string): number {
    if (chain === 'solana') {
      return this.solanaSettlement.getTokenDecimals();
    }
    return this.evmSettlement.getUsdcDecimals();
  }

  /**
   * Transfer tokens from an agent wallet to a destination.
   */
  async transferTokenFromAgent(
    chain: string,
    agentPrivateKey: string,
    to: string,
    amount: bigint,
  ): Promise<string | null> {
    if (chain === 'solana') {
      return this.solanaSettlement.transferTokenFromAgent(agentPrivateKey, to, amount);
    }
    return this.evmSettlement.transferUsdcFromAgent(agentPrivateKey, to, amount);
  }

  /**
   * Transfer tokens from the platform wallet to a destination.
   */
  async transferTokenFromPlatform(
    chain: string,
    to: string,
    amount: bigint,
  ): Promise<string | null> {
    if (chain === 'solana') {
      return this.solanaSettlement.transferTokenFromPlatform(to, amount);
    }
    return this.evmSettlement.transferUsdcFromPlatform(to, amount);
  }

  /**
   * Get token balance for an agent.
   */
  async getAgentTokenBalance(chain: string, walletAddress: string): Promise<string> {
    if (chain === 'solana') {
      return this.solanaSettlement.getAgentTokenBalance(walletAddress);
    }
    return this.evmSettlement.getAgentUsdcBalance(walletAddress);
  }

  /**
   * Get native balance (gas token) for an agent.
   */
  async getAgentNativeBalance(chain: string, walletAddress: string): Promise<string> {
    if (chain === 'solana') {
      return this.solanaSettlement.getAgentSolBalance(walletAddress);
    }
    return this.evmSettlement.getAgentEthBalance(walletAddress);
  }

  /**
   * Get the platform wallet address for the given chain.
   */
  getPlatformWalletAddress(chain: string): string | null {
    if (chain === 'solana') {
      return this.solanaSettlement.getPlatformWalletAddress();
    }
    return this.evmSettlement.getPlatformWalletAddress();
  }

  /**
   * Escrow funds via the Arena smart contract (EVM only).
   * For Solana, the agent-to-platform transfers act as escrow — this is a no-op.
   */
  async escrow(
    chain: string,
    matchId: string,
    agentAAddress: string,
    agentBAddress: string,
    escrowAmount: bigint,
  ): Promise<string | null> {
    if (chain === 'solana') {
      // No smart contract on Solana — the agent transfers ARE the escrow
      this.logger.log(`Solana escrow is implicit (agent transfers) for match ${matchId}`);
      return null;
    }
    return this.evmSettlement.escrow(matchId, agentAAddress, agentBAddress, escrowAmount);
  }

  /**
   * Release payout via the Arena smart contract (EVM) or direct transfer (Solana).
   */
  async payout(
    chain: string,
    matchId: string,
    winnerAddress: string,
    amount: bigint,
  ): Promise<string | null> {
    if (chain === 'solana') {
      return this.solanaSettlement.transferTokenFromPlatform(winnerAddress, amount);
    }
    return this.evmSettlement.payout(matchId, winnerAddress, amount);
  }

  /**
   * Refund match via the Arena smart contract (EVM) or direct transfers (Solana).
   * For Solana, caller must handle individual refund transfers.
   */
  async refund(
    chain: string,
    matchId: string,
    refundTargets?: Array<{ address: string; amount: bigint }>,
  ): Promise<string | null> {
    if (chain === 'solana') {
      if (!refundTargets?.length) {
        this.logger.warn(`Solana refund for match ${matchId} — no refund targets provided`);
        return null;
      }
      let lastTxSig: string | null = null;
      for (const target of refundTargets) {
        lastTxSig = await this.solanaSettlement.transferTokenFromPlatform(target.address, target.amount);
      }
      return lastTxSig;
    }
    return this.evmSettlement.refund(matchId);
  }
}
