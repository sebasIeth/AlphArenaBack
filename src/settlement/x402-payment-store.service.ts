import { Injectable } from '@nestjs/common';

export interface VerifiedPayment {
  txSignature: string;
  amount: number;
  token: string;
  verifiedAt: Date;
  gameType: string;
}

/**
 * Singleton in-memory store for x402 verified payments.
 * Shared between X402StakeController (writes) and MatchmakingController (reads).
 */
@Injectable()
export class X402PaymentStore {
  private readonly verifiedPayments = new Map<string, VerifiedPayment>();
  private readonly usedTxHashes = new Map<string, number>();

  private readonly TX_HASH_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
  private readonly PAYMENT_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

  setPayment(agentId: string, payment: VerifiedPayment): void {
    this.verifiedPayments.set(agentId, payment);
    setTimeout(() => this.verifiedPayments.delete(agentId), this.PAYMENT_EXPIRY_MS);
  }

  getPayment(agentId: string): VerifiedPayment | null {
    const p = this.verifiedPayments.get(agentId);
    if (!p) return null;
    if (Date.now() - p.verifiedAt.getTime() > this.PAYMENT_EXPIRY_MS) {
      this.verifiedPayments.delete(agentId);
      return null;
    }
    return p;
  }

  consumePayment(agentId: string): void {
    this.verifiedPayments.delete(agentId);
  }

  isTxUsed(txHash: string): boolean {
    const ts = this.usedTxHashes.get(txHash);
    if (!ts) return false;
    if (Date.now() - ts > this.TX_HASH_EXPIRY_MS) {
      this.usedTxHashes.delete(txHash);
      return false;
    }
    return true;
  }

  markTxUsed(txHash: string): void {
    this.usedTxHashes.set(txHash, Date.now());
  }
}
