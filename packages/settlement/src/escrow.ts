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

const logger = pino({ name: "settlement:escrow" });

export interface LockEscrowParams {
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
  /** On-chain address associated with agent A. */
  agentAAddress: Address;
  /** On-chain address associated with agent B. */
  agentBAddress: Address;
  /** Stake amount in the token's smallest unit (wei for ETH). */
  stakeAmount: bigint;
}

/**
 * Lock escrow funds for a match by calling `escrowFunds` on the Arena contract.
 *
 * The transaction is submitted and then we wait for at least one confirmation
 * before returning.
 *
 * @returns The confirmed transaction hash.
 * @throws If the transaction reverts or the receipt indicates failure.
 */
export async function lockEscrow(params: LockEscrowParams): Promise<`0x${string}`> {
  const {
    contractAddress,
    publicClient,
    walletClient,
    account,
    matchId,
    agentAAddress,
    agentBAddress,
    stakeAmount,
  } = params;

  logger.info(
    {
      matchId,
      agentA: agentAAddress,
      agentB: agentBAddress,
      stakeAmount: stakeAmount.toString(),
      contract: contractAddress,
    },
    "Submitting escrowFunds transaction",
  );

  try {
    const { request } = await publicClient.simulateContract({
      address: contractAddress,
      abi: arenaAbi,
      functionName: "escrowFunds",
      args: [matchId, agentAAddress, agentBAddress, stakeAmount],
      account,
      value: stakeAmount,
    });

    const txHash = await walletClient.writeContract(request);

    logger.info({ txHash, matchId }, "escrowFunds transaction sent, waiting for receipt");

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "reverted") {
      throw new Error(`escrowFunds transaction reverted: ${txHash}`);
    }

    logger.info(
      { txHash, blockNumber: receipt.blockNumber.toString(), matchId },
      "escrowFunds confirmed",
    );

    return txHash;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ matchId, error: message }, "Failed to lock escrow");
    throw error;
  }
}
