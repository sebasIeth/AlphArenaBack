import {
  Controller, Post, Body, Headers, Res, HttpStatus, Logger,
  BadRequestException, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthPayload } from '../common/types';
import { X402VerifierService } from './x402-verifier.service';
import { SolanaSettlementService } from './solana-settlement.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent } from '../database/schemas';

/**
 * x402 Payment endpoint for USDC stakes.
 *
 * Flow:
 * 1. Agent POST /x402/stake with { agentId, stakeAmount, gameType }
 *    → Backend responds 402 with payment requirements (amount, recipient, token)
 *
 * 2. Agent pays USDC to the platform wallet (on-chain SPL transfer)
 *
 * 3. Agent POST /x402/stake again with X-PAYMENT-TX header containing the tx signature
 *    → Backend verifies on-chain, records payment, returns { paid: true, txSignature }
 *
 * The verified payment receipt is then used when joining the matchmaking queue
 * to skip the normal balance check for USDC matches.
 */
@Controller('x402')
@UseGuards(JwtAuthGuard)
export class X402StakeController {
  private readonly logger = new Logger(X402StakeController.name);
  // In-memory store of verified payments: agentId → { txSignature, amount, token, verifiedAt }
  private readonly verifiedPayments = new Map<string, {
    txSignature: string;
    amount: number;
    token: string;
    verifiedAt: Date;
    gameType: string;
  }>();
  // Track used tx hashes to prevent replay attacks (with timestamps for expiry)
  private readonly usedTxHashes = new Map<string, number>();

  private readonly TX_HASH_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly x402Verifier: X402VerifierService,
    private readonly solanaSettlement: SolanaSettlementService,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
  ) {
    // Periodically clean up expired tx hashes every 10 minutes
    setInterval(() => this.cleanupExpiredTxHashes(), 10 * 60 * 1000);
  }

  private cleanupExpiredTxHashes(): void {
    const now = Date.now();
    for (const [hash, timestamp] of this.usedTxHashes) {
      if (now - timestamp > this.TX_HASH_EXPIRY_MS) {
        this.usedTxHashes.delete(hash);
      }
    }
  }

  /**
   * x402-style stake payment endpoint.
   *
   * Without X-PAYMENT-TX header → returns 402 with payment requirements
   * With X-PAYMENT-TX header → verifies payment and returns receipt
   */
  @Post('stake')
  async stake(
    @CurrentUser() user: AuthPayload,
    @Body() body: { agentId: string; stakeAmount: number; gameType: string },
    @Headers('x-payment-tx') paymentTx: string | undefined,
    @Res() res: Response,
  ) {
    const { agentId, stakeAmount, gameType } = body;

    if (!agentId || !stakeAmount || !gameType) {
      throw new BadRequestException('agentId, stakeAmount, and gameType are required');
    }

    // Verify agent ownership
    const agent = await this.agentModel.findById(agentId);
    if (!agent) throw new BadRequestException('Agent not found');
    if (agent.userId.toString() !== user.userId) throw new BadRequestException('You do not own this agent');

    const platformWallet = this.solanaSettlement.getPlatformWalletAddress();
    const usdcMint = this.solanaSettlement.getTokenMint('USDC');
    const usdcDecimals = this.solanaSettlement.getTokenDecimals('USDC');

    if (!platformWallet || !usdcMint) {
      throw new BadRequestException('USDC payments not configured on this server');
    }

    // No payment proof → return 402 with requirements
    if (!paymentTx) {
      const amountAtomic = stakeAmount * (10 ** usdcDecimals);

      this.logger.log(`x402: returning payment requirements for agent ${agentId}, amount=${stakeAmount} USDC`);

      return res.status(HttpStatus.PAYMENT_REQUIRED).json({
        protocol: 'x402',
        version: '1.0',
        payment: {
          token: 'USDC',
          tokenMint: usdcMint,
          network: 'solana',
          recipient: platformWallet,
          amount: amountAtomic,
          amountHuman: stakeAmount,
          decimals: usdcDecimals,
          description: `Stake ${stakeAmount} USDC for ${gameType} match`,
        },
        instructions: {
          method: 'POST',
          header: 'X-PAYMENT-TX',
          description: 'Transfer USDC to the recipient address, then resend this request with the tx signature in the X-PAYMENT-TX header',
        },
      });
    }

    // Has payment proof → verify on-chain
    // Prevent replay: same tx can't be used twice
    const txTimestamp = this.usedTxHashes.get(paymentTx);
    if (txTimestamp !== undefined && Date.now() - txTimestamp < this.TX_HASH_EXPIRY_MS) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        paid: false,
        error: 'This transaction has already been used for a payment. Send a new transaction.',
      });
    }

    this.logger.log(`x402: verifying payment tx=${paymentTx} for agent ${agentId}`);

    const expectedAmount = BigInt(stakeAmount) * BigInt(10 ** usdcDecimals);
    const verification = await this.x402Verifier.verifyStakePayment(
      paymentTx,
      expectedAmount,
      platformWallet,
    );

    if (!verification.valid) {
      this.logger.warn(`x402: payment verification failed: ${verification.error}`);
      return res.status(HttpStatus.BAD_REQUEST).json({
        paid: false,
        error: verification.error,
      });
    }

    // Mark tx as used (prevent replay)
    this.usedTxHashes.set(paymentTx, Date.now());

    // Store verified payment
    this.verifiedPayments.set(agentId, {
      txSignature: paymentTx,
      amount: stakeAmount,
      token: 'USDC',
      verifiedAt: new Date(),
      gameType,
    });

    // Auto-expire after 10 minutes
    setTimeout(() => this.verifiedPayments.delete(agentId), 10 * 60 * 1000);

    this.logger.log(`x402: payment verified for agent ${agentId}, tx=${paymentTx}`);

    return res.status(HttpStatus.OK).json({
      paid: true,
      txSignature: paymentTx,
      amount: stakeAmount,
      token: 'USDC',
      agentId,
      gameType,
      expiresIn: '10m',
    });
  }

  /**
   * Check if an agent has a verified x402 payment.
   * Used by matchmaking to skip balance checks for pre-paid USDC stakes.
   */
  getVerifiedPayment(agentId: string): { txSignature: string; amount: number; token: string; gameType: string } | null {
    const payment = this.verifiedPayments.get(agentId);
    if (!payment) return null;

    // Check if expired (10 min)
    if (Date.now() - payment.verifiedAt.getTime() > 10 * 60 * 1000) {
      this.verifiedPayments.delete(agentId);
      return null;
    }

    return payment;
  }

  /**
   * Consume a verified payment (called after match starts successfully).
   */
  consumePayment(agentId: string): void {
    this.verifiedPayments.delete(agentId);
  }
}
