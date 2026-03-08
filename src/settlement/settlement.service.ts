import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '../common/config/config.service';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  formatUnits,
  type Chain,
  type PublicClient,
  type WalletClient,
  type HttpTransport,
  type Address,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import * as chains from 'viem/chains';
import { arenaAbi, erc20Abi } from './contracts/arena-abi';
import { type ChainName } from '../common/constants/game.constants';

interface ChainClients {
  publicClient: PublicClient<HttpTransport, Chain>;
  walletClient: WalletClient<HttpTransport, Chain, PrivateKeyAccount>;
  account: PrivateKeyAccount;
  contractAddress: Address;
  alphaAddress: Address;
  rpcUrl: string;
  chain: Chain;
  chainName: ChainName;
}

@Injectable()
export class SettlementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementService.name);
  private readonly chainClients = new Map<ChainName, ChainClients>();

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  private start(): void {
    this.initChain('base', {
      rpcUrl: this.configService.rpcUrl,
      privateKey: this.configService.privateKey,
      contractAddress: this.configService.contractAddress,
      alphaAddress: this.configService.alphaAddress,
      chainId: this.configService.chainId,
    });

    this.initChain('celo', {
      rpcUrl: this.configService.celoRpcUrl,
      privateKey: this.configService.celoPrivateKey,
      contractAddress: this.configService.celoContractAddress,
      alphaAddress: this.configService.celoAlphaAddress,
      chainId: this.configService.celoChainId,
    });
  }

  private initChain(
    chainName: ChainName,
    config: {
      rpcUrl?: string;
      privateKey?: string;
      contractAddress?: string;
      alphaAddress?: string;
      chainId: number;
    },
  ): void {
    const { rpcUrl, privateKey, contractAddress, alphaAddress, chainId } = config;

    if (!rpcUrl || !privateKey || !contractAddress || !alphaAddress) {
      this.logger.warn(
        `[${chainName}] Blockchain configuration incomplete — settlement running in no-op mode for this chain.`,
      );
      return;
    }

    const chain = this.resolveChain(chainId);
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account });

    this.chainClients.set(chainName, {
      publicClient,
      walletClient,
      account,
      contractAddress: contractAddress as Address,
      alphaAddress: alphaAddress as Address,
      rpcUrl,
      chain,
      chainName,
    });

    this.logger.log(
      `[${chainName}] Settlement started — chainId=${chainId}, contract=${contractAddress}, alpha=${alphaAddress}, account=${account.address}`,
    );
  }

  private stop(): void {
    this.chainClients.clear();
    this.logger.log('Settlement service stopped');
  }

  private resolveChain(chainId: number): Chain {
    for (const value of Object.values(chains)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        (value as Chain).id === chainId
      ) {
        return value as Chain;
      }
    }
    throw new Error(
      `Unsupported chain ID: ${chainId}. No matching chain definition found in viem/chains.`,
    );
  }

  private getClients(chainName: ChainName): ChainClients | null {
    return this.chainClients.get(chainName) ?? null;
  }

  private isReady(chainName: ChainName): boolean {
    return this.chainClients.has(chainName);
  }

  toBytes32(matchId: string): `0x${string}` {
    if (matchId.startsWith('0x') && matchId.length === 66) {
      return matchId as `0x${string}`;
    }
    const hex = Buffer.from(matchId, 'utf8').toString('hex').slice(0, 64);
    return `0x${hex.padEnd(64, '0')}` as `0x${string}`;
  }

  private async ensureAlphaAllowance(
    clients: ChainClients,
    spender: Address,
    amount: bigint,
  ): Promise<void> {
    const { publicClient, walletClient, account, alphaAddress } = clients;

    const currentAllowance = await publicClient.readContract({
      address: alphaAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, spender],
    });

    if ((currentAllowance as bigint) >= amount) return;

    const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

    this.logger.log(`[${clients.chainName}] Approving max ALPHA spend for contract: spender=${spender}`);

    const { request } = await publicClient.simulateContract({
      address: alphaAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, maxApproval],
      account,
    });

    const txHash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 2 });

    this.logger.log(`[${clients.chainName}] ALPHA max approval confirmed: txHash=${txHash}`);
  }

  // ── Public API ───────────────────────────────────────────────────

  async escrow(
    matchId: string,
    agentAAddress: string,
    agentBAddress: string,
    stakeAmount: bigint,
    chainName: ChainName = 'base',
  ): Promise<string | null> {
    const clients = this.getClients(chainName);
    if (!clients) {
      this.logger.warn(`[${chainName}] escrow skipped — not initialised (matchId=${matchId})`);
      return null;
    }

    const { publicClient, walletClient, account, contractAddress } = clients;
    const matchIdBytes32 = this.toBytes32(matchId);

    this.logger.log(
      `[${chainName}] Submitting escrowFunds: matchId=${matchId}, agentA=${agentAAddress}, agentB=${agentBAddress}, stake=${stakeAmount}`,
    );

    try {
      await this.ensureAlphaAllowance(clients, contractAddress, stakeAmount);

      const { request } = await publicClient.simulateContract({
        address: contractAddress,
        abi: arenaAbi,
        functionName: 'escrowFunds',
        args: [matchIdBytes32, agentAAddress as Address, agentBAddress as Address, stakeAmount],
        account,
      });

      const txHash = await walletClient.writeContract(request);
      this.logger.log(`[${chainName}] escrowFunds sent: txHash=${txHash}, matchId=${matchId}`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status === 'reverted') throw new Error(`escrowFunds reverted: ${txHash}`);

      this.logger.log(`[${chainName}] escrowFunds confirmed: txHash=${txHash}, block=${receipt.blockNumber}`);
      return txHash;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${chainName}] Failed to lock escrow: matchId=${matchId}, error=${message}`);
      throw error;
    }
  }

  async payout(
    matchId: string,
    winnerAddress: string,
    amount: bigint,
    chainName: ChainName = 'base',
  ): Promise<string | null> {
    const clients = this.getClients(chainName);
    if (!clients) {
      this.logger.warn(`[${chainName}] payout skipped — not initialised (matchId=${matchId})`);
      return null;
    }

    const { publicClient, walletClient, account, contractAddress } = clients;
    const matchIdBytes32 = this.toBytes32(matchId);

    this.logger.log(`[${chainName}] Submitting releasePayout: matchId=${matchId}, winner=${winnerAddress}, amount=${amount}`);

    try {
      const { request } = await publicClient.simulateContract({
        address: contractAddress,
        abi: arenaAbi,
        functionName: 'releasePayout',
        args: [matchIdBytes32, winnerAddress as Address, amount],
        account,
      });

      const txHash = await walletClient.writeContract(request);
      this.logger.log(`[${chainName}] releasePayout sent: txHash=${txHash}, matchId=${matchId}`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status === 'reverted') throw new Error(`releasePayout reverted: ${txHash}`);

      this.logger.log(`[${chainName}] releasePayout confirmed: txHash=${txHash}, block=${receipt.blockNumber}`);
      return txHash;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${chainName}] Failed to release payout: matchId=${matchId}, error=${message}`);
      throw error;
    }
  }

  async refund(
    matchId: string,
    chainName: ChainName = 'base',
  ): Promise<string | null> {
    const clients = this.getClients(chainName);
    if (!clients) {
      this.logger.warn(`[${chainName}] refund skipped — not initialised (matchId=${matchId})`);
      return null;
    }

    const { publicClient, walletClient, account, contractAddress } = clients;
    const matchIdBytes32 = this.toBytes32(matchId);

    this.logger.log(`[${chainName}] Submitting refundMatch: matchId=${matchId}`);

    try {
      const { request } = await publicClient.simulateContract({
        address: contractAddress,
        abi: arenaAbi,
        functionName: 'refundMatch',
        args: [matchIdBytes32],
        account,
      });

      const txHash = await walletClient.writeContract(request);
      this.logger.log(`[${chainName}] refundMatch sent: txHash=${txHash}, matchId=${matchId}`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status === 'reverted') throw new Error(`refundMatch reverted: ${txHash}`);

      this.logger.log(`[${chainName}] refundMatch confirmed: txHash=${txHash}, block=${receipt.blockNumber}`);
      return txHash;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${chainName}] Failed to refund: matchId=${matchId}, error=${message}`);
      throw error;
    }
  }

  // ── Agent Wallet Operations ───────────────────────────────────────

  async getAgentAlphaBalance(walletAddress: string, chainName: ChainName = 'base'): Promise<string> {
    const clients = this.getClients(chainName);
    if (!clients) return '0';

    const balance = await clients.publicClient.readContract({
      address: clients.alphaAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [walletAddress as Address],
    });

    return formatUnits(balance as bigint, 18);
  }

  async getAgentEthBalance(walletAddress: string, chainName: ChainName = 'base'): Promise<string> {
    const clients = this.getClients(chainName);
    if (!clients) return '0';

    const balance = await clients.publicClient.getBalance({
      address: walletAddress as Address,
    });

    return formatEther(balance);
  }

  async transferAlphaFromAgent(
    agentPrivateKey: string,
    to: string,
    amount: bigint,
    chainName: ChainName = 'base',
  ): Promise<string | null> {
    const clients = this.getClients(chainName);
    if (!clients) {
      this.logger.warn(`[${chainName}] transferAlphaFromAgent skipped — not initialised`);
      return null;
    }

    const { publicClient, alphaAddress, chain, rpcUrl } = clients;
    const agentAccount = privateKeyToAccount(agentPrivateKey as `0x${string}`);
    const agentWalletClient = createWalletClient({
      chain,
      transport: http(rpcUrl),
      account: agentAccount,
    });

    this.logger.log(
      `[${chainName}] Transferring ALPHA from ${agentAccount.address} to ${to}, amount=${amount}`,
    );

    const { request } = await publicClient.simulateContract({
      address: alphaAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to as Address, amount],
      account: agentAccount,
    });

    const txHash = await agentWalletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    this.logger.log(`[${chainName}] ALPHA transfer confirmed: txHash=${txHash}`);
    return txHash;
  }

  getPlatformWalletAddress(chainName: ChainName = 'base'): string | null {
    return this.getClients(chainName)?.account.address ?? null;
  }

  getConfiguredChains(): ChainName[] {
    return [...this.chainClients.keys()];
  }

  // ── Betting Views ───────────────────────────────────────────────────

  async getMatchOnChainState(matchId: string, chainName: ChainName = 'base'): Promise<number | null> {
    const clients = this.getClients(chainName);
    if (!clients) return null;

    const result = await clients.publicClient.readContract({
      address: clients.contractAddress,
      abi: arenaAbi,
      functionName: 'getMatchState',
      args: [this.toBytes32(matchId)],
    });
    return Number(result);
  }

  async getMatchInfo(matchId: string, chainName: ChainName = 'base'): Promise<{
    agentA: string; agentB: string; amount: string; state: number;
  } | null> {
    const clients = this.getClients(chainName);
    if (!clients) return null;

    const result = await clients.publicClient.readContract({
      address: clients.contractAddress,
      abi: arenaAbi,
      functionName: 'getMatchInfo',
      args: [this.toBytes32(matchId)],
    }) as [string, string, bigint, number];

    return {
      agentA: result[0],
      agentB: result[1],
      amount: formatUnits(result[2], 18),
      state: Number(result[3]),
    };
  }

  async getBettingPool(matchId: string, chainName: ChainName = 'base'): Promise<{
    totalBetsA: string; totalBetsB: string; netPool: string; noContest: boolean;
  } | null> {
    const clients = this.getClients(chainName);
    if (!clients) return null;

    const result = await clients.publicClient.readContract({
      address: clients.contractAddress,
      abi: arenaAbi,
      functionName: 'getBettingPool',
      args: [this.toBytes32(matchId)],
    }) as [bigint, bigint, bigint, boolean];

    return {
      totalBetsA: formatUnits(result[0], 18),
      totalBetsB: formatUnits(result[1], 18),
      netPool: formatUnits(result[2], 18),
      noContest: result[3],
    };
  }

  async getUserBets(matchId: string, userAddress: string, chainName: ChainName = 'base'): Promise<{
    betOnA: string; betOnB: string; claimed: boolean;
  } | null> {
    const clients = this.getClients(chainName);
    if (!clients) return null;

    const result = await clients.publicClient.readContract({
      address: clients.contractAddress,
      abi: arenaAbi,
      functionName: 'getUserBets',
      args: [this.toBytes32(matchId), userAddress as Address],
    }) as [bigint, bigint, boolean];

    return {
      betOnA: formatUnits(result[0], 18),
      betOnB: formatUnits(result[1], 18),
      claimed: result[2],
    };
  }

  async placeBet(
    matchId: string,
    userPrivateKey: string,
    onAgentA: boolean,
    amount: bigint,
    chainName: ChainName = 'base',
  ): Promise<string | null> {
    const clients = this.getClients(chainName);
    if (!clients) {
      this.logger.warn(`[${chainName}] placeBet skipped — not initialised (matchId=${matchId})`);
      return null;
    }

    const { publicClient, contractAddress, alphaAddress, chain, rpcUrl } = clients;
    const userAccount = privateKeyToAccount(userPrivateKey as `0x${string}`);
    const userWalletClient = createWalletClient({ chain, transport: http(rpcUrl), account: userAccount });

    // Approve ALPHA spend
    const currentAllowance = await publicClient.readContract({
      address: alphaAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [userAccount.address, contractAddress],
    });

    if ((currentAllowance as bigint) < amount) {
      const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
      const { request: approveReq } = await publicClient.simulateContract({
        address: alphaAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [contractAddress, maxApproval],
        account: userAccount,
      });
      const approveTx = await userWalletClient.writeContract(approveReq);
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
    }

    const matchIdBytes32 = this.toBytes32(matchId);

    this.logger.log(`[${chainName}] placeBet: matchId=${matchId}, user=${userAccount.address}, onAgentA=${onAgentA}, amount=${amount}`);

    const { request } = await publicClient.simulateContract({
      address: contractAddress,
      abi: arenaAbi,
      functionName: 'placeBet',
      args: [matchIdBytes32, onAgentA, amount],
      account: userAccount,
    });

    const txHash = await userWalletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    this.logger.log(`[${chainName}] placeBet confirmed: txHash=${txHash}`);
    return txHash;
  }

  async claimBet(
    matchId: string,
    userPrivateKey: string,
    chainName: ChainName = 'base',
  ): Promise<string | null> {
    const clients = this.getClients(chainName);
    if (!clients) {
      this.logger.warn(`[${chainName}] claimBet skipped — not initialised (matchId=${matchId})`);
      return null;
    }

    const { publicClient, contractAddress, chain, rpcUrl } = clients;
    const userAccount = privateKeyToAccount(userPrivateKey as `0x${string}`);
    const userWalletClient = createWalletClient({ chain, transport: http(rpcUrl), account: userAccount });

    const matchIdBytes32 = this.toBytes32(matchId);

    this.logger.log(`[${chainName}] claimBet: matchId=${matchId}, user=${userAccount.address}`);

    const { request } = await publicClient.simulateContract({
      address: contractAddress,
      abi: arenaAbi,
      functionName: 'claimBet',
      args: [matchIdBytes32],
      account: userAccount,
    });

    const txHash = await userWalletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    this.logger.log(`[${chainName}] claimBet confirmed: txHash=${txHash}`);
    return txHash;
  }

  getContractAddress(chainName: ChainName = 'base'): string | null {
    return this.getClients(chainName)?.contractAddress ?? null;
  }

  getAlphaAddress(chainName: ChainName = 'base'): string | null {
    return this.getClients(chainName)?.alphaAddress ?? null;
  }
}
