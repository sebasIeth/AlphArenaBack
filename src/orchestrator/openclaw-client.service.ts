import { Injectable, Logger } from '@nestjs/common';
import {
  MarrakechGameState,
  MarrakechMoveResponse,
  MarrakechValidActions,
  MarrakechDirection,
  MarrakechCarpetPlacement,
} from '../common/types';
import { OpenClawWsService } from '../openclaw-ws';

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

// ─── System Prompts ─────────────────────────────────────────────────────────

const MARRAKECH_SYSTEM = `You are a competitive Marrakech board game AI playing in a tournament for cryptocurrency stakes.
RULES:
- 7x7 grid. Players move merchant Assam then place 1x2 rugs.
- Rent = number of connected same-color rugs where Assam lands.
- Game ends when all rugs placed. Score = coins + visible rug cells.
STRATEGY:
1. ORIENT: Direct Assam toward opponent rugs (they pay you). Avoid your own clusters.
2. PLACE: Extend your rug clusters for higher rent. Cover opponent rugs to break theirs.
3. Prefer center positions. Avoid isolated placements.
RESPOND WITH ONLY A JSON OBJECT. No text, no markdown, no explanation.`;

const REVERSI_SYSTEM = `You are a competitive Reversi AI playing in a tournament for cryptocurrency stakes.
STRATEGY: Corners are most valuable, then edges, then center. Avoid cells diagonally adjacent to empty corners.
RESPOND WITH ONLY A JSON OBJECT. No text, no markdown, no explanation.`;

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

  constructor(private readonly openclawWs: OpenClawWsService) {}

  // ─── OpenClaw WebSocket RPC Call ──────────────────────────────────────────

  private async callOpenClaw(
    agent: OpenClawAgentInfo,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const message = `${systemPrompt}\n\n${userPrompt}`;

    const result = await this.openclawWs.sendAgentMessage(
      agent.openclawUrl,
      agent.openclawToken,
      {
        message,
        agentId: agent.openclawAgentId || 'main',
      },
    );

    // Extract text content from the RPC result
    if (typeof result === 'string') return result;
    if (result.content) return String(result.content);
    if (result.message) return String(result.message);
    if (result.text) return String(result.text);
    if (result.result) return typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
    return JSON.stringify(result);
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
  ): Promise<OpenClawMoveResult> {
    const { matchId, board, yourPiece, legalMoves, moveNumber } = gameState;

    const userPrompt = `Move #${moveNumber}. You: ${yourPiece}. Legal: ${JSON.stringify(legalMoves)}\nBoard: ${JSON.stringify(board)}\n\nRespond: {"move":[row,col]}`;

    try {
      const raw = await this.callOpenClaw(agent, REVERSI_SYSTEM, userPrompt);
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
  ): Promise<MarrakechMoveResponse | null> {
    const userPrompt = this.buildMarrakechPrompt(phase, state, validActions, playerIndex);

    try {
      const raw = await this.callOpenClaw(agent, MARRAKECH_SYSTEM, userPrompt);
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
    const header = `Turn #${state.turnNumber} | You: Player ${playerIndex} | Assam: (${state.assam.position.row},${state.assam.position.col}) facing ${state.assam.direction}`;

    switch (phase) {
      case 'orient':
        return `${header}\nValid directions: ${JSON.stringify(validActions.directions)}\nPlayers: ${JSON.stringify(state.players.map((p) => ({ id: p.id, dirhams: p.dirhams, carpets: p.carpetsRemaining })))}\nBoard (7x7, null=empty, {playerId,carpetId}=rug): ${JSON.stringify(state.board)}\n\nRespond: {"action":{"type":"orient","direction":"X"}}`;

      case 'borderChoice': {
        const options = validActions.borderOptions || [];
        return `${header}\nAssam hit the border. Options: ${JSON.stringify(options)}\n\nRespond: {"action":{"type":"borderChoice","direction":"X"}}`;
      }

      case 'place': {
        const pl = validActions.placements || [];
        if (pl.length === 0) return 'No placements. Respond: {"action":{"type":"skip"}}';
        const shown = pl.slice(0, 25)
          .map((p, i) => `[${i}] (${p.cell1.row},${p.cell1.col})-(${p.cell2.row},${p.cell2.col})`)
          .join(', ');
        const more = pl.length > 25 ? ` ...+${pl.length - 25} more` : '';
        return `${header}\nPlayers: ${JSON.stringify(state.players.map((p) => ({ id: p.id, dirhams: p.dirhams, carpets: p.carpetsRemaining })))}\nBoard: ${JSON.stringify(state.board)}\n${pl.length} placements: ${shown}${more}\n\nRespond: {"action":{"type":"place","placement":{"cell1":{"row":R,"col":C},"cell2":{"row":R,"col":C}}}}`;
      }

      default:
        return 'Respond: {"action":{"type":"skip"}}';
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
