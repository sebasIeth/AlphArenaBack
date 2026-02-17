import type {
  PublicClient,
  WalletClient,
  HttpTransport,
  Chain,
  Address,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import pino from "pino";
import { arenaAbi } from "./contracts/arena-abi.js";

const logger = pino({ name: "settlement:payout" });

// ── releasePayout ────────────────────────────────────────────────────

export interface ReleasePayoutParams {
  /** Deployed Arena contract address. */
  contractAddress: Address;
  /** Viem public client for read operations and receipt polling. */
  publicClient: PublicClient<HttpTransport, Chain>;
  /** Viem wallet client for sending transactions. */
  walletClient: WalletClient<HttpTransport, Chain, PrivateKeyAccount>;
  /** The account that will sign the transaction. */
  account: PrivateKeyAccount;
  /** The match identifier (bytes32 hex string). */
  matchId: `0x${string}`;
  /** On-chain address of the match winner. */
  winnerAddress: Address;
  /** Payout amount in the token's smallest unit (wei for ETH). */
  amount: bigint;
}

/**
 * Release escrowed funds to the winner by calling `releasePayout` on the Arena
 * contract.
 *
 * Simulates the call first to surface revert reasons early, then submits the
 * transaction and waits for confirmation.
 *
 * @returns The confirmed transaction hash.
 * @throws If the transaction reverts or the receipt indicates failure.
 */
export async function releasePayout(params: ReleasePayoutParams): Promise<`0x${string}`> {
  const {
    contractAddress,
    publicClient,
    walletClient,
    account,
    matchId,
    winnerAddress,
    amount,
  } = params;

  logger.info(
    {
      matchId,
      winner: winnerAddress,
      amount: amount.toString(),
      contract: contractAddress,
    },
    "Submitting releasePayout transaction",
  );

  try {
    const { request } = await publicClient.simulateContract({
      address: contractAddress,
      abi: arenaAbi,
      functionName: "releasePayout",
      args: [matchId, winnerAddress, amount],
      account,
    });

    const txHash = await walletClient.writeContract(request);

    logger.info({ txHash, matchId }, "releasePayout transaction sent, waiting for receipt");

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "reverted") {
      throw new Error(`releasePayout transaction reverted: ${txHash}`);
    }

    logger.info(
      { txHash, blockNumber: receipt.blockNumber.toString(), matchId },
      "releasePayout confirmed",
    );

    return txHash;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ matchId, error: message }, "Failed to release payout");
    throw error;
  }
}

// ── refundMatch ──────────────────────────────────────────────────────

export interface RefundMatchParams {
  /** Deployed Arena contract address. */
  contractAddress: Address;
  /** Viem public client for read operations and receipt polling. */
  publicClient: PublicClient<HttpTransport, Chain>;
  /** Viem wallet client for sending transactions. */
  walletClient: WalletClient<HttpTransport, Chain, PrivateKeyAccount>;
  /** The account that will sign the transaction. */
  account: PrivateKeyAccount;
  /** The match identifier (bytes32 hex string). */
  matchId: `0x${string}`;
}

/**
 * Refund both parties of a match by calling `refundMatch` on the Arena contract.
 *
 * This is used when a match is cancelled or ends in an unresolvable state.
 *
 * @returns The confirmed transaction hash.
 * @throws If the transaction reverts or the receipt indicates failure.
 */
export async function refundMatch(params: RefundMatchParams): Promise<`0x${string}`> {
  const {
    contractAddress,
    publicClient,
    walletClient,
    account,
    matchId,
  } = params;

  logger.info(
    { matchId, contract: contractAddress },
    "Submitting refundMatch transaction",
  );

  try {
    const { request } = await publicClient.simulateContract({
      address: contractAddress,
      abi: arenaAbi,
      functionName: "refundMatch",
      args: [matchId],
      account,
    });

    const txHash = await walletClient.writeContract(request);

    logger.info({ txHash, matchId }, "refundMatch transaction sent, waiting for receipt");

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "reverted") {
      throw new Error(`refundMatch transaction reverted: ${txHash}`);
    }

    logger.info(
      { txHash, blockNumber: receipt.blockNumber.toString(), matchId },
      "refundMatch confirmed",
    );

    return txHash;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ matchId, error: message }, "Failed to refund match");
    throw error;
  }
}
