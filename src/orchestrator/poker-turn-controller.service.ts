import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Side, Board } from '../common/types';
import {
  PokerGameState, PokerMoveRequest, PokerMoveResponse,
  PokerAction, PokerActionType, PokerLegalActions, PokerMoveRequestPlayer,
} from '../common/types/poker.types';
import { MoveDoc, Match } from '../database/schemas';
import { TURN_TIMEOUT_MS } from '../common/constants/game.constants';
import {
  dealNewHand, getLegalActions, applyAction,
  isStreetOver, advanceStreet, resolveShowdown,
  resolveFold, isHandOver, isMatchOver, allPlayersAllIn,
} from '../game-engine/poker';
import { nextActivePlayer } from '../game-engine/poker/betting';
import { AgentClientService } from './agent-client.service';
import { ActiveMatchesService, ActiveMatchState, PokerAgentInfo } from './active-matches.service';
import { EventBusService } from './event-bus.service';
import { HumanMoveService } from './human-move.service';

export interface PokerHandResult {
  pokerState: PokerGameState;
  matchOver: boolean;
  winnerIndices: number[];
}

@Injectable()
export class PokerTurnControllerService {
  private readonly logger = new Logger(PokerTurnControllerService.name);

  constructor(
    @InjectModel(MoveDoc.name) private readonly moveModel: Model<MoveDoc>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    private readonly agentClient: AgentClientService,
    private readonly activeMatches: ActiveMatchesService,
    private readonly eventBus: EventBusService,
    private readonly humanMoveService: HumanMoveService,
  ) {}

  async executeHand(
    matchState: ActiveMatchState,
    pokerState: PokerGameState,
  ): Promise<PokerHandResult> {
    const { matchId } = matchState;

    // 1. Deal new hand
    let state = dealNewHand(pokerState);
    this.logger.log(
      `Hand #${state.handNumber} starting: match=${matchId}, dealer=seat${state.dealerIndex}, players=${state.players.filter(p => !p.isEliminated).length}`,
    );

    await this.persistPokerState(matchId, state);

    // 2. Loop through streets
    while (!isHandOver(state)) {
      // All non-folded players are all-in → skip to showdown
      if (allPlayersAllIn(state)) {
        break;
      }

      // Within each street, loop through actions
      while (!isStreetOver(state) && !isHandOver(state)) {
        const currentIndex = state.currentPlayerIndex;
        const currentPlayer = state.players[currentIndex];

        // Skip eliminated/folded/all-in players
        if (currentPlayer.isEliminated || currentPlayer.hasFolded || currentPlayer.isAllIn) {
          const next = nextActivePlayer(state, currentIndex);
          if (next === -1) break;
          state.currentPlayerIndex = next;
          continue;
        }

        // Find agent info for this player
        const agent = this.findAgent(matchState, currentPlayer.playerId);
        if (!agent) {
          this.logger.error(`No agent info for player ${currentPlayer.playerId} at seat ${currentIndex}`);
          break;
        }

        // Check if match was cancelled externally
        const checkState = this.activeMatches.getMatch(matchId);
        if (!checkState || checkState.status !== 'active') {
          return { pokerState: state, matchOver: true, winnerIndices: [] };
        }

        const legalActions = getLegalActions(state);
        const timeRemainingMs = matchState.clock ? matchState.clock.getTimeRemainingMs() : 0;

        // Build sanitized move request — other players don't get hole cards
        const playersInfo: PokerMoveRequestPlayer[] = state.players.map(p => {
          const agentInfo = matchState.pokerAgents?.find(a => a.agentId === p.playerId);
          return {
            seatIndex: p.seatIndex,
            name: agentInfo?.name,
            stack: p.stack,
            currentBet: p.currentBet,
            hasFolded: p.hasFolded,
            isAllIn: p.isAllIn,
            isDealer: p.isDealer,
            isEliminated: p.isEliminated,
          };
        });

        const moveRequest: PokerMoveRequest = {
          matchId,
          gameType: 'poker',
          handNumber: state.handNumber,
          street: state.street,
          yourSeatIndex: currentIndex,
          yourHoleCards: currentPlayer.holeCards,
          communityCards: state.communityCards,
          pot: state.pot,
          yourStack: currentPlayer.stack,
          yourCurrentBet: currentPlayer.currentBet,
          players: playersInfo,
          legalActions,
          actionHistory: state.actionHistory,
          blinds: { small: state.smallBlind, big: state.bigBlind },
          isDealer: currentPlayer.isDealer,
          dealerIndex: state.dealerIndex,
          timeRemainingMs,
        };

        if (matchState.clock) {
          const turnDeadline = matchState.clock.startTurn();
          this.activeMatches.updateMatch(matchId, { turnDeadline });
        }

        const thinkingStart = Date.now();
        let actionResponse: PokerMoveResponse;

        try {
          if (agent.type === 'human') {
            // Emit your_turn event for this human player
            this.eventBus.emit('match:your_turn', {
              matchId,
              side: this.seatToSide(currentIndex),
              gameType: 'poker',
              board: [] as unknown as Board,
              legalMoves: [legalActions],
              moveNumber: state.actionHistory.length,
              timeRemainingMs,
              turnTimeoutMs: TURN_TIMEOUT_MS,
              pokerHoleCards: currentPlayer.holeCards,
              pokerCommunityCards: state.communityCards,
              pokerPot: state.pot,
              pokerPlayers: playersInfo,
              pokerStreet: state.street,
              pokerHandNumber: state.handNumber,
              pokerIsDealer: currentPlayer.isDealer,
              pokerSeatIndex: currentIndex,
              pokerActionHistory: state.actionHistory.map((a) => ({
                type: a.type, amount: a.amount, playerIndex: a.playerIndex, street: a.street,
              })),
            });

            const humanMove = await this.humanMoveService.waitForMove(matchId, this.seatToSide(currentIndex), agent.agentId);
            actionResponse = humanMove as PokerMoveResponse;
          } else {
            const raw = await this.agentClient.requestMove(agent.endpointUrl, moveRequest as any);
            actionResponse = raw as any;
          }

          if (matchState.clock) matchState.clock.clearTurn();
        } catch (error: unknown) {
          if (matchState.clock) matchState.clock.clearTurn();
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`Error getting poker action for match ${matchId}, seat ${currentIndex}: ${message}`);

          // Timeout → auto-check if possible, otherwise auto-fold
          if (legalActions.canCheck) {
            actionResponse = { action: 'check' };
          } else {
            actionResponse = { action: 'fold' };
          }
          this.handleTimeout(matchState, currentIndex);
        }

        const thinkingTimeMs = Date.now() - thinkingStart;

        // Validate & normalize action
        const validatedAction = this.validateAction(actionResponse, legalActions, currentIndex);

        // Apply action to poker state
        const pokerAction: PokerAction = {
          type: validatedAction.action,
          amount: validatedAction.amount,
          playerIndex: currentIndex,
          street: state.street,
          timestamp: Date.now(),
        };

        state = applyAction(state, pokerAction);

        // Emit match:move event
        const existingMoveCount = await this.moveModel.countDocuments({ matchId });
        const moveNumber = existingMoveCount + 1;
        this.eventBus.emit('match:move', {
          matchId,
          side: this.seatToSide(currentIndex),
          move: { row: 0, col: 0 },
          boardState: [] as unknown as Board,
          score: { a: state.players[0]?.stack ?? 0, b: state.players[1]?.stack ?? 0 },
          moveNumber,
          thinkingTimeMs,
          pokerAction: { type: validatedAction.action, amount: validatedAction.amount },
          pokerStreet: state.street,
          pokerPot: state.pot,
          pokerCommunityCards: state.communityCards,
          pokerPlayers: state.players.map(p => {
            const agentInfo = matchState.pokerAgents?.find(a => a.agentId === p.playerId);
            return {
              seatIndex: p.seatIndex,
              name: agentInfo?.name,
              stack: p.stack,
              currentBet: p.currentBet,
              hasFolded: p.hasFolded,
              isAllIn: p.isAllIn,
              isEliminated: p.isEliminated,
            };
          }),
          pokerHandNumber: state.handNumber,
          pokerPlayerIndex: currentIndex,
        });

        await this.saveMove(matchId, agent.agentId, this.seatToSide(currentIndex), moveNumber, validatedAction, state, thinkingTimeMs);
        await this.persistPokerState(matchId, state);

        // Yield to event loop
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      // If hand is over (fold / only 1 remains), break out
      if (isHandOver(state)) break;

      // Advance to next street (or showdown)
      if (state.street !== 'showdown') {
        state = advanceStreet(state);
        this.logger.log(`Hand #${state.handNumber}: advancing to ${state.street} (match=${matchId})`);
        await this.persistPokerState(matchId, state);

        if (state.street === 'showdown') break;

        // If all remaining players are all-in, skip action loops
        if (allPlayersAllIn(state)) continue;
      }
    }

    // 3. Resolve hand
    const nonFolded = state.players.filter(p => !p.hasFolded && !p.isEliminated);
    if (nonFolded.length <= 1) {
      state = resolveFold(state);
      this.logger.log(`Hand #${state.handNumber}: fold — last player standing (match=${matchId})`);
    } else {
      state = resolveShowdown(state);
      if (state.showdownResult && state.showdownResult.length > 0) {
        const winners = state.showdownResult.filter(r => r.won > 0);
        this.logger.log(
          `Hand #${state.handNumber}: showdown — ${winners.length} winner(s): ${winners.map(w => `seat${w.seatIndex}=${w.hand.description}(+${w.won})`).join(', ')} (match=${matchId})`,
        );
      }
    }

    await this.persistPokerState(matchId, state);

    const matchOver = isMatchOver(state);
    return {
      pokerState: state,
      matchOver,
      winnerIndices: matchOver ? (state.winnerIndices ?? []) : [],
    };
  }

  private findAgent(matchState: ActiveMatchState, playerId: string): (PokerAgentInfo & { type?: string }) | null {
    // Check N-player poker agents first
    if (matchState.pokerAgents) {
      const found = matchState.pokerAgents.find(a => a.agentId === playerId);
      if (found) return found;
    }
    // Fallback to 2-player agents
    if (matchState.agents.a.agentId === playerId) {
      const a = matchState.agents.a;
      return { seatIndex: 0, agentId: a.agentId, name: 'Player A', endpointUrl: a.endpointUrl, walletAddress: a.walletAddress, type: a.type };
    }
    if (matchState.agents.b.agentId === playerId) {
      const b = matchState.agents.b;
      return { seatIndex: 1, agentId: b.agentId, name: 'Player B', endpointUrl: b.endpointUrl, walletAddress: b.walletAddress, type: b.type };
    }
    return null;
  }

  private seatToSide(seatIndex: number): 'a' | 'b' {
    return seatIndex === 0 ? 'a' : 'b';
  }

  private validateAction(
    response: PokerMoveResponse,
    legalActions: PokerLegalActions,
    seatIndex: number,
  ): { action: PokerActionType; amount?: number } {
    const action = response.action;

    if (action === 'fold' && legalActions.canFold) return { action: 'fold' };
    if (action === 'check' && legalActions.canCheck) return { action: 'check' };
    if (action === 'call' && legalActions.canCall) return { action: 'call', amount: legalActions.callAmount };
    if (action === 'all_in' && legalActions.canAllIn) return { action: 'all_in', amount: legalActions.allInAmount };
    if (action === 'raise' && legalActions.canRaise) {
      const amount = response.amount ?? legalActions.minRaise;
      const clampedAmount = Math.max(legalActions.minRaise, Math.min(legalActions.maxRaise, amount));
      return { action: 'raise', amount: clampedAmount };
    }

    // Invalid action — fallback to check if possible, otherwise fold
    this.logger.warn(`Invalid poker action "${action}" from seat ${seatIndex}, falling back`);
    if (legalActions.canCheck) return { action: 'check' };
    return { action: 'fold' };
  }

  private handleTimeout(matchState: ActiveMatchState, seatIndex: number): void {
    const { matchId } = matchState;

    // Update N-player timeout tracking
    if (matchState.pokerTimeouts) {
      const newTimeouts = { ...matchState.pokerTimeouts };
      newTimeouts[seatIndex] = (newTimeouts[seatIndex] ?? 0) + 1;
      this.activeMatches.updateMatch(matchId, { pokerTimeouts: newTimeouts });

      this.matchModel.updateOne(
        { _id: matchId },
        { [`timeouts.seat${seatIndex}`]: newTimeouts[seatIndex] },
      ).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to update timeout in DB for match ${matchId}: ${msg}`);
      });
    } else {
      // Legacy 2-player fallback
      const side: 'a' | 'b' = seatIndex === 0 ? 'a' : 'b';
      const newTimeouts = { ...matchState.timeouts };
      newTimeouts[side] += 1;
      this.activeMatches.updateMatch(matchId, { timeouts: newTimeouts });
    }

    this.eventBus.emit('match:timeout', { matchId, side: this.seatToSide(seatIndex), timeoutCount: (matchState.pokerTimeouts?.[seatIndex] ?? 0) + 1, seatIndex });
  }

  private async saveMove(
    matchId: string,
    agentId: string,
    side: Side,
    moveNumber: number,
    action: { action: PokerActionType; amount?: number },
    stateAfter: PokerGameState,
    thinkingTimeMs: number,
  ): Promise<void> {
    try {
      await this.moveModel.create({
        matchId, agentId, side, moveNumber,
        moveData: { row: 0, col: 0, pokerAction: action.action, pokerAmount: action.amount },
        boardStateAfter: [],
        scoreAfter: { a: stateAfter.players[0]?.stack ?? 0, b: stateAfter.players[1]?.stack ?? 0 },
        thinkingTimeMs,
        timestamp: new Date(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to save poker move #${moveNumber} for match ${matchId}: ${message}`);
    }
  }

  private async persistPokerState(matchId: string, state: PokerGameState): Promise<void> {
    // Strip deck from saved state (don't leak remaining cards)
    const stateToSave = { ...state, deck: [] };

    // Build scores map for N-player
    const pokerScores: Record<string, number> = {};
    for (const p of state.players) {
      pokerScores[p.playerId] = p.stack;
    }

    await this.matchModel.updateOne(
      { _id: matchId },
      {
        pokerState: stateToSave,
        currentTurn: String(state.currentPlayerIndex),
        moveCount: state.actionHistory.length,
        scores: { a: state.players[0]?.stack ?? 0, b: state.players[1]?.stack ?? 0 },
        pokerScores,
      },
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to persist poker state for match ${matchId}: ${msg}`);
    });
  }
}
