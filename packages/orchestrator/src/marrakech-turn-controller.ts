import type {
  MarrakechGameState,
  MarrakechMoveRequest,
  MarrakechMoveResponse,
  MarrakechDirection,
  MarrakechCarpetPlacement,
  Side,
  Board,
  Piece,
} from "@alpharena/shared";
import { marrakech } from "@alpharena/game-engine";
import { MoveModel, MatchModel } from "@alpharena/db";
import pino from "pino";

import { AgentClient } from "./agent-client.js";
import type { ActiveMatchState } from "./active-matches.js";
import { updateMatch } from "./active-matches.js";
import { eventBus } from "./event-bus.js";

const logger = pino({ name: "orchestrator:marrakech-turn-controller" });

/**
 * Result of executing a full Marrakech turn (orient → roll → [borderChoice] → tribute → place).
 */
export interface MarrakechTurnResult {
  gameOver: boolean;
  gameState: MarrakechGameState;
  timedOut: boolean;
}

function playerIndexToSide(index: number): Side {
  return index === 0 ? "a" : "b";
}

/**
 * MarrakechTurnController handles the multi-phase turn structure of Marrakech:
 * 1. Orient: Ask agent for direction
 * 2. Roll: Server rolls dice, moves Assam
 * 3. BorderChoice (sometimes): Ask agent for border direction
 * 4. Tribute: Auto-calculate and process
 * 5. Place: Ask agent for carpet placement
 */
export class MarrakechTurnController {
  private readonly agentClient: AgentClient;

  constructor(agentClient?: AgentClient) {
    this.agentClient = agentClient ?? new AgentClient();
  }

  async executeTurn(
    matchState: ActiveMatchState,
    mkState: MarrakechGameState,
  ): Promise<MarrakechTurnResult> {
    const { matchId } = matchState;
    const currentSide = playerIndexToSide(mkState.currentPlayerIndex);
    const agent = matchState.agents[currentSide];

    // Check if current player is eliminated or has no carpets
    const currentPlayer = mkState.players[mkState.currentPlayerIndex];
    if (currentPlayer.eliminated || currentPlayer.carpetsRemaining === 0) {
      const newState = marrakech.advanceToNextPlayer(mkState);
      return { gameOver: newState.gameOver, gameState: newState, timedOut: false };
    }

    logger.info(
      { matchId, turnNumber: mkState.turnNumber, currentPlayerIndex: mkState.currentPlayerIndex, side: currentSide },
      "Executing Marrakech turn",
    );

    let state = mkState;

    // Phase 1: Orient
    const validDirs = marrakech.getValidDirections(state.assam.direction);
    const orientResponse = await this.requestAction(
      agent.endpointUrl,
      matchId,
      "orient",
      state,
      { directions: validDirs },
      mkState.currentPlayerIndex,
      matchState,
    );

    if (!orientResponse) {
      return this.handleTimeout(matchState, state, currentSide);
    }

    if (orientResponse.action.type !== "orient" || !validDirs.includes(orientResponse.action.direction)) {
      logger.warn({ matchId, action: orientResponse.action }, "Invalid orient action");
      return this.handleTimeout(matchState, state, currentSide);
    }

    state = marrakech.orientAssam(state, orientResponse.action.direction);

    // Phase 2: Roll dice and move
    state = marrakech.rollAndMoveAssam(state);

    // Emit move event for real-time updates
    this.emitStateUpdate(matchId, state, currentSide, mkState.turnNumber);

    // Phase 3: BorderChoice (if Assam hit border)
    while (state.phase === "borderChoice" && state.borderChoiceInfo) {
      const borderOptions = state.borderChoiceInfo.options;
      const borderResponse = await this.requestAction(
        agent.endpointUrl,
        matchId,
        "borderChoice",
        state,
        { borderOptions },
        mkState.currentPlayerIndex,
        matchState,
      );

      if (!borderResponse) {
        // Auto-pick first option on timeout
        state = marrakech.chooseBorderDirection(state, borderOptions[0].direction);
        continue;
      }

      if (borderResponse.action.type !== "borderChoice") {
        state = marrakech.chooseBorderDirection(state, borderOptions[0].direction);
        continue;
      }

      const chosenDir = borderResponse.action.direction;
      if (!borderOptions.some((o) => o.direction === chosenDir)) {
        state = marrakech.chooseBorderDirection(state, borderOptions[0].direction);
        continue;
      }

      state = marrakech.chooseBorderDirection(state, chosenDir);
    }

    // Phase 4: Tribute (automatic)
    state = marrakech.processTribute(state);

    if (state.gameOver) {
      return { gameOver: true, gameState: state, timedOut: false };
    }

    this.emitStateUpdate(matchId, state, currentSide, mkState.turnNumber);

    // Phase 5: Place carpet
    if (state.validPlacements.length === 0) {
      // No valid placements, skip
      state = marrakech.skipPlace(state);
    } else {
      const placeResponse = await this.requestAction(
        agent.endpointUrl,
        matchId,
        "place",
        state,
        { placements: state.validPlacements },
        mkState.currentPlayerIndex,
        matchState,
      );

      if (!placeResponse) {
        // Timeout: place first valid placement
        state = marrakech.placeCarpet(state, state.validPlacements[0]);
      } else if (placeResponse.action.type === "skip") {
        state = marrakech.skipPlace(state);
      } else if (placeResponse.action.type === "place") {
        const placement = placeResponse.action.placement;
        const isValid = state.validPlacements.some(
          (p) =>
            p.cell1.row === placement.cell1.row &&
            p.cell1.col === placement.cell1.col &&
            p.cell2.row === placement.cell2.row &&
            p.cell2.col === placement.cell2.col,
        );

        if (isValid) {
          state = marrakech.placeCarpet(state, {
            ...placement,
            playerId: mkState.currentPlayerIndex,
            carpetId: "",
          });
        } else {
          logger.warn({ matchId, placement }, "Invalid carpet placement, using first valid");
          state = marrakech.placeCarpet(state, state.validPlacements[0]);
        }
      } else {
        state = marrakech.placeCarpet(state, state.validPlacements[0]);
      }
    }

    // Save move to DB
    await this.saveMove(matchId, agent.agentId, currentSide, mkState.turnNumber, state);

    // Serialize board for match document
    const serializedBoard = this.serializeBoard(state.board);
    await MatchModel.updateOne(
      { _id: matchId },
      {
        currentBoard: serializedBoard,
        currentTurn: playerIndexToSide(state.currentPlayerIndex),
        moveCount: state.turnNumber,
      },
    );

    this.emitStateUpdate(matchId, state, currentSide, state.turnNumber);

    return {
      gameOver: state.gameOver,
      gameState: state,
      timedOut: false,
    };
  }

  private async requestAction(
    endpointUrl: string,
    matchId: string,
    phase: "orient" | "borderChoice" | "place",
    state: MarrakechGameState,
    validActions: MarrakechMoveRequest["validActions"],
    playerIndex: number,
    matchState: ActiveMatchState,
  ): Promise<MarrakechMoveResponse | null> {
    const timeRemainingMs = matchState.clock
      ? matchState.clock.getTimeRemainingMs()
      : 30_000;

    const request: MarrakechMoveRequest = {
      matchId,
      gameType: "marrakech",
      phase,
      state,
      validActions,
      turnNumber: state.turnNumber,
      timeRemainingMs,
      yourPlayerIndex: playerIndex,
    };

    if (matchState.clock) {
      matchState.clock.startTurn();
    }

    try {
      const response = await this.agentClient.requestMove(
        endpointUrl,
        request as unknown as Parameters<AgentClient["requestMove"]>[1],
      );
      if (matchState.clock) {
        matchState.clock.clearTurn();
      }
      return response as unknown as MarrakechMoveResponse;
    } catch (error: unknown) {
      if (matchState.clock) {
        matchState.clock.clearTurn();
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ matchId, phase, error: message }, "Agent request failed");
      return null;
    }
  }

  private handleTimeout(
    matchState: ActiveMatchState,
    state: MarrakechGameState,
    side: Side,
  ): MarrakechTurnResult {
    const { matchId } = matchState;
    const newTimeouts = { ...matchState.timeouts };
    newTimeouts[side] += 1;
    updateMatch(matchId, { timeouts: newTimeouts });

    eventBus.emit("match:timeout", {
      matchId,
      side,
      timeoutCount: newTimeouts[side],
    });

    // Advance to next player on timeout
    const newState = marrakech.advanceToNextPlayer(state);

    return {
      gameOver: false,
      gameState: newState,
      timedOut: true,
    };
  }

  private emitStateUpdate(
    matchId: string,
    state: MarrakechGameState,
    side: Side,
    moveNumber: number,
  ): void {
    const scoreA = state.players[0]?.dirhams ?? 0;
    const scoreB = state.players[1]?.dirhams ?? 0;

    eventBus.emit("match:move", {
      matchId,
      side,
      move: { row: state.assam.position.row, col: state.assam.position.col },
      boardState: this.serializeBoard(state.board),
      score: { a: scoreA, b: scoreB },
      moveNumber,
      thinkingTimeMs: 0,
    });
  }

  private serializeBoard(board: MarrakechGameState["board"]): Board {
    return board.map((row) =>
      row.map((cell) => (cell ? cell.playerId + 1 : 0) as Piece),
    ) as Board;
  }

  private async saveMove(
    matchId: string,
    agentId: string,
    side: Side,
    moveNumber: number,
    state: MarrakechGameState,
  ): Promise<void> {
    try {
      await MoveModel.create({
        matchId,
        agentId,
        side,
        moveNumber,
        moveData: { row: state.assam.position.row, col: state.assam.position.col },
        boardStateAfter: this.serializeBoard(state.board),
        scoreAfter: {
          a: state.players[0]?.dirhams ?? 0,
          b: state.players[1]?.dirhams ?? 0,
        },
        thinkingTimeMs: 0,
        timestamp: new Date(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ matchId, moveNumber, error: message }, "Failed to save Marrakech move");
    }
  }
}
