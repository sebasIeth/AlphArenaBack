import { Injectable, Logger } from '@nestjs/common';
import {
  MarrakechGameState,
  MarrakechMoveResponse,
  MarrakechValidActions,
  MarrakechDirection,
  MarrakechCarpetPlacement,
  ChessUciMove,
} from '../common/types';
import { TURN_TIMEOUT_MS } from '../common/constants/game.constants';
import { OpenClawWsService } from '../openclaw-ws';
import { EventBusService } from './event-bus.service';

export interface OpenClawAgentInfo {
  openclawUrl: string;
  openclawToken: string;
  openclawAgentId: string;
}

export interface OpenClawMoveResult {
  move: unknown;
  source: 'ai' | 'fallback' | 'error';
  raw?: string;
  error?: string;
}


// ─── JSON Extraction ────────────────────────────────────────────────────────

function extractJSON(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const cleaned = text.trim();
  try { return JSON.parse(cleaned); } catch {}
  const cb = cleaned.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (cb) try { return JSON.parse(cb[1]); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return null;
}

@Injectable()
export class OpenClawClientService {
  private readonly logger = new Logger(OpenClawClientService.name);

  constructor(
    private readonly openclawWs: OpenClawWsService,
    private readonly eventBus: EventBusService,
  ) {}

  // ─── OpenClaw WS Call ──────────────────────────────────────────

  private static readonly MAX_RETRIES = 3;
  private static readonly RATE_LIMIT_DELAY_MS = 5000;

  private async callOpenClaw(
    agent: OpenClawAgentInfo,
    message: string,
  ): Promise<string> {
    const agentId = agent.openclawAgentId || 'main';

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`OpenClaw did not respond within ${TURN_TIMEOUT_MS}ms`)), TURN_TIMEOUT_MS);
    });

    for (let attempt = 0; attempt <= OpenClawClientService.MAX_RETRIES; attempt++) {
      try {
        return await Promise.race([
          this.openclawWs.sendAgentChat(
            agent.openclawUrl,
            agent.openclawToken,
            message,
            agentId,
          ),
          timeoutPromise,
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isRateLimit = msg.includes('rate limit');

        if (isRateLimit && attempt < OpenClawClientService.MAX_RETRIES) {
          const delay = OpenClawClientService.RATE_LIMIT_DELAY_MS * (attempt + 1);
          this.logger.warn(`OpenClaw rate limit, retrying in ${delay}ms (attempt ${attempt + 1}/${OpenClawClientService.MAX_RETRIES})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }

    throw new Error('OpenClaw call failed after all retries');
  }

  // ─── Reversi ──────────────────────────────────────────────────────────

  async getReversiMove(
    agent: OpenClawAgentInfo,
    gameState: {
      matchId: string;
      board: number[][];
      yourPiece: string;
      legalMoves: [number, number][];
      moveNumber: number;
    },
    context?: { side: 'a' | 'b'; agentId: string },
  ): Promise<OpenClawMoveResult> {
    const { matchId, board, yourPiece, legalMoves, moveNumber } = gameState;

    const message = `It's your turn in Reversi (move #${moveNumber}). You play as ${yourPiece === 'B' ? 'black (1)' : 'white (2)'}.\n\nCurrent board:\n${board.map((row) => row.join(' ')).join('\n')}\n\nLegal moves: ${JSON.stringify(legalMoves)}\n\nYou MUST respond in English. Briefly explain your reasoning and then respond with JSON: {"thinking":"your brief reasoning","move":[row,col]}`;

    try {
      const raw = await this.callOpenClaw(agent, message);

      if (context) {
        this.eventBus.emit('agent:thinking', {
          matchId, side: context.side, agentId: context.agentId,
          raw, moveNumber,
        });
      }

      const parsed = extractJSON(raw);

      if (parsed?.move && Array.isArray(parsed.move)) {
        const [r, c] = parsed.move as [number, number];
        const isValid = legalMoves.some((m) => m[0] === r && m[1] === c);
        if (isValid) {
          return { move: { move: [r, c] }, source: 'ai', raw };
        }
      }

      this.logger.warn(`OpenClaw reversi: invalid move, using fallback. Raw: ${raw?.substring(0, 100)}`);
      return { move: { move: legalMoves[0] }, source: 'fallback', raw };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`OpenClaw reversi error: ${message}`);
      return { move: { move: legalMoves[0] }, source: 'error', error: message };
    }
  }

  // ─── Marrakech ────────────────────────────────────────────────────────

  async getMarrakechMove(
    agent: OpenClawAgentInfo,
    matchId: string,
    phase: 'orient' | 'borderChoice' | 'place',
    state: MarrakechGameState,
    validActions: MarrakechValidActions,
    playerIndex: number,
    context?: { side: 'a' | 'b'; agentId: string },
  ): Promise<MarrakechMoveResponse | null> {
    const message = this.buildMarrakechPrompt(phase, state, validActions, playerIndex);

    try {
      const raw = await this.callOpenClaw(agent, message);

      if (context) {
        this.eventBus.emit('agent:thinking', {
          matchId, side: context.side, agentId: context.agentId,
          raw, moveNumber: state.turnNumber,
        });
      }

      const parsed = extractJSON(raw);
      if (!parsed) {
        this.logger.warn(`OpenClaw marrakech: failed to parse JSON. Raw: ${raw?.substring(0, 100)}`);
        return null;
      }
      const validated = this.validateMarrakechResponse(parsed, phase, validActions);
      if (!validated) {
        this.logger.warn(`OpenClaw marrakech: invalid response for phase=${phase}. Raw: ${raw?.substring(0, 100)}`);
      }
      return validated;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`OpenClaw marrakech error (phase=${phase}): ${message}`);
      return null;
    }
  }

  private buildMarrakechPrompt(
    phase: string,
    state: MarrakechGameState,
    validActions: MarrakechValidActions,
    playerIndex: number,
  ): string {
    const players = state.players.map((p) => `Player ${p.id}: ${p.dirhams} dirhams, ${p.carpetsRemaining} carpets remaining`).join('\n');
    const assam = `Assam is at (${state.assam.position.row},${state.assam.position.col}) facing ${state.assam.direction}`;

    switch (phase) {
      case 'orient':
        return `Turn #${state.turnNumber} in Marrakech. You are player ${playerIndex}.\n\n${assam}\n${players}\n\nBoard (7x7):\n${JSON.stringify(state.board)}\n\nYou can orient Assam in these directions: ${JSON.stringify(validActions.directions)}\n\nYou MUST respond in English. Briefly explain your reasoning and respond with JSON: {"thinking":"your brief reasoning","action":{"type":"orient","direction":"DIRECTION"}}`;

      case 'borderChoice': {
        const options = validActions.borderOptions || [];
        return `Turn #${state.turnNumber}. Assam reached the edge of the board.\n\nAvailable options: ${JSON.stringify(options)}\n\nYou MUST respond in English. Briefly explain your reasoning and respond with JSON: {"thinking":"your brief reasoning","action":{"type":"borderChoice","direction":"DIRECTION"}}`;
      }

      case 'place': {
        const pl = validActions.placements || [];
        if (pl.length === 0) return 'No available positions to place a carpet. Respond with JSON: {"thinking":"no options","action":{"type":"skip"}}';
        const shown = pl.slice(0, 25)
          .map((p, i) => `[${i}] (${p.cell1.row},${p.cell1.col})-(${p.cell2.row},${p.cell2.col})`)
          .join(', ');
        const more = pl.length > 25 ? ` ...+${pl.length - 25} more` : '';
        return `Turn #${state.turnNumber}. Now place your carpet.\n\n${players}\n\nBoard:\n${JSON.stringify(state.board)}\n\nAvailable positions (${pl.length}): ${shown}${more}\n\nYou MUST respond in English. Briefly explain your reasoning and respond with JSON: {"thinking":"your brief reasoning","action":{"type":"place","placement":{"cell1":{"row":ROW,"col":COL},"cell2":{"row":ROW,"col":COL}}}}`;
      }

      default:
        return 'Respond with JSON: {"thinking":"skip","action":{"type":"skip"}}';
    }
  }

  // ─── Chess ──────────────────────────────────────────────────────────────

  async getChessMove(
    agent: OpenClawAgentInfo,
    gameState: {
      matchId: string;
      fen: string;
      board: number[][];
      yourColor: 'white' | 'black';
      legalMoves: ChessUciMove[];
      moveNumber: number;
      isCheck: boolean;
      moveHistory: ChessUciMove[];
    },
    context?: { side: 'a' | 'b'; agentId: string },
  ): Promise<OpenClawMoveResult> {
    const { matchId, fen, yourColor, legalMoves, moveNumber, isCheck, moveHistory } = gameState;

    const checkStr = isCheck ? ' You are in CHECK!' : '';
    const historyStr = moveHistory.length > 0
      ? `\nMove history: ${moveHistory.join(' ')}`
      : '';

    const message = `It's your turn in Chess (move #${moveNumber}). You play as ${yourColor}.${checkStr}\n\nFEN: ${fen}${historyStr}\n\nLegal moves (UCI format): ${legalMoves.join(', ')}\n\nYou MUST respond in English. Briefly explain your reasoning and then respond with JSON: {"thinking":"your brief reasoning","move":"e2e4"}`;

    try {
      const raw = await this.callOpenClaw(agent, message);

      if (context) {
        this.eventBus.emit('agent:thinking', {
          matchId, side: context.side, agentId: context.agentId,
          raw, moveNumber,
        });
      }

      const parsed = extractJSON(raw);

      if (parsed?.move && typeof parsed.move === 'string') {
        const move = parsed.move as string;
        if (legalMoves.includes(move)) {
          return { move: { move }, source: 'ai', raw };
        }
      }

      this.logger.warn(`OpenClaw chess: invalid move, using fallback. Raw: ${raw?.substring(0, 100)}`);
      return { move: { move: legalMoves[0] }, source: 'fallback', raw };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`OpenClaw chess error: ${errMsg}`);
      return { move: { move: legalMoves[0] }, source: 'error', error: errMsg };
    }
  }

  private validateMarrakechResponse(
    parsed: Record<string, unknown>,
    phase: string,
    validActions: MarrakechValidActions,
  ): MarrakechMoveResponse | null {
    const action = parsed.action as Record<string, unknown> | undefined;
    if (!action) return null;

    switch (phase) {
      case 'orient': {
        const dir = action.direction as MarrakechDirection;
        if (validActions.directions && validActions.directions.includes(dir)) {
          return { action: { type: 'orient', direction: dir } };
        }
        return null;
      }

      case 'borderChoice': {
        const dir = action.direction as MarrakechDirection;
        if (validActions.borderOptions && validActions.borderOptions.some((o) => o.direction === dir)) {
          return { action: { type: 'borderChoice', direction: dir } };
        }
        return null;
      }

      case 'place': {
        if (action.type === 'skip') {
          return { action: { type: 'skip' } };
        }
        const pl = validActions.placements || [];
        if (pl.length === 0) return { action: { type: 'skip' } };
        const placement = action.placement as { cell1: { row: number; col: number }; cell2: { row: number; col: number } } | undefined;
        if (!placement?.cell1 || !placement?.cell2) return null;
        const isValid = pl.some(
          (v) =>
            (v.cell1.row === placement.cell1.row && v.cell1.col === placement.cell1.col &&
             v.cell2.row === placement.cell2.row && v.cell2.col === placement.cell2.col) ||
            (v.cell1.row === placement.cell2.row && v.cell1.col === placement.cell2.col &&
             v.cell2.row === placement.cell1.row && v.cell2.col === placement.cell1.col),
        );
        if (isValid) {
          return { action: { type: 'place', placement: { cell1: placement.cell1, cell2: placement.cell2 } } };
        }
        return null;
      }

      default:
        return null;
    }
  }
}
