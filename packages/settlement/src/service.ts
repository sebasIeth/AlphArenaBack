import type { Address } from "viem";
import pino from "pino";
import { createSettlementClient, type SettlementClients } from "./client.js";
import { lockEscrow } from "./escrow.js";
import { releasePayout, refundMatch } from "./payout.js";

const logger = pino({ name: "settlement:service" });

/** USDC addresses per chain */
const USDC_BY_CHAIN: Record<number, Address> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  // Base mainnet
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
};

export interface SettlementServiceConfig {
  /** JSON-RPC endpoint URL. Omit to run without blockchain. */
  rpcUrl?: string;
  /** Hex-encoded private key (with 0x prefix). Omit to run without blockchain. */
  privateKey?: string;
  /** Numeric EVM chain ID. Defaults to 84532 (Base Sepolia). */
  chainId?: number;
  /** Deployed Arena contract address. Omit to run without blockchain. */
  contractAddress?: string;
  /** USDC token address. Auto-resolved from chainId if not provided. */
  usdcAddress?: string;
}

/**
 * High-level service that wraps all on-chain settlement operations.
 *
 * All escrow/payout/refund operations use USDC (ERC-20) on Base.
 *
 * When blockchain configuration is not provided (common during local
 * development), every write method logs a warning and returns `null` instead
 * of a transaction hash.  This allows the rest of the platform to operate
 * normally without a live chain.
 */
export class SettlementService {
  private readonly config: SettlementServiceConfig;
  private clients: SettlementClients | null = null;
  private contractAddress: Address | null = null;
  private usdcAddress: Address | null = null;

  constructor(config: SettlementServiceConfig) {
    this.config = config;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Initialise viem clients.  If any required blockchain config value is
   * missing the service enters "no-op" mode and all write operations become
   * safe stubs.
   */
  start(): void {
    const { rpcUrl, privateKey, chainId, contractAddress, usdcAddress } = this.config;

    if (!rpcUrl || !privateKey || !contractAddress) {
      logger.warn(
        "Blockchain configuration incomplete (rpcUrl / privateKey / contractAddress). " +
          "Settlement service running in no-op mode — transactions will not be submitted.",
      );
      return;
    }

    const resolvedChainId = chainId ?? 84532;
    this.clients = createSettlementClient(rpcUrl, privateKey, resolvedChainId);
    this.contractAddress = contractAddress as Address;

    // Resolve USDC address from config or chain ID
    this.usdcAddress = (usdcAddress as Address) ?? USDC_BY_CHAIN[resolvedChainId] ?? null;

    if (!this.usdcAddress) {
      logger.warn(
        { chainId: resolvedChainId },
        "No USDC address configured or known for this chain. Escrow will fail.",
      );
    }

    logger.info(
      {
        chainId: resolvedChainId,
        contract: contractAddress,
        usdc: this.usdcAddress,
        account: this.clients.account.address,
      },
      "Settlement service started (USDC mode)",
    );
  }

  /**
   * Tear down clients and release resources.
   */
  stop(): void {
    this.clients = null;
    this.contractAddress = null;
    this.usdcAddress = null;
    logger.info("Settlement service stopped");
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private isReady(): boolean {
    return this.clients !== null && this.contractAddress !== null && this.usdcAddress !== null;
  }

  /**
   * Convert an application-level match ID string into a bytes32 hex value
   * suitable for the smart contract.  If the value is already a 0x-prefixed
   * 66-char hex string it is returned as-is; otherwise it is right-padded
   * with zeroes.
   */
  private toBytes32(matchId: string): `0x${string}` {
    if (matchId.startsWith("0x") && matchId.length === 66) {
      return matchId as `0x${string}`;
    }
    // Encode as UTF-8 bytes then pad to 32 bytes
    const hex = Buffer.from(matchId, "utf8").toString("hex").slice(0, 64);
    return `0x${hex.padEnd(64, "0")}` as `0x${string}`;
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Lock escrow USDC for a match.
   *
   * @returns The transaction hash, or `null` when running in no-op mode.
   */
  async escrow(
    matchId: string,
    agentAAddress: string,
    agentBAddress: string,
    stakeAmount: bigint,
  ): Promise<string | null> {
    if (!this.isReady()) {
      logger.warn({ matchId }, "escrow skipped — settlement service not initialised");
      return null;
    }

    const { publicClient, walletClient, account } = this.clients!;

    const txHash = await lockEscrow({
      contractAddress: this.contractAddress!,
      usdcAddress: this.usdcAddress!,
      publicClient,
      walletClient,
      account,
      matchId: this.toBytes32(matchId),
      agentAAddress: agentAAddress as Address,
      agentBAddress: agentBAddress as Address,
      stakeAmount,
    });

    return txHash;
  }

  /**
   * Release escrowed USDC to the match winner.
   *
   * @returns The transaction hash, or `null` when running in no-op mode.
   */
  async payout(
    matchId: string,
    winnerAddress: string,
    amount: bigint,
  ): Promise<string | null> {
    if (!this.isReady()) {
      logger.warn({ matchId }, "payout skipped — settlement service not initialised");
      return null;
    }

    const { publicClient, walletClient, account } = this.clients!;

    const txHash = await releasePayout({
      contractAddress: this.contractAddress!,
      publicClient,
      walletClient,
      account,
      matchId: this.toBytes32(matchId),
      winnerAddress: winnerAddress as Address,
      amount,
    });

    return txHash;
  }

  /**
   * Refund both parties of a cancelled / errored match.
   *
   * @returns The transaction hash, or `null` when running in no-op mode.
   */
  async refund(matchId: string): Promise<string | null> {
    if (!this.isReady()) {
      logger.warn({ matchId }, "refund skipped — settlement service not initialised");
      return null;
    }

    const { publicClient, walletClient, account } = this.clients!;

    const txHash = await refundMatch({
      contractAddress: this.contractAddress!,
      publicClient,
      walletClient,
      account,
      matchId: this.toBytes32(matchId),
    });

    return txHash;
  }
}
