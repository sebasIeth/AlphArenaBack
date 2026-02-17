import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
  type HttpTransport,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import * as chains from "viem/chains";

export interface SettlementClients {
  publicClient: PublicClient<HttpTransport, Chain>;
  walletClient: WalletClient<HttpTransport, Chain, PrivateKeyAccount>;
  account: PrivateKeyAccount;
}

/**
 * Resolve a viem {@link Chain} definition by its numeric chain ID.
 *
 * Iterates over the named exports of `viem/chains` and returns the first chain
 * whose `id` matches.  Throws if no matching chain is found.
 */
function resolveChain(chainId: number): Chain {
  for (const value of Object.values(chains)) {
    if (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      (value as Chain).id === chainId
    ) {
      return value as Chain;
    }
  }
  throw new Error(
    `Unsupported chain ID: ${chainId}. No matching chain definition found in viem/chains.`,
  );
}

/**
 * Create a pair of viem clients (public + wallet) for on-chain settlement.
 *
 * @param rpcUrl     - JSON-RPC endpoint URL (e.g. an Alchemy / Infura URL).
 * @param privateKey - Hex-encoded private key including the `0x` prefix.
 * @param chainId    - Numeric EVM chain ID (e.g. 1 for mainnet, 11155111 for Sepolia).
 * @returns An object containing `publicClient`, `walletClient`, and the derived `account`.
 */
export function createSettlementClient(
  rpcUrl: string,
  privateKey: string,
  chainId: number,
): SettlementClients {
  const chain = resolveChain(chainId);

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain,
    transport: http(rpcUrl),
    account,
  });

  return { publicClient, walletClient, account };
}
