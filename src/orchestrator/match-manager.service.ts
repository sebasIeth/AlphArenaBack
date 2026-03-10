import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  GameState, Side, Board, Piece, PlayerColor,
  MarrakechGameState, ChessState, ChessUciMove,
  PokerGameState,
} from '../common/types';
import {
  MAX_TIMEOUTS, MATCH_DURATION_MS, TURN_TIMEOUT_MS, TOKEN_DECIMALS,
  POKER_SMALL_BLIND, POKER_BIG_BLIND,
  type ChainName,
} from '../common/constants/game.constants';
import { Match, Agent } from '../database/schemas';
import { decrypt } from '../common/crypto.util';
import { GameEngineService } from '../game-engine/game-engine.service';
import { ChessEngine } from '../game-engine/chess';

import { ActiveMatchesService, ActiveMatchState } from './active-matches.service';
import { TurnControllerService } from './turn-controller.service';
import { MarrakechTurnControllerService } from './marrakech-turn-controller.service';
import { ChessTurnControllerService } from './chess-turn-controller.service';
import { PokerTurnControllerService } from './poker-turn-controller.service';
import { createInitialState as createPokerInitialState, isMatchOver as isPokerMatchOver } from '../game-engine/poker';
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
  private readonly chessEngines = new Map<string, ChessEngine>();
  private readonly chessMoveHistories = new Map<string, ChessUciMove[]>();
  private readonly pokerStates = new Map<string, PokerGameState>();
  private readonly matchGameTypes = new Map<string, string>();

  constructor(
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    private readonly activeMatches: ActiveMatchesService,
    private readonly turnController: TurnControllerService,
    private readonly marrakechTurnController: MarrakechTurnControllerService,
    private readonly chessTurnController: ChessTurnControllerService,
    private readonly pokerTurnController: PokerTurnControllerService,
    private readonly resultHandler: ResultHandlerService,
    private readonly eventBus: EventBusService,
    private readonly settlement: SettlementService,
    private readonly gameEngine: GameEngineService,
  ) {}

  async createMatch(
    agentA: MatchAgentInput,
    agentB: MatchAgentInput,
    stakeAmount: number,
    gameType: string = 'chess',
    chain: string = 'base',
  ): Promise<string> {
    this.logger.log(`Creating match: ${agentA.agentId} vs ${agentB.agentId}, gameType=${gameType}, chain=${chain}`);

    const potAmount = stakeAmount * 2;

    if (gameType === 'marrakech') {
      return this.createMarrakechMatch(agentA, agentB, stakeAmount, potAmount, chain);
    }

    if (gameType === 'chess') {
      return this.createChessMatch(agentA, agentB, stakeAmount, potAmount, chain);
    }

    if (gameType === 'poker') {
      return this.createPokerMatch(agentA, agentB, stakeAmount, potAmount, chain);
    }

    return this.createReversiMatch(agentA, agentB, stakeAmount, potAmount, gameType, chain);
  }

  private async createReversiMatch(
    agentA: MatchAgentInput,
    agentB: MatchAgentInput,
    stakeAmount: number,
    potAmount: number,
    gameType: string,
    chain: string = 'base',
  ): Promise<string> {
    const initialState = this.gameEngine.createInitialState();
    const initialBoard = initialState.board;

    const matchDoc = await this.matchModel.create({
      gameType, chain,
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
    this.matchGameTypes.set(matchId, gameType);

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
    chain: string = 'base',
  ): Promise<string> {
    const marrakech = this.gameEngine.getMarrakechEngine();
    const mkState = marrakech.createInitialState(2, [agentA.name, agentB.name]);

    const initialBoard = mkState.board.map((row) =>
      row.map((cell) => (cell ? cell.playerId + 1 : 0) as Piece),
    ) as Board;

    const matchDoc = await this.matchModel.create({
      gameType: 'marrakech', chain,
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

  private async createChessMatch(
    agentA: MatchAgentInput,
    agentB: MatchAgentInput,
    stakeAmount: number,
    potAmount: number,
    chain: string = 'base',
  ): Promise<string> {
    const chessEngine = this.gameEngine.createChessEngine();
    const initialBoard = chessEngine.getBoard();

    const matchDoc = await this.matchModel.create({
      gameType: 'chess', chain,
      agents: {
        a: { agentId: agentA.agentId, userId: agentA.userId, name: agentA.name, eloAtStart: agentA.eloRating },
        b: { agentId: agentB.agentId, userId: agentB.userId, name: agentB.name, eloAtStart: agentB.eloRating },
      },
      stakeAmount, potAmount, status: 'starting',
      currentBoard: initialBoard, currentTurn: 'a', moveCount: 0,
      timeouts: { a: 0, b: 0 }, txHashes: { escrow: null, payout: null },
      chessState: { fen: chessEngine.getFen(), moveHistory: [], pgn: '' },
    });

    const matchId = matchDoc._id.toString();

    // Side 'a' = White (first mover), Side 'b' = Black
    const compatState: GameState = {
      board: initialBoard as unknown as Board, currentPlayer: 'B', moveNumber: 0,
      scores: { black: 0, white: 0 },
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
    this.chessEngines.set(matchId, chessEngine);
    this.chessMoveHistories.set(matchId, []);
    this.matchGameTypes.set(matchId, 'chess');

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
      gameType: 'chess', stakeAmount,
    });

    this.logger.log(`Chess match ${matchId} created`);
    return matchId;
  }

  private async createPokerMatch(
    agentA: MatchAgentInput,
    agentB: MatchAgentInput,
    stakeAmount: number,
    potAmount: number,
    chain: string = 'base',
  ): Promise<string> {
    // Starting stack = 100 big blinds
    const startingStack = POKER_BIG_BLIND * 100;
    const pokerState = createPokerInitialState(2, startingStack, POKER_SMALL_BLIND, POKER_BIG_BLIND);
    pokerState.players[0].playerId = agentA.agentId;
    pokerState.players[1].playerId = agentB.agentId;

    const matchDoc = await this.matchModel.create({
      gameType: 'poker', chain,
      agents: {
        a: { agentId: agentA.agentId, userId: agentA.userId, name: agentA.name, eloAtStart: agentA.eloRating },
        b: { agentId: agentB.agentId, userId: agentB.userId, name: agentB.name, eloAtStart: agentB.eloRating },
      },
      stakeAmount, potAmount, status: 'starting',
      currentBoard: [], currentTurn: 'a', moveCount: 0,
      timeouts: { a: 0, b: 0 }, txHashes: { escrow: null, payout: null },
      pokerState: { ...pokerState, deck: [] },
    });

    const matchId = matchDoc._id.toString();

    const compatState: GameState = {
      board: [] as unknown as Board, currentPlayer: 'B', moveNumber: 0,
      scores: { black: startingStack, white: startingStack },
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
    this.pokerStates.set(matchId, pokerState);
    this.matchGameTypes.set(matchId, 'poker');

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
      gameType: 'poker', stakeAmount,
    });

    this.logger.log(`Poker match ${matchId} created`);
    return matchId;
  }

  async createPokerMultiplayerMatch(
    players: MatchAgentInput[],
    stakeAmount: number,
    chain: string = 'base',
  ): Promise<string> {
    const potAmount = stakeAmount * players.length;
    const startingStack = POKER_BIG_BLIND * 100;
    const pokerState = createPokerInitialState(players.length, startingStack, POKER_SMALL_BLIND, POKER_BIG_BLIND);

    // Assign player IDs to seats
    for (let i = 0; i < players.length; i++) {
      pokerState.players[i].playerId = players[i].agentId;
    }

    // Build pokerPlayers array for DB
    const pokerPlayers = players.map((p, i) => ({
      seatIndex: i,
      agentId: p.agentId,
      userId: p.userId,
      name: p.name,
      eloAtStart: p.eloRating,
    }));

    // Use first two players for agents.a/b compatibility (required field)
    const matchDoc = await this.matchModel.create({
      gameType: 'poker', chain,
      agents: {
        a: { agentId: players[0].agentId, userId: players[0].userId, name: players[0].name, eloAtStart: players[0].eloRating },
        b: { agentId: players[1].agentId, userId: players[1].userId, name: players[1].name, eloAtStart: players[1].eloRating },
      },
      pokerPlayers,
      stakeAmount, potAmount, status: 'starting',
      currentBoard: [], currentTurn: 'a', moveCount: 0,
      timeouts: { a: 0, b: 0 }, txHashes: { escrow: null, payout: null },
      pokerState: { ...pokerState, deck: [] },
    });

    const matchId = matchDoc._id.toString();

    const compatState: GameState = {
      board: [] as unknown as Board, currentPlayer: 'B', moveNumber: 0,
      scores: { black: startingStack, white: startingStack },
      gameOver: false, winner: null,
    };

    const pokerAgents = players.map((p, i) => ({
      seatIndex: i,
      agentId: p.agentId,
      name: p.name,
      endpointUrl: p.endpointUrl,
      type: p.type,
      openclawUrl: p.openclawUrl,
      openclawToken: p.openclawToken,
      openclawAgentId: p.openclawAgentId,
    }));

    const matchState: ActiveMatchState = {
      matchId, gameState: compatState, clock: null, turnDeadline: 0,
      timeouts: { a: 0, b: 0 },
      pokerTimeouts: Object.fromEntries(players.map((_, i) => [i, 0])),
      status: 'starting',
      agents: {
        a: { agentId: players[0].agentId, endpointUrl: players[0].endpointUrl, piece: 'B', type: players[0].type, openclawUrl: players[0].openclawUrl, openclawToken: players[0].openclawToken, openclawAgentId: players[0].openclawAgentId },
        b: { agentId: players[1].agentId, endpointUrl: players[1].endpointUrl, piece: 'W', type: players[1].type, openclawUrl: players[1].openclawUrl, openclawToken: players[1].openclawToken, openclawAgentId: players[1].openclawAgentId },
      },
      pokerAgents,
      startedAt: Date.now(),
    };

    this.activeMatches.addMatch(matchState);
    this.pokerStates.set(matchId, pokerState);
    this.matchGameTypes.set(matchId, 'poker');

    // Set all players to in_match
    await Promise.all(
      players.map(p => this.agentModel.updateOne({ _id: p.agentId }, { status: 'in_match' })),
    );

    this.eventBus.emit('match:created', {
      matchId,
      agents: {
        a: { agentId: players[0].agentId, name: players[0].name },
        b: { agentId: players[1].agentId, name: players[1].name },
      },
      pokerPlayers: pokerPlayers.map(p => ({ agentId: p.agentId, name: p.name, seatIndex: p.seatIndex })),
      gameType: 'poker', stakeAmount,
    });

    this.logger.log(`Poker multiplayer match ${matchId} created with ${players.length} players`);
    return matchId;
  }

  async startMatch(matchId: string): Promise<void> {
    const matchState = this.activeMatches.getMatch(matchId);
    if (!matchState) throw new Error(`Cannot start match ${matchId}: not found.`);
    if (matchState.status !== 'starting') {
      throw new Error(`Cannot start match ${matchId}: status is "${matchState.status}".`);
    }

    const gameType = this.matchGameTypes.get(matchId) ?? 'chess';
    this.logger.log(`Starting match ${matchId} (${gameType})`);

    // Fetch match doc for potAmount and user IDs
    const matchDoc = await this.matchModel.findById(matchId);
    if (!matchDoc) {
      throw new Error(`Match document ${matchId} not found in DB.`);
    }

    // Determine all agent IDs involved in this match
    const isPokerMultiplayer = !!(matchState.pokerAgents && matchState.pokerAgents.length > 0);
    const allAgentIds = isPokerMultiplayer
      ? matchState.pokerAgents!.map(a => a.agentId)
      : [matchState.agents.a.agentId, matchState.agents.b.agentId];

    // Resolve wallet addresses from agent docs
    const agentDocs = await Promise.all(
      allAgentIds.map(id => this.agentModel.findById(id).select('+walletPrivateKey')),
    );

    const missingWallet = agentDocs.some(d => !d?.walletAddress);
    if (missingWallet) {
      this.logger.error(`Missing agent wallet for match ${matchId}`);
      await this.matchModel.updateOne({ _id: matchId }, { status: 'cancelled' });
      await Promise.all(allAgentIds.map(id => this.agentModel.updateOne({ _id: id }, { status: 'idle' })));
      const errorPayload: any = { matchId, error: 'Missing wallet address for agent' };
      if (isPokerMultiplayer) errorPayload.pokerPlayerIds = allAgentIds;
      else errorPayload.agentIds = { a: matchState.agents.a.agentId, b: matchState.agents.b.agentId };
      this.eventBus.emit('match:error', errorPayload);
      this.activeMatches.removeMatch(matchId);
      this.matchGameTypes.delete(matchId);
      return;
    }

    // Store wallet addresses in active match state
    if (isPokerMultiplayer) {
      const updatedPokerAgents = matchState.pokerAgents!.map((a, i) => ({
        ...a,
        walletAddress: agentDocs[i]!.walletAddress,
      }));
      this.activeMatches.updateMatch(matchId, { pokerAgents: updatedPokerAgents });
    } else {
      this.activeMatches.updateMatch(matchId, {
        agents: {
          a: { ...matchState.agents.a, walletAddress: agentDocs[0]!.walletAddress },
          b: { ...matchState.agents.b, walletAddress: agentDocs[1]!.walletAddress },
        },
      });
    }

    // Transfer stakes and escrow
    if (matchDoc.stakeAmount > 0) {
      const stakeAmountAlpha = BigInt(matchDoc.stakeAmount) * BigInt(10 ** TOKEN_DECIMALS);
      const escrowAmount = BigInt(matchDoc.potAmount) * BigInt(10 ** TOKEN_DECIMALS);
      const matchChain = (matchDoc.chain || 'base') as ChainName;
      const platformWallet = this.settlement.getPlatformWalletAddress(matchChain);

      if (!platformWallet) {
        this.logger.error(`Platform wallet not available for match ${matchId}`);
        await this.matchModel.updateOne({ _id: matchId }, { status: 'cancelled' });
        await Promise.all(allAgentIds.map(id => this.agentModel.updateOne({ _id: id }, { status: 'idle' })));
        const errorPayload: any = { matchId, error: 'Platform wallet not configured' };
        if (isPokerMultiplayer) errorPayload.pokerPlayerIds = allAgentIds;
        else errorPayload.agentIds = { a: matchState.agents.a.agentId, b: matchState.agents.b.agentId };
        this.eventBus.emit('match:error', errorPayload);
        this.activeMatches.removeMatch(matchId);
        this.matchGameTypes.delete(matchId);
        return;
      }

      try {
        // Transfer from each player
        for (const doc of agentDocs) {
          const privKey = doc!.walletPrivateKey ? decrypt(doc!.walletPrivateKey) : null;
          if (!privKey) throw new Error(`Missing wallet private key for agent ${doc!._id}`);
          await this.settlement.transferAlphaFromAgent(privKey, platformWallet, stakeAmountAlpha);
        }

        // Escrow (use first two wallets for compatibility with 2-player escrow API)
        const escrowTxHash = await this.settlement.escrow(
          matchId, agentDocs[0]!.walletAddress, agentDocs[1]!.walletAddress, escrowAmount, matchChain,
        );
        await this.matchModel.updateOne({ _id: matchId }, { 'txHashes.escrow': escrowTxHash });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Escrow failed for match ${matchId}: ${message}`);
        await this.matchModel.updateOne({ _id: matchId }, { status: 'cancelled' });
        await Promise.all(allAgentIds.map(id => this.agentModel.updateOne({ _id: id }, { status: 'idle' })));
        const errorPayload: any = { matchId, error: `Escrow failed: ${message}` };
        if (isPokerMultiplayer) errorPayload.pokerPlayerIds = allAgentIds;
        else errorPayload.agentIds = { a: matchState.agents.a.agentId, b: matchState.agents.b.agentId };
        this.eventBus.emit('match:error', errorPayload);
        this.activeMatches.removeMatch(matchId);
        this.matchGameTypes.delete(matchId);
        return;
      }
    } else {
      this.logger.log(`Skipping escrow for zero-stake match ${matchId}`);
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

    const mkStartState = this.marrakechStates.get(matchId);
    const startedPayload: any = { matchId, gameType, board: matchState.gameState.board };
    if (gameType === 'marrakech' && mkStartState) {
      startedPayload.assam = {
        position: { row: mkStartState.assam.position.row, col: mkStartState.assam.position.col },
        direction: mkStartState.assam.direction,
      };
      startedPayload.players = mkStartState.players.map((p) => ({
        id: p.id, name: p.name, dirhams: p.dirhams, carpetsRemaining: p.carpetsRemaining,
      }));
    }
    if (gameType === 'chess') {
      const chessEng = this.chessEngines.get(matchId);
      if (chessEng) startedPayload.fen = chessEng.getFen();
    }
    if (gameType === 'poker') {
      const pkState = this.pokerStates.get(matchId);
      const updatedMatchState = this.activeMatches.getMatch(matchId);
      if (pkState) {
        if (updatedMatchState?.pokerAgents && updatedMatchState.pokerAgents.length > 0) {
          // N-player poker
          startedPayload.pokerPlayers = pkState.players.map(p => {
            const agentInfo = updatedMatchState.pokerAgents!.find(a => a.agentId === p.playerId);
            return {
              seatIndex: p.seatIndex,
              playerId: p.playerId,
              name: agentInfo?.name ?? `Player ${p.seatIndex + 1}`,
              stack: p.stack,
            };
          });
        } else {
          // Legacy 2-player
          startedPayload.pokerPlayerStacks = { a: pkState.startingStack, b: pkState.startingStack };
        }
        startedPayload.pokerHandNumber = 0;
      }
    }
    this.eventBus.emit('match:started', startedPayload);

    let loopFn: Promise<void>;
    if (gameType === 'marrakech') {
      loopFn = this.runMarrakechGameLoop(matchId);
    } else if (gameType === 'chess') {
      loopFn = this.runChessGameLoop(matchId);
    } else if (gameType === 'poker') {
      loopFn = this.runPokerGameLoop(matchId);
    } else {
      loopFn = this.runGameLoop(matchId);
    }

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

      await this.matchModel.updateOne({ _id: matchId }, { turnStartedAt: new Date() }).catch(() => {});
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

      await this.matchModel.updateOne({ _id: matchId }, { turnStartedAt: new Date() }).catch(() => {});
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

  private async runChessGameLoop(matchId: string): Promise<void> {
    while (true) {
      const matchState = this.activeMatches.getMatch(matchId);
      if (!matchState || matchState.status !== 'active') return;

      const chessEngine = this.chessEngines.get(matchId);
      if (!chessEngine) {
        await this.endMatchWithError(matchId, 'Chess engine state lost');
        return;
      }

      const moveHistory = this.chessMoveHistories.get(matchId) ?? [];

      if (chessEngine.isGameOver()) {
        const winner = chessEngine.getWinner();
        let winningSide: Side | undefined;
        if (winner === 'white') winningSide = 'a';
        else if (winner === 'black') winningSide = 'b';
        const reason = chessEngine.isDraw() ? 'draw' : 'score';
        await this.endMatch(matchId, reason, winningSide);
        return;
      }

      if (matchState.timeouts.a >= MAX_TIMEOUTS) { await this.endMatch(matchId, 'timeout', 'b'); return; }
      if (matchState.timeouts.b >= MAX_TIMEOUTS) { await this.endMatch(matchId, 'timeout', 'a'); return; }

      await this.matchModel.updateOne({ _id: matchId }, { turnStartedAt: new Date() }).catch(() => {});
      const turnResult = await this.chessTurnController.executeTurn(matchState, chessEngine, moveHistory);

      const updated = this.activeMatches.getMatch(matchId);
      if (!updated) return;

      if (turnResult.gameOver) {
        let winningSide: Side | undefined;
        if (turnResult.winner === 'white') winningSide = 'a';
        else if (turnResult.winner === 'black') winningSide = 'b';
        const reason = turnResult.winner === 'draw' ? 'draw' : 'score';
        await this.endMatch(matchId, reason, winningSide);
        return;
      }

      if (updated.timeouts.a >= MAX_TIMEOUTS) { await this.endMatch(matchId, 'timeout', 'b'); return; }
      if (updated.timeouts.b >= MAX_TIMEOUTS) { await this.endMatch(matchId, 'timeout', 'a'); return; }

      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  private async runPokerGameLoop(matchId: string): Promise<void> {
    while (true) {
      const matchState = this.activeMatches.getMatch(matchId);
      if (!matchState || matchState.status !== 'active') return;

      let pokerState = this.pokerStates.get(matchId);
      if (!pokerState) {
        await this.endMatchWithError(matchId, 'Poker state lost');
        return;
      }

      if (isPokerMatchOver(pokerState)) {
        // Find the winner — last player with chips
        const playersWithChips = pokerState.players.filter(p => !p.isEliminated && p.stack > 0);
        let winningSide: Side | undefined;
        if (playersWithChips.length === 1) {
          // Map seat 0 -> 'a', seat 1 -> 'b' for compat (only matters for 2-player)
          winningSide = playersWithChips[0].seatIndex === 0 ? 'a' : 'b';
        }

        this.activeMatches.updateMatch(matchId, {
          gameState: {
            ...matchState.gameState,
            scores: { black: pokerState.players[0]?.stack ?? 0, white: pokerState.players[1]?.stack ?? 0 },
            gameOver: true,
            winner: winningSide === 'a' ? 'B' : winningSide === 'b' ? 'W' : 'draw',
          },
        });
        await this.endMatch(matchId, 'score', winningSide);
        return;
      }

      // Check timeouts (N-player: any player with too many timeouts gets eliminated)
      if (matchState.pokerTimeouts) {
        for (const [seatStr, count] of Object.entries(matchState.pokerTimeouts)) {
          if (count >= MAX_TIMEOUTS) {
            const seatIdx = parseInt(seatStr, 10);
            const player = pokerState.players[seatIdx];
            if (player && !player.isEliminated) {
              player.isEliminated = true;
              player.hasFolded = true;
              this.logger.warn(`Player at seat ${seatIdx} eliminated due to ${count} timeouts in match ${matchId}`);
            }
          }
        }
        this.pokerStates.set(matchId, pokerState);
      }

      const handResult = await this.pokerTurnController.executeHand(matchState, pokerState);
      this.pokerStates.set(matchId, handResult.pokerState);

      this.activeMatches.updateMatch(matchId, {
        gameState: {
          ...matchState.gameState,
          scores: { black: handResult.pokerState.players[0]?.stack ?? 0, white: handResult.pokerState.players[1]?.stack ?? 0 },
          moveNumber: handResult.pokerState.actionHistory.length,
          gameOver: handResult.matchOver,
          winner: handResult.matchOver ? 'B' : null, // generic for compat
        },
      });

      const updated = this.activeMatches.getMatch(matchId);
      if (!updated) return;

      if (handResult.matchOver) {
        const playersWithChips = handResult.pokerState.players.filter(p => !p.isEliminated && p.stack > 0);
        let winningSide: Side | undefined;
        if (playersWithChips.length === 1) {
          winningSide = playersWithChips[0].seatIndex === 0 ? 'a' : 'b';
        }
        await this.endMatch(matchId, 'score', winningSide);
        return;
      }

      // Brief pause between hands
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
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
      this.chessEngines.delete(matchId);
      this.chessMoveHistories.delete(matchId);
      this.pokerStates.delete(matchId);
      this.matchGameTypes.delete(matchId);
      setTimeout(() => this.endedMatches.delete(matchId), 5000);
    }
  }

  private handleMatchTimeout(matchId: string): void {
    this.logger.warn(`Match timer expired for ${matchId}`);
    const matchState = this.activeMatches.getMatch(matchId);
    if (!matchState) return;

    const gameType = this.matchGameTypes.get(matchId) ?? 'chess';
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
    } else if (gameType === 'chess') {
      const chessEng = this.chessEngines.get(matchId);
      if (chessEng) {
        const materialScore = chessEng.getMaterialScore();
        if (materialScore > 0) forcedWinner = 'a';
        else if (materialScore < 0) forcedWinner = 'b';
      }
    } else if (gameType === 'poker') {
      const pkState = this.pokerStates.get(matchId);
      if (pkState) {
        // Find player with most chips
        const livePlayers = pkState.players.filter(p => !p.isEliminated);
        const sorted = [...livePlayers].sort((a, b) => b.stack - a.stack);
        if (sorted.length > 0 && sorted[0].stack > (sorted[1]?.stack ?? 0)) {
          forcedWinner = sorted[0].seatIndex === 0 ? 'a' : 'b';
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

    const errorPayload: any = { matchId, error: errorMessage };
    if (matchState?.pokerAgents && matchState.pokerAgents.length > 0) {
      errorPayload.pokerPlayerIds = matchState.pokerAgents.map(a => a.agentId);
    } else if (matchState) {
      errorPayload.agentIds = { a: matchState.agents.a.agentId, b: matchState.agents.b.agentId };
    }
    this.eventBus.emit('match:error', errorPayload);

    try {
      const errorMatchDoc = await this.matchModel.findById(matchId);
      const errorChain = ((errorMatchDoc?.chain) || 'base') as ChainName;
      await this.matchModel.updateOne({ _id: matchId }, { status: 'error', endedAt: new Date() });
      try { await this.settlement.refund(matchId, errorChain); } catch {}
      if (matchState) {
        const allIds = matchState.pokerAgents && matchState.pokerAgents.length > 0
          ? matchState.pokerAgents.map(a => a.agentId)
          : [matchState.agents.a.agentId, matchState.agents.b.agentId];
        await Promise.all(allIds.map(id => this.agentModel.updateOne({ _id: id }, { status: 'idle' })));
      }
    } catch {}

    this.activeMatches.removeMatch(matchId);
    this.marrakechStates.delete(matchId);
    this.chessEngines.delete(matchId);
    this.chessMoveHistories.delete(matchId);
    this.pokerStates.delete(matchId);
    this.matchGameTypes.delete(matchId);
    setTimeout(() => this.endedMatches.delete(matchId), 5000);
  }

  async recoverActiveMatches(): Promise<void> {
    // 1. Cancel matches stuck in 'starting' status
    const startingMatches = await this.matchModel.find({ status: 'starting' });
    for (const match of startingMatches) {
      const matchId = match._id.toString();
      this.logger.warn(`Cancelling stuck 'starting' match ${matchId}`);
      await this.matchModel.updateOne({ _id: matchId }, { status: 'cancelled', endedAt: new Date() });
      await Promise.all([
        this.agentModel.updateOne({ _id: match.agents.a.agentId, status: 'in_match' }, { status: 'idle' }),
        this.agentModel.updateOne({ _id: match.agents.b.agentId, status: 'in_match' }, { status: 'idle' }),
      ]);
      try { await this.settlement.refund(matchId, (match.chain || 'base') as ChainName); } catch {}
    }

    // 2. Recover matches with 'active' status
    const activeMatches = await this.matchModel.find({ status: 'active' });
    let recovered = 0;

    for (const match of activeMatches) {
      const matchId = match._id.toString();
      const gameType = match.gameType ?? 'chess';

      try {
        // Load agent docs for endpoints, type, openclaw fields, walletAddress
        const [agentDocA, agentDocB] = await Promise.all([
          this.agentModel.findById(match.agents.a.agentId),
          this.agentModel.findById(match.agents.b.agentId),
        ]);

        if (!agentDocA || !agentDocB) {
          this.logger.error(`Cannot recover match ${matchId}: agent doc(s) missing`);
          await this.matchModel.updateOne({ _id: matchId }, { status: 'error', endedAt: new Date() });
          try { await this.settlement.refund(matchId, (match.chain || 'base') as ChainName); } catch {}
          await Promise.all([
            this.agentModel.updateOne({ _id: match.agents.a.agentId }, { status: 'idle' }),
            this.agentModel.updateOne({ _id: match.agents.b.agentId }, { status: 'idle' }),
          ]);
          continue;
        }

        // Calculate elapsed time
        const startedAt = match.startedAt ? match.startedAt.getTime() : match.createdAt.getTime();
        const elapsedMs = Date.now() - startedAt;

        // If match has exceeded total duration, end it immediately
        if (elapsedMs > MATCH_DURATION_MS) {
          this.logger.warn(`Match ${matchId} exceeded duration (${elapsedMs}ms), ending as timeout`);

          let forcedWinner: Side | undefined;
          const scores = match.scores;
          if (gameType === 'marrakech' && match.marrakechState) {
            const mkState = match.marrakechState as MarrakechGameState;
            const pA = mkState.players[0]?.dirhams ?? 0;
            const pB = mkState.players[1]?.dirhams ?? 0;
            if (pA > pB) forcedWinner = 'a';
            else if (pB > pA) forcedWinner = 'b';
          } else if (gameType === 'chess' && match.chessState) {
            const chessState = match.chessState as ChessState;
            const chessEng = this.gameEngine.createChessEngine(chessState.fen);
            const materialScore = chessEng.getMaterialScore();
            if (materialScore > 0) forcedWinner = 'a';
            else if (materialScore < 0) forcedWinner = 'b';
          } else if (gameType === 'poker' && match.pokerState) {
            const pkState = match.pokerState as PokerGameState;
            const livePlayers = pkState.players.filter(p => !p.isEliminated);
            const sorted = [...livePlayers].sort((a, b) => b.stack - a.stack);
            if (sorted.length > 0 && sorted[0].stack > (sorted[1]?.stack ?? 0)) {
              forcedWinner = sorted[0].seatIndex === 0 ? 'a' : 'b';
            }
          } else if (scores) {
            if (scores.a > scores.b) forcedWinner = 'a';
            else if (scores.b > scores.a) forcedWinner = 'b';
          }

          // Build minimal active state so endMatch/resultHandler works
          const minimalGameState: GameState = {
            board: match.currentBoard as Board,
            currentPlayer: match.currentTurn === 'a' ? 'B' as PlayerColor : 'W' as PlayerColor,
            moveNumber: match.moveCount,
            scores: {
              black: scores?.a ?? 0,
              white: scores?.b ?? 0,
            },
            gameOver: true,
            winner: forcedWinner === 'a' ? 'B' : forcedWinner === 'b' ? 'W' : 'draw',
          };

          const minimalState: ActiveMatchState = {
            matchId,
            gameState: minimalGameState,
            clock: null,
            turnDeadline: 0,
            timeouts: match.timeouts ?? { a: 0, b: 0 },
            status: 'active',
            agents: {
              a: {
                agentId: match.agents.a.agentId.toString(),
                endpointUrl: agentDocA.endpointUrl,
                piece: 'B' as PlayerColor,
                walletAddress: agentDocA.walletAddress,
                type: agentDocA.type,
              },
              b: {
                agentId: match.agents.b.agentId.toString(),
                endpointUrl: agentDocB.endpointUrl,
                piece: 'W' as PlayerColor,
                walletAddress: agentDocB.walletAddress,
                type: agentDocB.type,
              },
            },
            startedAt,
          };

          this.activeMatches.addMatch(minimalState);
          this.matchGameTypes.set(matchId, gameType);
          await this.endMatch(matchId, 'timeout', forcedWinner);
          recovered++;
          continue;
        }

        // Reconstruct in-memory state
        const currentSide = match.currentTurn as Side;
        const currentColor: PlayerColor = currentSide === 'a' ? 'B' : 'W';

        let gameState: GameState;
        if (gameType === 'marrakech' && match.marrakechState) {
          const mkState = match.marrakechState as MarrakechGameState;
          this.marrakechStates.set(matchId, mkState);
          gameState = {
            board: match.currentBoard as Board,
            currentPlayer: currentColor,
            moveNumber: match.moveCount,
            scores: {
              black: mkState.players[0]?.dirhams ?? 0,
              white: mkState.players[1]?.dirhams ?? 0,
            },
            gameOver: false,
            winner: null,
          };
        } else if (gameType === 'chess' && match.chessState) {
          const chessState = match.chessState as ChessState;
          const chessEng = this.gameEngine.createChessEngine();
          const moveHistory: ChessUciMove[] = chessState.moveHistory || [];
          for (const uci of moveHistory) {
            chessEng.applyMoveUci(uci);
          }
          this.chessEngines.set(matchId, chessEng);
          this.chessMoveHistories.set(matchId, [...moveHistory]);

          const materialScore = chessEng.getMaterialScore();
          gameState = {
            board: chessEng.getBoard() as unknown as Board,
            currentPlayer: currentColor,
            moveNumber: moveHistory.length,
            scores: { black: Math.max(0, materialScore), white: Math.max(0, -materialScore) },
            gameOver: false,
            winner: null,
          };
        } else if (gameType === 'poker' && match.pokerState) {
          const pkState = match.pokerState as PokerGameState;
          this.pokerStates.set(matchId, pkState);
          gameState = {
            board: [] as unknown as Board,
            currentPlayer: currentColor,
            moveNumber: match.moveCount,
            scores: { black: pkState.players[0]?.stack ?? 0, white: pkState.players[1]?.stack ?? 0 },
            gameOver: false,
            winner: null,
          };
        } else {
          const scores = match.scores ?? { a: 0, b: 0 };
          gameState = {
            board: match.currentBoard as Board,
            currentPlayer: currentColor,
            moveNumber: match.moveCount,
            scores: { black: scores.a, white: scores.b },
            gameOver: false,
            winner: null,
          };
        }

        // Create clock with elapsed time
        const clock = new MatchClock(
          matchId,
          {
            onMatchTimeout: (mId: string) => this.handleMatchTimeout(mId),
            onTurnTimeout: (mId: string) => {
              this.logger.warn(`Turn timeout callback for ${mId}`);
            },
          },
          MATCH_DURATION_MS,
          TURN_TIMEOUT_MS,
          elapsedMs,
        );

        const matchState: ActiveMatchState = {
          matchId,
          gameState,
          clock,
          turnDeadline: 0,
          timeouts: match.timeouts ?? { a: 0, b: 0 },
          status: 'active',
          agents: {
            a: {
              agentId: match.agents.a.agentId.toString(),
              endpointUrl: agentDocA.endpointUrl,
              piece: 'B' as PlayerColor,
              walletAddress: agentDocA.walletAddress,
              type: agentDocA.type,
              openclawUrl: agentDocA.openclawUrl,
              openclawToken: agentDocA.openclawToken,
              openclawAgentId: agentDocA.openclawAgentId,
            },
            b: {
              agentId: match.agents.b.agentId.toString(),
              endpointUrl: agentDocB.endpointUrl,
              piece: 'W' as PlayerColor,
              walletAddress: agentDocB.walletAddress,
              type: agentDocB.type,
              openclawUrl: agentDocB.openclawUrl,
              openclawToken: agentDocB.openclawToken,
              openclawAgentId: agentDocB.openclawAgentId,
            },
          },
          startedAt,
        };

        this.activeMatches.addMatch(matchState);
        this.matchGameTypes.set(matchId, gameType);
        clock.startMatch();

        // Resume the game loop
        let loopFn: Promise<void>;
        if (gameType === 'marrakech') {
          loopFn = this.runMarrakechGameLoop(matchId);
        } else if (gameType === 'chess') {
          loopFn = this.runChessGameLoop(matchId);
        } else if (gameType === 'poker') {
          loopFn = this.runPokerGameLoop(matchId);
        } else {
          loopFn = this.runGameLoop(matchId);
        }

        loopFn.catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`Recovered game loop failed for ${matchId}: ${message}`);
          this.endMatchWithError(matchId, message);
        });

        recovered++;
        this.logger.log(`Recovered match ${matchId} (${gameType}, ${Math.round(elapsedMs / 1000)}s elapsed)`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to recover match ${matchId}: ${message}`);
        await this.matchModel.updateOne({ _id: matchId }, { status: 'error', endedAt: new Date() });
        try { await this.settlement.refund(matchId, (match.chain || 'base') as ChainName); } catch {}
        await Promise.all([
          this.agentModel.updateOne({ _id: match.agents.a.agentId }, { status: 'idle' }),
          this.agentModel.updateOne({ _id: match.agents.b.agentId }, { status: 'idle' }),
        ]);
      }
    }

    if (recovered > 0 || startingMatches.length > 0) {
      this.logger.log(`Match recovery complete: ${recovered} active matches recovered, ${startingMatches.length} starting matches cancelled`);
    }
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

  getChessEngine(matchId: string): ChessEngine | undefined {
    return this.chessEngines.get(matchId);
  }

  getPokerState(matchId: string): PokerGameState | undefined {
    return this.pokerStates.get(matchId);
  }

  getGameType(matchId: string): string {
    return this.matchGameTypes.get(matchId) ?? 'chess';
  }
}
