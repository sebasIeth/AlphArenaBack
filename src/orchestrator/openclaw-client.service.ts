import { Injectable, Logger } from '@nestjs/common';
import {
  MarrakechGameState,
  MarrakechMoveResponse,
  MarrakechValidActions,
  MarrakechDirection,
  MarrakechCarpetPlacement,
} from '../common/types';
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

    for (let attempt = 0; attempt <= OpenClawClientService.MAX_RETRIES; attempt++) {
      try {
        return await this.openclawWs.sendAgentChat(
          agent.openclawUrl,
          agent.openclawToken,
          message,
          agentId,
        );
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

    const message = `Es tu turno en Reversi (movimiento #${moveNumber}). Juegas con ${yourPiece === 'B' ? 'negras (1)' : 'blancas (2)'}.\n\nTablero actual:\n${board.map((row) => row.join(' ')).join('\n')}\n\nMovimientos legales: ${JSON.stringify(legalMoves)}\n\nElige tu movimiento y responde SOLO con JSON: {"move":[fila,columna]}`;

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
    const players = state.players.map((p) => `Jugador ${p.id}: ${p.dirhams} dirhams, ${p.carpetsRemaining} alfombras restantes`).join('\n');
    const assam = `Assam esta en (${state.assam.position.row},${state.assam.position.col}) mirando hacia ${state.assam.direction}`;

    switch (phase) {
      case 'orient':
        return `Turno #${state.turnNumber} en Marrakech. Eres el jugador ${playerIndex}.\n\n${assam}\n${players}\n\nTablero (7x7):\n${JSON.stringify(state.board)}\n\nPuedes orientar a Assam en estas direcciones: ${JSON.stringify(validActions.directions)}\n\nElige una direccion y responde SOLO con JSON: {"action":{"type":"orient","direction":"DIRECCION"}}`;

      case 'borderChoice': {
        const options = validActions.borderOptions || [];
        return `Turno #${state.turnNumber}. Assam llego al borde del tablero.\n\nOpciones disponibles: ${JSON.stringify(options)}\n\nElige hacia donde continua y responde SOLO con JSON: {"action":{"type":"borderChoice","direction":"DIRECCION"}}`;
      }

      case 'place': {
        const pl = validActions.placements || [];
        if (pl.length === 0) return 'No hay posiciones disponibles para colocar alfombra. Responde SOLO con JSON: {"action":{"type":"skip"}}';
        const shown = pl.slice(0, 25)
          .map((p, i) => `[${i}] (${p.cell1.row},${p.cell1.col})-(${p.cell2.row},${p.cell2.col})`)
          .join(', ');
        const more = pl.length > 25 ? ` ...+${pl.length - 25} mas` : '';
        return `Turno #${state.turnNumber}. Ahora coloca tu alfombra.\n\n${players}\n\nTablero:\n${JSON.stringify(state.board)}\n\nPosiciones disponibles (${pl.length}): ${shown}${more}\n\nElige donde colocar tu alfombra y responde SOLO con JSON: {"action":{"type":"place","placement":{"cell1":{"row":FILA,"col":COL},"cell2":{"row":FILA,"col":COL}}}}`;
      }

      default:
        return 'Responde SOLO con JSON: {"action":{"type":"skip"}}';
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
