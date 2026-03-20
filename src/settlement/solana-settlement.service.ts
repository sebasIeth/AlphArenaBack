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

@Injectable()
export class SolanaSettlementService implements OnModuleInit {
  private readonly logger = new Logger(SolanaSettlementService.name);
  private connection: Connection | null = null;
  private platformKeypair: Keypair | null = null;
  private tokenMint: PublicKey | null = null;
  private tokenDecimals: number = 6;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  private async start(): Promise<void> {
    const rpcUrl = this.configService.solanaRpcUrl;
    const privateKey = this.configService.solanaPrivateKey;
    const tokenMint = this.configService.solanaTokenMint;

    if (!rpcUrl || !privateKey || !tokenMint) {
      this.logger.warn(
        'Solana configuration incomplete (SOLANA_RPC_URL / SOLANA_PRIVATE_KEY / SOLANA_TOKEN_MINT). ' +
          'Solana settlement service running in no-op mode.',
      );
      return;
    }

    try {
      this.connection = new Connection(rpcUrl, 'confirmed');
      this.platformKeypair = Keypair.fromSecretKey(bs58.default.decode(privateKey));
      this.tokenMint = new PublicKey(tokenMint);

      // Read actual decimals from the mint account
      const mintInfo = await getMint(this.connection, this.tokenMint);
      this.tokenDecimals = mintInfo.decimals;

      this.logger.log(
        `Solana settlement service started — mint=${tokenMint}, decimals=${this.tokenDecimals}, account=${this.platformKeypair.publicKey.toBase58()}`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initialize Solana settlement: ${message}`);
      this.connection = null;
      this.platformKeypair = null;
      this.tokenMint = null;
    }
  }

  private isReady(): boolean {
    return this.connection !== null && this.platformKeypair !== null && this.tokenMint !== null;
  }

  /**
   * Transfer SPL tokens from an agent wallet to a destination address.
   * The agent's secret key is provided as a base58 string.
   */
  async transferTokenFromAgent(
    agentSecretKeyBase58: string,
    to: string,
    amount: bigint,
  ): Promise<string | null> {
    if (!this.isReady()) {
      this.logger.warn('transferTokenFromAgent skipped — Solana settlement not initialised');
      return null;
    }

    const agentKeypair = Keypair.fromSecretKey(bs58.default.decode(agentSecretKeyBase58));
    const toPublicKey = new PublicKey(to);

    this.logger.log(
      `Transferring SPL token from agent ${agentKeypair.publicKey.toBase58()} to ${to}, amount=${amount.toString()}`,
    );

    // Get or create ATAs — platform wallet pays rent for destination ATA
    const sourceAta = await getOrCreateAssociatedTokenAccount(
      this.connection!,
      this.platformKeypair!, // payer for ATA creation
      this.tokenMint!,
      agentKeypair.publicKey,
    );

    const destAta = await getOrCreateAssociatedTokenAccount(
      this.connection!,
      this.platformKeypair!, // payer for ATA creation
      this.tokenMint!,
      toPublicKey,
    );

    // Platform pays tx fee, agent signs as token authority
    const tx = new Transaction().add(
      createTransferInstruction(
        sourceAta.address,
        destAta.address,
        agentKeypair.publicKey, // owner/authority of source
        amount,
      ),
    );
    const txSig = await sendAndConfirmTransaction(
      this.connection!,
      tx,
      [this.platformKeypair!, agentKeypair], // platform=feePayer, agent=authority
    );

    this.logger.log(`SPL token transfer confirmed: txSig=${txSig}`);
    return txSig;
  }

  /**
   * Transfer SPL tokens from the platform wallet to a destination address.
   */
  async transferTokenFromPlatform(
    to: string,
    amount: bigint,
  ): Promise<string | null> {
    if (!this.isReady()) {
      this.logger.warn('transferTokenFromPlatform skipped — Solana settlement not initialised');
      return null;
    }

    const toPublicKey = new PublicKey(to);

    this.logger.log(
      `Transferring SPL token from platform ${this.platformKeypair!.publicKey.toBase58()} to ${to}, amount=${amount.toString()}`,
    );

    const sourceAta = await getOrCreateAssociatedTokenAccount(
      this.connection!,
      this.platformKeypair!,
      this.tokenMint!,
      this.platformKeypair!.publicKey,
    );

    const destAta = await getOrCreateAssociatedTokenAccount(
      this.connection!,
      this.platformKeypair!,
      this.tokenMint!,
      toPublicKey,
    );

    const txSig = await transfer(
      this.connection!,
      this.platformKeypair!, // payer
      sourceAta.address,
      destAta.address,
      this.platformKeypair!, // owner/authority
      amount,
    );

    this.logger.log(`SPL platform transfer confirmed: txSig=${txSig}`);
    return txSig;
  }

  /**
   * Read SPL token balance for an address.
   * Returns a human-readable string (e.g. "100.5").
   */
  async getAgentTokenBalance(walletAddress: string): Promise<string> {
    if (!this.isReady()) return '0';

    try {
      const owner = new PublicKey(walletAddress);
      const ata = await getOrCreateAssociatedTokenAccount(
        this.connection!,
        this.platformKeypair!,
        this.tokenMint!,
        owner,
      );
      const accountInfo = await getAccount(this.connection!, ata.address);
      const rawBalance = accountInfo.amount;
      const divisor = BigInt(10 ** this.tokenDecimals);
      const whole = rawBalance / divisor;
      const fraction = rawBalance % divisor;
      const fractionStr = fraction.toString().padStart(this.tokenDecimals, '0').replace(/0+$/, '');
      return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
    } catch {
      return '0';
    }
  }

  /**
   * Read SOL balance for an address (needed for tx fees).
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

  /**
   * Get the platform wallet address (base58).
   */
  getPlatformWalletAddress(): string | null {
    return this.platformKeypair?.publicKey.toBase58() ?? null;
  }

  /**
   * Get the SPL token decimals (read from mint on init).
   */
  getTokenDecimals(): number {
    return this.tokenDecimals;
  }
}
