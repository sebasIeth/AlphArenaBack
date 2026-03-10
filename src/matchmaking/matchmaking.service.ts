import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MatchmakingQueue, QueueEntryData } from './matchmaking.queue';
import { findPairs } from './pairing';
import { Agent } from '../database/schemas';
import { MATCHMAKING_INTERVAL_MS, MATCHMAKING_COUNTDOWN_MS } from '../common/constants/game.constants';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { EventBusService } from '../orchestrator/event-bus.service';
import { MatchAgentInput } from '../orchestrator/match-manager.service';

const POKER_MIN_PLAYERS = 2;
const POKER_MAX_PLAYERS = 9;
const POKER_LOBBY_COUNTDOWN_MS = 30_000;

export interface PokerLobbyPlayer {
  agentId: string;
  userId: string;
  name: string;
  eloRating: number;
  stakeAmount: number;
  agentType?: string;
  joinedAt: Date;
}

export interface PokerLobbyState {
  players: PokerLobbyPlayer[];
  countdownStartedAt: number | null;
  stakeAmount: number;
}

@Injectable()
export class MatchmakingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchmakingService.name);
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private onPairedCallback: ((agentA: string, agentB: string, stakeAmount: number, gameType: string, chain: string) => Promise<string>) | null = null;
  private onPokerLobbyReadyCallback: ((players: MatchAgentInput[], stakeAmount: number, chain: string) => Promise<string>) | null = null;
  private readonly countdowns = new Map<string, { startedAt: number }>();

  // Poker lobby: single lobby (could be extended to multiple stake levels)
  private readonly pokerLobby: PokerLobbyState = {
    players: [],
    countdownStartedAt: null,
    stakeAmount: 0,
  };

  constructor(
    private readonly queue: MatchmakingQueue,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    private readonly orchestrator: OrchestratorService,
    private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit() {
    await this.queue.loadFromDatabase();

    this.setOnPairedCallback(async (agentAId, agentBId, stakeAmount, gameType, chain) => {
      const [agentA, agentB] = await Promise.all([
        this.agentModel.findById(agentAId),
        this.agentModel.findById(agentBId),
      ]);
      if (!agentA || !agentB) throw new Error(`Agent not found: A=${agentAId}, B=${agentBId}`);

      return this.orchestrator.startMatch(
        {
          agentId: agentA._id.toString(),
          userId: agentA.userId.toString(),
          name: agentA.name,
          endpointUrl: agentA.endpointUrl ?? '',
          eloRating: agentA.eloRating,
          type: agentA.type,
          openclawUrl: agentA.openclawUrl,
          openclawToken: agentA.openclawToken,
          openclawAgentId: agentA.openclawAgentId,
        },
        {
          agentId: agentB._id.toString(),
          userId: agentB.userId.toString(),
          name: agentB.name,
          endpointUrl: agentB.endpointUrl ?? '',
          eloRating: agentB.eloRating,
          type: agentB.type,
          openclawUrl: agentB.openclawUrl,
          openclawToken: agentB.openclawToken,
          openclawAgentId: agentB.openclawAgentId,
        },
        stakeAmount,
        gameType,
        chain,
      );
    });

    this.setOnPokerLobbyReadyCallback(async (players, stakeAmount, chain) => {
      return this.orchestrator.startPokerMatch(players, stakeAmount, chain);
    });

    this.logger.log(`Matchmaking service started, queue size: ${this.queue.size()}`);
    this.intervalId = setInterval(() => { void this.processPairing(); }, MATCHMAKING_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.countdowns.clear();
    this.logger.log('Matchmaking service stopped');
  }

  setOnPairedCallback(cb: (agentA: string, agentB: string, stakeAmount: number, gameType: string, chain: string) => Promise<string>) {
    this.onPairedCallback = cb;
  }

  setOnPokerLobbyReadyCallback(cb: (players: MatchAgentInput[], stakeAmount: number, chain: string) => Promise<string>) {
    this.onPokerLobbyReadyCallback = cb;
  }

  // ─── Standard Queue (chess/marrakech) ─────────────────

  async joinQueue(agentId: string, userId: string, eloRating: number, stakeAmount: number, gameType: string, agentType?: string, chain: string = 'base'): Promise<void> {
    if (gameType === 'poker') {
      await this.joinPokerLobby(agentId, userId, eloRating, stakeAmount, agentType);
      return;
    }

    const entry: QueueEntryData = { agentId, userId, eloRating, stakeAmount, gameType, chain, status: 'waiting', joinedAt: new Date(), agentType };
    await this.queue.add(entry);
    this.logger.log(`Agent ${agentId} joined matchmaking queue`);
    this.eventBus.emit('matchmaking:queue_joined', { agentId, gameType, agentType });
  }

  async leaveQueue(agentId: string): Promise<void> {
    // Check poker lobby first
    const lobbyIdx = this.pokerLobby.players.findIndex(p => p.agentId === agentId);
    if (lobbyIdx !== -1) {
      this.pokerLobby.players.splice(lobbyIdx, 1);
      this.logger.log(`Agent ${agentId} left poker lobby`);
      // If lobby dropped below min, cancel countdown
      if (this.pokerLobby.players.length < POKER_MIN_PLAYERS) {
        this.pokerLobby.countdownStartedAt = null;
      }
      this.emitPokerLobbyUpdate();
      return;
    }

    await this.queue.remove(agentId);
    this.logger.log(`Agent ${agentId} left matchmaking queue`);
  }

  async getQueueStatus(agentId: string): Promise<QueueEntryData | undefined> {
    // Check poker lobby
    const lobbyPlayer = this.pokerLobby.players.find(p => p.agentId === agentId);
    if (lobbyPlayer) {
      return {
        agentId: lobbyPlayer.agentId,
        userId: lobbyPlayer.userId,
        eloRating: lobbyPlayer.eloRating,
        stakeAmount: lobbyPlayer.stakeAmount,
        gameType: 'poker',
        status: 'waiting',
        joinedAt: lobbyPlayer.joinedAt,
        agentType: lobbyPlayer.agentType,
        chain: 'base',
      };
    }
    return this.queue.get(agentId);
  }

  async getQueueSize(gameType?: string): Promise<number> {
    if (gameType === 'poker') return this.pokerLobby.players.length;
    if (gameType) return this.queue.getWaiting(gameType).length;
    return this.queue.size() + this.pokerLobby.players.length;
  }

  getQueueEntries(gameType?: string): QueueEntryData[] {
    const all = this.queue.getAll();
    if (gameType === 'poker') {
      return this.pokerLobby.players.map(p => ({
        agentId: p.agentId,
        userId: p.userId,
        eloRating: p.eloRating,
        stakeAmount: p.stakeAmount,
        gameType: 'poker',
        status: 'waiting' as const,
        joinedAt: p.joinedAt,
        agentType: p.agentType,
        chain: 'base',
      }));
    }
    if (gameType) return all.filter((e) => e.gameType === gameType);
    return all;
  }

  getPokerLobby(): PokerLobbyState {
    return this.pokerLobby;
  }

  getPokerLobbyCountdownRemainingMs(): number {
    if (!this.pokerLobby.countdownStartedAt) return -1;
    const elapsed = Date.now() - this.pokerLobby.countdownStartedAt;
    return Math.max(0, POKER_LOBBY_COUNTDOWN_MS - elapsed);
  }

  // ─── Poker Lobby ──────────────────────────────────────

  private async joinPokerLobby(agentId: string, userId: string, eloRating: number, stakeAmount: number, agentType?: string): Promise<void> {
    // Check for duplicates
    if (this.pokerLobby.players.find(p => p.agentId === agentId)) {
      throw new Error(`Agent ${agentId} is already in the poker lobby`);
    }

    const agent = await this.agentModel.findById(agentId);
    const name = agent?.name ?? agentId;

    this.pokerLobby.players.push({
      agentId,
      userId,
      name,
      eloRating,
      stakeAmount,
      agentType,
      joinedAt: new Date(),
    });

    // Set lobby stake to minimum among all players
    this.pokerLobby.stakeAmount = Math.min(...this.pokerLobby.players.map(p => p.stakeAmount));

    this.logger.log(`Agent ${agentId} joined poker lobby (${this.pokerLobby.players.length} players)`);
    this.eventBus.emit('matchmaking:queue_joined', { agentId, gameType: 'poker', agentType });
    this.emitPokerLobbyUpdate();

    // Start countdown when we reach minimum players AND at least one human is present
    const hasHuman = this.pokerLobby.players.some(p => p.agentType === 'human');
    if (this.pokerLobby.players.length >= POKER_MIN_PLAYERS && hasHuman && !this.pokerLobby.countdownStartedAt) {
      this.pokerLobby.countdownStartedAt = Date.now();
      this.logger.log(`Poker lobby countdown started (${this.pokerLobby.players.length} players)`);
    }

    // If max players reached, start immediately
    if (this.pokerLobby.players.length >= POKER_MAX_PLAYERS) {
      await this.startPokerFromLobby();
    }
  }

  private emitPokerLobbyUpdate(): void {
    const remainingMs = this.getPokerLobbyCountdownRemainingMs();
    this.eventBus.emit('poker:lobby_update', {
      gameType: 'poker',
      players: this.pokerLobby.players.map(p => ({
        agentId: p.agentId,
        name: p.name,
        eloRating: p.eloRating,
      })),
      countdownMs: remainingMs >= 0 ? remainingMs : null,
      playerCount: this.pokerLobby.players.length,
      minPlayers: POKER_MIN_PLAYERS,
      maxPlayers: POKER_MAX_PLAYERS,
    });
  }

  private async startPokerFromLobby(): Promise<void> {
    if (!this.onPokerLobbyReadyCallback) return;
    if (this.pokerLobby.players.length < POKER_MIN_PLAYERS) return;

    const lobbyPlayers = [...this.pokerLobby.players];
    const stakeAmount = this.pokerLobby.stakeAmount;

    // Clear lobby
    this.pokerLobby.players = [];
    this.pokerLobby.countdownStartedAt = null;
    this.pokerLobby.stakeAmount = 0;

    this.logger.log(`Starting poker match from lobby with ${lobbyPlayers.length} players`);

    // Build MatchAgentInput array
    const agentDocs = await Promise.all(
      lobbyPlayers.map(p => this.agentModel.findById(p.agentId)),
    );

    const players: MatchAgentInput[] = [];
    for (let i = 0; i < lobbyPlayers.length; i++) {
      const doc = agentDocs[i];
      if (!doc) {
        this.logger.error(`Agent ${lobbyPlayers[i].agentId} not found when starting poker lobby`);
        continue;
      }
      players.push({
        agentId: doc._id.toString(),
        userId: doc.userId.toString(),
        name: doc.name,
        endpointUrl: doc.endpointUrl ?? '',
        eloRating: doc.eloRating,
        type: doc.type,
        openclawUrl: doc.openclawUrl,
        openclawToken: doc.openclawToken,
        openclawAgentId: doc.openclawAgentId,
      });
    }

    if (players.length < POKER_MIN_PLAYERS) {
      this.logger.error(`Not enough valid players for poker match (${players.length})`);
      return;
    }

    try {
      const matchChain = agentDocs[0]?.chain || 'base';
      const matchId = await this.onPokerLobbyReadyCallback(players, stakeAmount, matchChain);
      this.eventBus.emit('matchmaking:matched', {
        matchId,
        gameType: 'poker',
        agents: players.map(p => p.agentId),
      });
    } catch (err) {
      this.logger.error(`Failed to start poker match from lobby: ${err}`);
      // Return players to idle
      for (const p of lobbyPlayers) {
        try {
          await this.agentModel.updateOne({ _id: p.agentId }, { $set: { status: 'idle' } });
        } catch {}
      }
    }
  }

  // ─── Pairing Cycle ────────────────────────────────────

  private emitCountdown(gameType: string, remainingMs: number, waiting: QueueEntryData[]): void {
    this.eventBus.emit('matchmaking:countdown', {
      gameType,
      remainingMs,
      agents: waiting.map((e) => ({ agentId: e.agentId, eloRating: e.eloRating })),
    });
  }

  private async processPairing(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      // Process poker lobby countdown
      await this.processPokerLobby();

      // Process standard queue (chess/marrakech)
      if (!this.onPairedCallback) return;

      const gameTypes = this.queue.getGameTypes();

      // Cancel countdowns for game types that no longer have enough agents
      for (const [gameType, _countdown] of this.countdowns) {
        const waiting = this.queue.getWaiting(gameType);
        if (waiting.length < 2) {
          this.logger.log(`Countdown cancelled for ${gameType} — not enough agents`);
          this.countdowns.delete(gameType);
        }
      }

      for (const gameType of gameTypes) {
        const waiting = this.queue.getWaiting(gameType);
        if (waiting.length < 2) continue;

        const pairs = findPairs(waiting);
        if (pairs.length === 0) continue;

        // Exactly 2 agents — pair instantly, no countdown
        if (waiting.length === 2 && pairs.length === 1) {
          this.countdowns.delete(gameType);
          this.logger.log(`Instant pairing for ${gameType} — exactly 2 agents`);
        } else {
          const countdown = this.countdowns.get(gameType);
          const now = Date.now();

          if (!countdown) {
            // Start a new countdown
            this.countdowns.set(gameType, { startedAt: now });
            this.logger.log(`Countdown started for ${gameType} with ${waiting.length} agents`);
            this.emitCountdown(gameType, MATCHMAKING_COUNTDOWN_MS, waiting);
            continue;
          }

          const elapsed = now - countdown.startedAt;
          const remainingMs = MATCHMAKING_COUNTDOWN_MS - elapsed;

          if (remainingMs > 0) {
            // Countdown still active — emit tick
            this.emitCountdown(gameType, remainingMs, waiting);
            continue;
          }

          // Countdown expired — run pairing on the full pool
          this.countdowns.delete(gameType);
          this.logger.log(`Countdown expired for ${gameType}, pairing ${pairs.length} pair(s)`);
        }

        for (const [entryA, entryB] of pairs) {
          try {
            await this.queue.setStatus(entryA.agentId, 'pairing');
            await this.queue.setStatus(entryB.agentId, 'pairing');
            const stakeAmount = Math.min(entryA.stakeAmount, entryB.stakeAmount);
            const matchId = await this.onPairedCallback(entryA.agentId, entryB.agentId, stakeAmount, gameType, entryA.chain);
            this.eventBus.emit('matchmaking:matched', {
              matchId,
              gameType,
              agents: [entryA.agentId, entryB.agentId],
            });
            await this.queue.remove(entryA.agentId);
            await this.queue.remove(entryB.agentId);
          } catch (err) {
            this.logger.error(`Failed to create match for pair: ${err}`);
            try {
              await this.queue.setStatus(entryA.agentId, 'waiting');
              await this.queue.setStatus(entryB.agentId, 'waiting');
            } catch (resetErr) {
              this.logger.error(`Failed to reset queue entry status: ${resetErr}`);
            }
          }
        }
      }
    } catch (err) {
      this.logger.error(`Error during pairing cycle: ${err}`);
    } finally {
      this.processing = false;
    }
  }

  private async processPokerLobby(): Promise<void> {
    if (this.pokerLobby.players.length < POKER_MIN_PLAYERS) return;

    // Emit lobby update with countdown
    this.emitPokerLobbyUpdate();

    // Check if countdown expired
    if (this.pokerLobby.countdownStartedAt) {
      const elapsed = Date.now() - this.pokerLobby.countdownStartedAt;
      if (elapsed >= POKER_LOBBY_COUNTDOWN_MS) {
        await this.startPokerFromLobby();
      }
    }
  }
}
