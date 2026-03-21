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
import { X402PaymentStore } from './x402-payment-store.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent } from '../database/schemas';

@Controller('x402')
@UseGuards(JwtAuthGuard)
export class X402StakeController {
  private readonly logger = new Logger(X402StakeController.name);

  constructor(
    private readonly x402Verifier: X402VerifierService,
    private readonly solanaSettlement: SolanaSettlementService,
    private readonly paymentStore: X402PaymentStore,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
  ) {}

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

    const agent = await this.agentModel.findById(agentId);
    if (!agent) throw new BadRequestException('Agent not found');
    if (agent.userId.toString() !== user.userId) throw new BadRequestException('You do not own this agent');

    const platformWallet = this.solanaSettlement.getPlatformWalletAddress();
    const usdcMint = this.solanaSettlement.getTokenMint('USDC');
    const usdcDecimals = this.solanaSettlement.getTokenDecimals('USDC');

    if (!platformWallet || !usdcMint) {
      throw new BadRequestException('USDC payments not configured on this server');
    }

    // No payment proof → return 402
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

    // Replay check
    if (this.paymentStore.isTxUsed(paymentTx)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        paid: false,
        error: 'This transaction has already been used for a payment. Send a new transaction.',
      });
    }

    this.logger.log(`x402: verifying payment tx=${paymentTx} for agent ${agentId}`);

    const expectedAmount = BigInt(stakeAmount) * BigInt(10 ** usdcDecimals);
    const verification = await this.x402Verifier.verifyStakePayment(paymentTx, expectedAmount, platformWallet);

    if (!verification.valid) {
      this.logger.warn(`x402: payment verification failed: ${verification.error}`);
      return res.status(HttpStatus.BAD_REQUEST).json({ paid: false, error: verification.error });
    }

    // Mark tx as used and store verified payment
    this.paymentStore.markTxUsed(paymentTx);
    this.paymentStore.setPayment(agentId, {
      txSignature: paymentTx,
      amount: stakeAmount,
      token: 'USDC',
      verifiedAt: new Date(),
      gameType,
    });

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
}
