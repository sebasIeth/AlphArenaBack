import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../common/config/config.service';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  transfer,
  createTransferInstruction,
  getAccount,
  getMint,
} from '@solana/spl-token';
import * as bs58 from 'bs58';

export type SolanaTokenSymbol = 'ALPHA' | 'USDC';

interface TokenConfig {
  mint: PublicKey;
  decimals: number;
}

@Injectable()
export class SolanaSettlementService implements OnModuleInit {
  private readonly logger = new Logger(SolanaSettlementService.name);
  private connection: Connection | null = null;
  private platformKeypair: Keypair | null = null;
  private feeKeypair: Keypair | null = null;
  private feeWalletAddress: string | null = null;
  private tokens: Map<string, TokenConfig> = new Map();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  private async start(): Promise<void> {
    const rpcUrl = this.configService.solanaRpcUrl;
    const privateKey = this.configService.solanaPrivateKey;
    const alphaMint = this.configService.solanaAlphaMint;

    if (!rpcUrl || !privateKey) {
      this.logger.warn(
        'Solana configuration incomplete (SOLANA_RPC_URL / SOLANA_PRIVATE_KEY). ' +
          'Solana settlement service running in no-op mode.',
      );
      return;
    }

    try {
      this.connection = new Connection(rpcUrl, 'confirmed');
      this.platformKeypair = Keypair.fromSecretKey(bs58.default.decode(privateKey));

      // Fee wallet
      const feeWalletKey = this.configService.solanaFeeWalletKey;
      if (feeWalletKey) {
        this.feeKeypair = Keypair.fromSecretKey(bs58.default.decode(feeWalletKey));
        this.feeWalletAddress = this.feeKeypair.publicKey.toBase58();
        this.logger.log(`Fee wallet: ${this.feeWalletAddress}`);
      } else if (this.configService.solanaFeeWallet) {
        this.feeWalletAddress = this.configService.solanaFeeWallet;
        this.logger.log(`Fee wallet (receive-only): ${this.feeWalletAddress}`);
      }

      // Register ALPHA token
      if (alphaMint) {
        const mint = new PublicKey(alphaMint);
        const mintInfo = await getMint(this.connection, mint);
        this.tokens.set('ALPHA', { mint, decimals: mintInfo.decimals });
        this.logger.log(`ALPHA token: ${alphaMint} (${mintInfo.decimals} decimals)`);
      }

      // Register USDC token
      const usdcMint = this.configService.solanaUsdcMint;
      if (usdcMint) {
        const mint = new PublicKey(usdcMint);
        const mintInfo = await getMint(this.connection, mint);
        this.tokens.set('USDC', { mint, decimals: mintInfo.decimals });
        this.logger.log(`USDC token: ${usdcMint} (${mintInfo.decimals} decimals)`);
      }

      this.logger.log(
        `Solana settlement started — tokens: [${[...this.tokens.keys()].join(', ')}], platform: ${this.platformKeypair.publicKey.toBase58()}`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initialize Solana settlement: ${message}`);
      this.connection = null;
      this.platformKeypair = null;
    }
  }

  private isReady(): boolean {
    return this.connection !== null && this.platformKeypair !== null;
  }

  private getToken(symbol: string): TokenConfig | null {
    return this.tokens.get(symbol) ?? null;
  }

  /**
   * Resolve a token by symbol or mint address.
   */
  private resolveToken(tokenMintOrSymbol: string): TokenConfig | null {
    // Try as symbol first
    const bySymbol = this.tokens.get(tokenMintOrSymbol);
    if (bySymbol) return bySymbol;
    // Try as mint address
    for (const config of this.tokens.values()) {
      if (config.mint.toBase58() === tokenMintOrSymbol) return config;
    }
    return null;
  }

  /**
   * Get token decimals for a given token symbol or mint.
   */
  getTokenDecimals(tokenMintOrSymbol: string = 'ALPHA'): number {
    return this.resolveToken(tokenMintOrSymbol)?.decimals ?? 6;
  }

  /**
   * Get the mint address for a token symbol.
   */
  getTokenMint(symbol: string): string | null {
    return this.getToken(symbol)?.mint.toBase58() ?? null;
  }

  /**
   * Transfer SPL tokens from an agent wallet to a destination.
   * Platform wallet pays tx fees.
   */
  async transferTokenFromAgent(
    agentSecretKeyBase58: string,
    to: string,
    amount: bigint,
    tokenMintOrSymbol: string = 'ALPHA',
  ): Promise<string | null> {
    if (!this.isReady()) {
      this.logger.warn('transferTokenFromAgent skipped — not initialised');
      return null;
    }

    const token = this.resolveToken(tokenMintOrSymbol);
    if (!token) {
      this.logger.error(`Unknown token: ${tokenMintOrSymbol}`);
      return null;
    }

    const agentKeypair = Keypair.fromSecretKey(bs58.default.decode(agentSecretKeyBase58));
    const toPublicKey = new PublicKey(to);

    this.logger.log(
      `Transfer ${tokenMintOrSymbol} from agent ${agentKeypair.publicKey.toBase58()} to ${to}, amount=${amount}`,
    );

    const sourceAta = await getOrCreateAssociatedTokenAccount(
      this.connection!, this.platformKeypair!, token.mint, agentKeypair.publicKey, true,
    );
    const destAta = await getOrCreateAssociatedTokenAccount(
      this.connection!, this.platformKeypair!, token.mint, toPublicKey, true,
    );

    const tx = new Transaction().add(
      createTransferInstruction(sourceAta.address, destAta.address, agentKeypair.publicKey, amount),
    );
    const txSig = await sendAndConfirmTransaction(
      this.connection!, tx, [this.platformKeypair!, agentKeypair],
    );

    this.logger.log(`Transfer confirmed: ${txSig}`);
    return txSig;
  }

  /**
   * Transfer SPL tokens from the platform wallet to a destination.
   */
  async transferTokenFromPlatform(
    to: string,
    amount: bigint,
    tokenMintOrSymbol: string = 'ALPHA',
  ): Promise<string | null> {
    if (!this.isReady()) {
      this.logger.warn('transferTokenFromPlatform skipped — not initialised');
      return null;
    }

    const token = this.resolveToken(tokenMintOrSymbol);
    if (!token) {
      this.logger.error(`Unknown token: ${tokenMintOrSymbol}`);
      return null;
    }

    const toPublicKey = new PublicKey(to);

    this.logger.log(
      `Transfer ${tokenMintOrSymbol} from platform to ${to}, amount=${amount}`,
    );

    const sourceAta = await getOrCreateAssociatedTokenAccount(
      this.connection!, this.platformKeypair!, token.mint, this.platformKeypair!.publicKey, true,
    );
    const destAta = await getOrCreateAssociatedTokenAccount(
      this.connection!, this.platformKeypair!, token.mint, toPublicKey, true,
    );

    const txSig = await transfer(
      this.connection!, this.platformKeypair!, sourceAta.address, destAta.address,
      this.platformKeypair!, amount,
    );

    this.logger.log(`Platform transfer confirmed: ${txSig}`);
    return txSig;
  }

  /**
   * Send platform fee to the dedicated fee wallet.
   */
  async sendFeeToFeeWallet(
    amount: bigint,
    tokenMintOrSymbol: string = 'ALPHA',
  ): Promise<string | null> {
    if (!this.feeWalletAddress) {
      this.logger.warn('No fee wallet configured, fee stays in platform wallet');
      return null;
    }
    return this.transferTokenFromPlatform(this.feeWalletAddress, amount, tokenMintOrSymbol);
  }

  /**
   * Read SPL token balance for an address.
   */
  async getAgentTokenBalance(walletAddress: string, tokenMintOrSymbol: string = 'ALPHA'): Promise<string> {
    if (!this.isReady()) return '0';

    const token = this.resolveToken(tokenMintOrSymbol);
    if (!token) return '0';

    try {
      const owner = new PublicKey(walletAddress);
      const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
      const ataAddress = getAssociatedTokenAddressSync(token.mint, owner, true);
      const accountInfo = await getAccount(this.connection!, ataAddress);
      const rawBalance = accountInfo.amount;
      const divisor = BigInt(10 ** token.decimals);
      const whole = rawBalance / divisor;
      const fraction = rawBalance % divisor;
      const fractionStr = fraction.toString().padStart(token.decimals, '0').replace(/0+$/, '');
      return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
    } catch {
      return '0';
    }
  }

  /**
   * Read SOL balance for an address.
   */
  async getAgentSolBalance(walletAddress: string): Promise<string> {
    if (!this.connection) return '0';
    try {
      const pubkey = new PublicKey(walletAddress);
      const lamports = await this.connection.getBalance(pubkey);
      return (lamports / 1e9).toString();
    } catch {
      return '0';
    }
  }

  getPlatformWalletAddress(): string | null {
    return this.platformKeypair?.publicKey.toBase58() ?? null;
  }

  getFeeWalletAddress(): string | null {
    return this.feeWalletAddress;
  }

  getSupportedTokens(): string[] {
    return [...this.tokens.keys()];
  }

  /**
   * Create ATAs for all registered tokens for a given wallet.
   * Called on user/agent creation so the wallet is ready to receive tokens.
   */
  async ensureTokenAccounts(walletAddress: string): Promise<void> {
    if (!this.isReady()) return;

    const owner = new PublicKey(walletAddress);
    for (const [symbol, token] of this.tokens.entries()) {
      try {
        await getOrCreateAssociatedTokenAccount(
          this.connection!, this.platformKeypair!, token.mint, owner, true,
        );
        this.logger.log(`ATA ensured for ${walletAddress} (${symbol})`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to create ATA for ${walletAddress} (${symbol}): ${message}`);
      }
    }
  }
}
