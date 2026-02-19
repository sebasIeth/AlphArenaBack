import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  GameState, Side, Board, Piece,
  MarrakechGameState,
} from '../common/types';
import { MAX_TIMEOUTS, USDC_DECIMALS } from '../common/constants/game.constants';
import { Match, Agent, User } from '../database/schemas';
import { GameEngineService } from '../game-engine/game-engine.service';
import { ActiveMatchesService, ActiveMatchState } from './active-matches.service';
import { TurnControllerService } from './turn-controller.service';
import { MarrakechTurnControllerService } from './marrakech-turn-controller.service';
import { ResultHandlerService } from './result-handler.service';
import { EventBusService } from './event-bus.service';
import { SettlementService } from '../settlement/settlement.service';
import { MatchClock } from './match-clock';

export interface MatchAgentInput {
  agentId: string;
  userId: string;
  name: string;
  endpointUrl: string;
  eloRating: number;
  type?: string;
  openclawUrl?: string;
  openclawToken?: string;
  openclawAgentId?: string;
}

@Injectable()
export class MatchManagerService {
  private readonly logger = new Logger(MatchManagerService.name);
  private readonly endedMatches = new Set<string>();
  private readonly marrakechStates = new Map<string, MarrakechGameState>();
  private readonly matchGameTypes = new Map<string, string>();

  constructor(
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly activeMatches: ActiveMatchesService,
    private readonly turnController: TurnControllerService,
    private readonly marrakechTurnController: MarrakechTurnControllerService,
    private readonly resultHandler: ResultHandlerService,
    private readonly eventBus: EventBusService,
    private readonly settlement: SettlementService,
    private readonly gameEngine: GameEngineService,
  ) {}

  async createMatch(
    agentA: MatchAgentInput,
    agentB: MatchAgentInput,
    stakeAmount: number,
    gameType: string = 'reversi',
  ): Promise<string> {
    this.logger.log(`Creating match: ${agentA.agentId} vs ${agentB.agentId}, gameType=${gameType}`);

    const potAmount = stakeAmount * 2;

    if (gameType === 'marrakech') {
      return this.createMarrakechMatch(agentA, agentB, stakeAmount, potAmount);
    }

    return this.createReversiMatch(agentA, agentB, stakeAmount, potAmount, gameType);
  }

  private async createReversiMatch(
    agentA: MatchAgentInput,
    agentB: MatchAgentInput,
    stakeAmount: number,
    potAmount: number,
    gameType: string,
  ): Promise<string> {
    const initialState = this.gameEngine.createInitialState();
    const initialBoard = initialState.board;

    const matchDoc = await this.matchModel.create({
      gameType,
      agents: {
        a: { agentId: agentA.agentId, userId: agentA.userId, name: agentA.name, eloAtStart: agentA.eloRating },
        b: { agentId: agentB.agentId, userId: agentB.userId, name: agentB.name, eloAtStart: agentB.eloRating },
      },
      stakeAmount, potAmount, status: 'starting',
      currentBoard: initialBoard, currentTurn: 'a', moveCount: 0,
      timeouts: { a: 0, b: 0 }, txHashes: { escrow: null, payout: null },
    });

    const matchId = matchDoc._id.toString();

    const matchState: ActiveMatchState = {
      matchId, gameState: initialState, clock: null, turnDeadline: 0,
      timeouts: { a: 0, b: 0 }, status: 'starting',
      agents: {
        a: { agentId: agentA.agentId, endpointUrl: agentA.endpointUrl, piece: 'B', type: agentA.type, openclawUrl: agentA.openclawUrl, openclawToken: agentA.openclawToken, openclawAgentId: agentA.openclawAgentId },
        b: { agentId: agentB.agentId, endpointUrl: agentB.endpointUrl, piece: 'W', type: agentB.type, openclawUrl: agentB.openclawUrl, openclawToken: agentB.openclawToken, openclawAgentId: agentB.openclawAgentId },
      },
      startedAt: Date.now(),
    };

    this.activeMatches.addMatch(matchState);
    this.matchGameTypes.set(matchId, 'reversi');

    await Promise.all([
      this.agentModel.updateOne({ _id: agentA.agentId }, { status: 'in_match' }),
      this.agentModel.updateOne({ _id: agentB.agentId }, { status: 'in_match' }),
    ]);

    this.eventBus.emit('match:created', {
      matchId,
      agents: {
        a: { agentId: agentA.agentId, name: agentA.name },
        b: { agentId: agentB.agentId, name: agentB.name },
      },
      gameType, stakeAmount,
    });

    this.logger.log(`Reversi match ${matchId} created`);
    return matchId;
  }

  private async createMarrakechMatch(
    agentA: MatchAgentInput,
    agentB: MatchAgentInput,
    stakeAmount: number,
    potAmount: number,
  ): Promise<string> {
    const marrakech = this.gameEngine.getMarrakechEngine();
    const mkState = marrakech.createInitialState(2, [agentA.name, agentB.name]);

    const initialBoard = mkState.board.map((row) =>
      row.map((cell) => (cell ? cell.playerId + 1 : 0) as Piece),
    ) as Board;

    const matchDoc = await this.matchModel.create({
      gameType: 'marrakech',
      agents: {
        a: { agentId: agentA.agentId, userId: agentA.userId, name: agentA.name, eloAtStart: agentA.eloRating },
        b: { agentId: agentB.agentId, userId: agentB.userId, name: agentB.name, eloAtStart: agentB.eloRating },
      },
      stakeAmount, potAmount, status: 'starting',
      currentBoard: initialBoard, currentTurn: 'a', moveCount: 0,
      timeouts: { a: 0, b: 0 }, txHashes: { escrow: null, payout: null },
    });

    const matchId = matchDoc._id.toString();

    const compatState: GameState = {
      board: initialBoard, currentPlayer: 'B', moveNumber: 0,
      scores: { black: mkState.players[0].dirhams, white: mkState.players[1].dirhams },
      gameOver: false, winner: null,
    };

    const matchState: ActiveMatchState = {
      matchId, gameState: compatState, clock: null, turnDeadline: 0,
      timeouts: { a: 0, b: 0 }, status: 'starting',
      agents: {
        a: { agentId: agentA.agentId, endpointUrl: agentA.endpointUrl, piece: 'B', type: agentA.type, openclawUrl: agentA.openclawUrl, openclawToken: agentA.openclawToken, openclawAgentId: agentA.openclawAgentId },
        b: { agentId: agentB.agentId, endpointUrl: agentB.endpointUrl, piece: 'W', type: agentB.type, openclawUrl: agentB.openclawUrl, openclawToken: agentB.openclawToken, openclawAgentId: agentB.openclawAgentId },
      },
      startedAt: Date.now(),
    };

    this.activeMatches.addMatch(matchState);
    this.marrakechStates.set(matchId, mkState);
    this.matchGameTypes.set(matchId, 'marrakech');

    await Promise.all([
      this.agentModel.updateOne({ _id: agentA.agentId }, { status: 'in_match' }),
      this.agentModel.updateOne({ _id: agentB.agentId }, { status: 'in_match' }),
    ]);

    this.eventBus.emit('match:created', {
      matchId,
      agents: {
        a: { agentId: agentA.agentId, name: agentA.name },
        b: { agentId: agentB.agentId, name: agentB.name },
      },
      gameType: 'marrakech', stakeAmount,
    });

    this.logger.log(`Marrakech match ${matchId} created`);
    return matchId;
  }

  async startMatch(matchId: string): Promise<void> {
    const matchState = this.activeMatches.getMatch(matchId);
    if (!matchState) throw new Error(`Cannot start match ${matchId}: not found.`);
    if (matchState.status !== 'starting') {
      throw new Error(`Cannot start match ${matchId}: status is "${matchState.status}".`);
    }

    const gameType = this.matchGameTypes.get(matchId) ?? 'reversi';
    this.logger.log(`Starting match ${matchId} (${gameType})`);

    // Fetch match doc for potAmount and user IDs
    const matchDoc = await this.matchModel.findById(matchId);
    if (!matchDoc) {
      throw new Error(`Match document ${matchId} not found in DB.`);
    }

    // Resolve wallet addresses for both agents
    const [userA, userB] = await Promise.all([
      this.userModel.findById(matchDoc.agents.a.userId),
      this.userModel.findById(matchDoc.agents.b.userId),
    ]);
    const walletA = userA?.walletAddress;
    const walletB = userB?.walletAddress;

    if (!walletA || !walletB) {
      this.logger.error(`Missing wallet address for match ${matchId}: A=${walletA}, B=${walletB}`);
      await this.matchModel.updateOne({ _id: matchId }, { status: 'cancelled' });
      await Promise.all([
        this.agentModel.updateOne({ _id: matchState.agents.a.agentId }, { status: 'idle' }),
        this.agentModel.updateOne({ _id: matchState.agents.b.agentId }, { status: 'idle' }),
      ]);
      this.eventBus.emit('match:error', { matchId, error: 'Missing wallet address for agent owner' });
      this.activeMatches.removeMatch(matchId);
      this.marrakechStates.delete(matchId);
      this.matchGameTypes.delete(matchId);
      return;
    }

    // Store wallet addresses in active match state for settlement
    this.activeMatches.updateMatch(matchId, {
      agents: {
        a: { ...matchState.agents.a, walletAddress: walletA },
        b: { ...matchState.agents.b, walletAddress: walletB },
      },
    });

    // Escrow real potAmount in USDC smallest units (6 decimals)
    const escrowAmount = BigInt(matchDoc.potAmount) * BigInt(10 ** USDC_DECIMALS);
    try {
      const escrowTxHash = await this.settlement.escrow(
        matchId, walletA, walletB, escrowAmount,
      );
      await this.matchModel.updateOne({ _id: matchId }, { 'txHashes.escrow': escrowTxHash });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Escrow failed for match ${matchId}: ${message}`);
      await this.matchModel.updateOne({ _id: matchId }, { status: 'cancelled' });
      await Promise.all([
        this.agentModel.updateOne({ _id: matchState.agents.a.agentId }, { status: 'idle' }),
        this.agentModel.updateOne({ _id: matchState.agents.b.agentId }, { status: 'idle' }),
      ]);
      this.eventBus.emit('match:error', { matchId, error: `Escrow failed: ${message}` });
      this.activeMatches.removeMatch(matchId);
      this.marrakechStates.delete(matchId);
      this.matchGameTypes.delete(matchId);
      return;
    }

    const clock = new MatchClock(matchId, {
      onMatchTimeout: (mId: string) => this.handleMatchTimeout(mId),
      onTurnTimeout: (mId: string) => {
        this.logger.warn(`Turn timeout callback for ${mId}`);
      },
    });

    this.activeMatches.updateMatch(matchId, { status: 'active', clock, startedAt: Date.now() });
    await this.matchModel.updateOne({ _id: matchId }, { status: 'active', startedAt: new Date() });
    clock.startMatch();

    this.eventBus.emit('match:started', {
      matchId, gameType, board: matchState.gameState.board,
    });

    const loopFn = gameType === 'marrakech'
      ? this.runMarrakechGameLoop(matchId)
      : this.runGameLoop(matchId);

    loopFn.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Game loop failed for ${matchId}: ${message}`);
      this.endMatchWithError(matchId, message);
    });
  }

  private async runGameLoop(matchId: string): Promise<void> {
    while (true) {
      const matchState = this.activeMatches.getMatch(matchId);
      if (!matchState || matchState.status !== 'active') return;
      if (this.gameEngine.isGameOver(matchState.gameState)) {
        const reason = matchState.gameState.winner === 'draw' ? 'draw' : 'score';
        await this.endMatch(matchId, reason);
        return;
      }
      if (matchState.timeouts.a >= MAX_TIMEOUTS) { await this.endMatch(matchId, 'timeout', 'b'); return; }
      if (matchState.timeouts.b >= MAX_TIMEOUTS) { await this.endMatch(matchId, 'timeout', 'a'); return; }

      const turnResult = await this.turnController.executeTurn(matchState);
      const updatedState = this.activeMatches.getMatch(matchId);
      if (!updatedState) return;

      if (turnResult.gameOver) {
        const reason = turnResult.gameState.winner === 'draw' ? 'draw' : 'score';
        await this.endMatch(matchId, reason);
        return;
      }
      if (updatedState.timeouts.a >= MAX_TIMEOUTS) { await this.endMatch(matchId, 'timeout', 'b'); return; }
      if (updatedState.timeouts.b >= MAX_TIMEOUTS) { await this.endMatch(matchId, 'timeout', 'a'); return; }

      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  private async runMarrakechGameLoop(matchId: string): Promise<void> {
    const marrakech = this.gameEngine.getMarrakechEngine();

    while (true) {
      const matchState = this.activeMatches.getMatch(matchId);
      if (!matchState || matchState.status !== 'active') return;

      let mkState = this.marrakechStates.get(matchId);
      if (!mkState) {
        await this.endMatchWithError(matchId, 'Marrakech state lost');
        return;
      }

      if (mkState.gameOver) {
        let winningSide: Side | undefined;
        if (mkState.winner === 0) winningSide = 'a';
        else if (mkState.winner === 1) winningSide = 'b';
        this.activeMatches.updateMatch(matchId, {
          gameState: {
            ...matchState.gameState,
            scores: { black: mkState.players[0]?.dirhams ?? 0, white: mkState.players[1]?.dirhams ?? 0 },
            gameOver: true,
            winner: winningSide === 'a' ? 'B' : winningSide === 'b' ? 'W' : 'draw',
          },
        });
        await this.endMatch(matchId, 'score', winningSide);
        return;
      }

      if (matchState.timeouts.a >= MAX_TIMEOUTS) { await this.endMatch(matchId, 'timeout', 'b'); return; }
      if (matchState.timeouts.b >= MAX_TIMEOUTS) { await this.endMatch(matchId, 'timeout', 'a'); return; }

      const turnResult = await this.marrakechTurnController.executeTurn(matchState, mkState);
      this.marrakechStates.set(matchId, turnResult.gameState);

      this.activeMatches.updateMatch(matchId, {
        gameState: {
          ...matchState.gameState,
          scores: { black: turnResult.gameState.players[0]?.dirhams ?? 0, white: turnResult.gameState.players[1]?.dirhams ?? 0 },
          moveNumber: turnResult.gameState.turnNumber,
          gameOver: turnResult.gameState.gameOver,
          winner: turnResult.gameState.winner === 0 ? 'B' : turnResult.gameState.winner === 1 ? 'W' : turnResult.gameState.gameOver ? 'draw' : null,
        },
      });

      const updated = this.activeMatches.getMatch(matchId);
      if (!updated) return;

      if (turnResult.gameOver) {
        let winningSide: Side | undefined;
        if (turnResult.gameState.winner === 0) winningSide = 'a';
        else if (turnResult.gameState.winner === 1) winningSide = 'b';
        await this.endMatch(matchId, 'score', winningSide);
        return;
      }

      if (updated.timeouts.a >= MAX_TIMEOUTS) { await this.endMatch(matchId, 'timeout', 'b'); return; }
      if (updated.timeouts.b >= MAX_TIMEOUTS) { await this.endMatch(matchId, 'timeout', 'a'); return; }

      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  async endMatch(matchId: string, reason: string, forcedWinnerSide?: Side): Promise<void> {
    if (this.endedMatches.has(matchId)) return;
    this.endedMatches.add(matchId);

    try {
      await this.resultHandler.handleMatchEnd(matchId, reason, forcedWinnerSide as any);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error ending match ${matchId}: ${message}`);
    } finally {
      this.marrakechStates.delete(matchId);
      this.matchGameTypes.delete(matchId);
      setTimeout(() => this.endedMatches.delete(matchId), 5000);
    }
  }

  private handleMatchTimeout(matchId: string): void {
    this.logger.warn(`Match timer expired for ${matchId}`);
    const matchState = this.activeMatches.getMatch(matchId);
    if (!matchState) return;

    const gameType = this.matchGameTypes.get(matchId) ?? 'reversi';
    let forcedWinner: Side | undefined;

    if (gameType === 'marrakech') {
      const mkState = this.marrakechStates.get(matchId);
      if (mkState) {
        const marrakech = this.gameEngine.getMarrakechEngine();
        const scores = marrakech.calculateFinalScores(mkState);
        if (scores.length >= 2) {
          if (scores[0].total > scores[1].total) {
            forcedWinner = scores[0].playerId === 0 ? 'a' : 'b';
          }
        }
      }
    } else {
      const { scores } = matchState.gameState;
      if (scores.black > scores.white) forcedWinner = 'a';
      else if (scores.white > scores.black) forcedWinner = 'b';
    }

    this.endMatch(matchId, 'timeout', forcedWinner).catch((error: unknown) => {
      this.logger.error(`Failed to end match ${matchId} after timeout`);
    });
  }

  async endMatchWithError(matchId: string, errorMessage: string): Promise<void> {
    if (this.endedMatches.has(matchId)) return;
    this.endedMatches.add(matchId);

    const matchState = this.activeMatches.getMatch(matchId);
    if (matchState?.clock) matchState.clock.stop();

    this.eventBus.emit('match:error', { matchId, error: errorMessage });

    try {
      await this.matchModel.updateOne({ _id: matchId }, { status: 'error', endedAt: new Date() });
      try { await this.settlement.refund(matchId); } catch {}
      if (matchState) {
        await Promise.all([
          this.agentModel.updateOne({ _id: matchState.agents.a.agentId }, { status: 'idle' }),
          this.agentModel.updateOne({ _id: matchState.agents.b.agentId }, { status: 'idle' }),
        ]);
      }
    } catch {}

    this.activeMatches.removeMatch(matchId);
    this.marrakechStates.delete(matchId);
    this.matchGameTypes.delete(matchId);
    setTimeout(() => this.endedMatches.delete(matchId), 5000);
  }

  async stopAll(): Promise<void> {
    const matchIds = this.activeMatches.getAllMatchIds();
    this.logger.log(`Stopping all ${matchIds.length} active matches`);
    for (const matchId of matchIds) {
      try {
        const matchState = this.activeMatches.getMatch(matchId);
        if (matchState?.clock) matchState.clock.stop();
        await this.endMatch(matchId, 'forfeit');
      } catch {}
    }
  }

  getMarrakechState(matchId: string): MarrakechGameState | undefined {
    return this.marrakechStates.get(matchId);
  }

  getGameType(matchId: string): string {
    return this.matchGameTypes.get(matchId) ?? 'reversi';
  }
}
