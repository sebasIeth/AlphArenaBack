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
import { erc20Abi } from "./contracts/arena-abi.js";

const logger = pino({ name: "settlement:escrow" });

export interface LockEscrowParams {
  /** Deployed Arena contract address. */
  contractAddress: Address;
  /** USDC token contract address. */
  usdcAddress: Address;
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
  /** Stake amount in USDC smallest unit (6 decimals). */
  stakeAmount: bigint;
}

/**
 * Ensure the Arena contract has sufficient USDC allowance from the operator.
 * If current allowance is less than the required amount, sends an approve tx.
 */
async function ensureUsdcAllowance(params: {
  usdcAddress: Address;
  spender: Address;
  amount: bigint;
  publicClient: PublicClient<HttpTransport, Chain>;
  walletClient: WalletClient<HttpTransport, Chain, PrivateKeyAccount>;
  account: PrivateKeyAccount;
}): Promise<void> {
  const { usdcAddress, spender, amount, publicClient, walletClient, account } = params;

  const currentAllowance = await publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, spender],
  });

  if ((currentAllowance as bigint) >= amount) {
    return;
  }

  logger.info(
    { spender, amount: amount.toString() },
    "Approving USDC spend for Arena contract",
  );

  const { request } = await publicClient.simulateContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
    account,
  });

  const txHash = await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  logger.info({ txHash }, "USDC approval confirmed");
}

/**
 * Lock escrow USDC for a match by calling `escrowFunds` on the Arena contract.
 *
 * Automatically approves USDC spending if the current allowance is insufficient.
 * The transaction is submitted and then we wait for at least one confirmation.
 *
 * @returns The confirmed transaction hash.
 * @throws If the transaction reverts or the receipt indicates failure.
 */
export async function lockEscrow(params: LockEscrowParams): Promise<`0x${string}`> {
  const {
    contractAddress,
    usdcAddress,
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
    "Submitting escrowFunds transaction (USDC)",
  );

  try {
    // Ensure USDC approval before escrow
    await ensureUsdcAllowance({
      usdcAddress,
      spender: contractAddress,
      amount: stakeAmount,
      publicClient,
      walletClient,
      account,
    });

    const { request } = await publicClient.simulateContract({
      address: contractAddress,
      abi: arenaAbi,
      functionName: "escrowFunds",
      args: [matchId, agentAAddress, agentBAddress, stakeAmount],
      account,
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
