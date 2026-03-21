import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../common/config/config.service';
import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Verifies agent stake payments via the x402 protocol before match starts.
 *
 * Flow:
 *   1. Agent pays via x402 → receives payment receipt with tx signature
 *   2. Backend calls verifyStakePayment() with the receipt
 *   3. Service confirms the on-chain tx: correct amount, correct recipient, confirmed status
 */
@Injectable()
export class X402VerifierService {
  private readonly logger = new Logger(X402VerifierService.name);
  private connection: Connection | null = null;

  constructor(private readonly configService: ConfigService) {
    const rpcUrl = this.configService.solanaRpcUrl;
    if (rpcUrl) {
      this.connection = new Connection(rpcUrl, 'confirmed');
    }
  }

  /**
   * Verify an x402 payment receipt by checking the on-chain transaction.
   *
   * @param txSignature - The Solana transaction signature from the x402 receipt
   * @param expectedAmount - Expected payment amount (in smallest token units)
   * @param expectedRecipient - Expected recipient address (platform wallet)
   * @returns true if the transaction is valid and confirmed
   */
  async verifyStakePayment(
    txSignature: string,
    expectedAmount: bigint,
    expectedRecipient: string,
  ): Promise<{ valid: boolean; error?: string }> {
    if (!this.connection) {
      this.logger.warn('x402 verification skipped — Solana connection not available');
      return { valid: true }; // Permissive in no-op mode
    }

    try {
      const tx = await this.connection.getTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        return { valid: false, error: `Transaction ${txSignature} not found or not confirmed` };
      }

      if (tx.meta?.err) {
        return { valid: false, error: `Transaction ${txSignature} failed on-chain: ${JSON.stringify(tx.meta.err)}` };
      }

      // Check post-token balances for the expected recipient
      const recipientPubkey = new PublicKey(expectedRecipient);
      const postBalances = tx.meta?.postTokenBalances ?? [];
      const preBalances = tx.meta?.preTokenBalances ?? [];

      const recipientPost = postBalances.find(
        (b) => b.owner === recipientPubkey.toBase58(),
      );
      const recipientPre = preBalances.find(
        (b) => b.owner === recipientPubkey.toBase58(),
      );

      if (!recipientPost) {
        return { valid: false, error: `Recipient ${expectedRecipient} not found in transaction token balances` };
      }

      const postAmount = BigInt(recipientPost.uiTokenAmount.amount);
      const preAmount = recipientPre ? BigInt(recipientPre.uiTokenAmount.amount) : BigInt(0);
      const receivedAmount = postAmount - preAmount;

      if (receivedAmount < expectedAmount) {
        return {
          valid: false,
          error: `Insufficient payment: expected ${expectedAmount.toString()}, received ${receivedAmount.toString()}`,
        };
      }

      this.logger.log(`x402 payment verified: txSig=${txSignature}, amount=${receivedAmount.toString()}`);
      return { valid: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`x402 verification failed: ${message}`);
      return { valid: false, error: message };
    }
  }
}
