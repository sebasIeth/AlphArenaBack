import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { MatchManagerService, MatchAgentInput } from './match-manager.service';
import { ActiveMatchesService, ActiveMatchState } from './active-matches.service';
import { EventBusService } from './event-bus.service';

@Injectable()
export class OrchestratorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrchestratorService.name);
  private running = false;

  constructor(
    private readonly matchManager: MatchManagerService,
    private readonly activeMatches: ActiveMatchesService,
    private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<void> {
    if (this.running) {
      this.logger.warn('OrchestratorService is already running');
      return;
    }
    this.running = true;
    this.logger.log('OrchestratorService started');

    await this.matchManager.recoverActiveMatches();
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.logger.log(`Stopping OrchestratorService (${this.activeMatches.size} active matches)`);
    await this.matchManager.stopAll();

    for (const [matchId, matchState] of this.activeMatches.entries()) {
      if (matchState.clock) matchState.clock.stop();
    }
    this.activeMatches.clear();
    this.eventBus.removeAllListeners();
    this.running = false;
    this.logger.log('OrchestratorService stopped');
  }

  async startMatch(
    agentA: MatchAgentInput,
    agentB: MatchAgentInput,
    stakeAmount: number,
    gameType: string = 'chess',
    chain: string = 'base',
  ): Promise<string> {
    if (!this.running) throw new Error('OrchestratorService is not running.');
    const matchId = await this.matchManager.createMatch(agentA, agentB, stakeAmount, gameType, chain);
    await this.matchManager.startMatch(matchId);
    return matchId;
  }

  async startPokerMatch(
    players: MatchAgentInput[],
    stakeAmount: number,
    chain: string = 'base',
  ): Promise<string> {
    if (!this.running) throw new Error('OrchestratorService is not running.');
    const matchId = await this.matchManager.createPokerMultiplayerMatch(players, stakeAmount, chain);
    await this.matchManager.startMatch(matchId);
    return matchId;
  }

  getActiveMatch(matchId: string): ActiveMatchState | undefined {
    return this.activeMatches.getMatch(matchId);
  }

  getActiveMatchCount(): number {
    return this.activeMatches.size;
  }
}
