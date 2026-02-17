import { TURN_TIMEOUT_MS } from "@alpharena/shared";
import type { MoveRequest, MoveResponse } from "@alpharena/shared";
import pino from "pino";

const logger = pino({ name: "orchestrator:agent-client" });

/**
 * AgentClient is an HTTP client responsible for communicating with
 * remote AI agent endpoints to request moves during a match.
 *
 * It uses native `fetch` with an `AbortController` to enforce a
 * per-request timeout matching the turn timeout configuration.
 */
export class AgentClient {
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = TURN_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Send a move request to an agent's endpoint and await its response.
   *
   * @param endpointUrl - The full URL of the agent's move endpoint.
   * @param moveRequest - The payload describing the current game state and legal moves.
   * @returns The agent's chosen move as a `MoveResponse`.
   * @throws If the request times out, the agent returns a non-OK status,
   *         or the response cannot be parsed.
   */
  async requestMove(
    endpointUrl: string,
    moveRequest: MoveRequest,
  ): Promise<MoveResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    logger.info(
      {
        endpointUrl,
        matchId: moveRequest.matchId,
        moveNumber: moveRequest.moveNumber,
        yourPiece: moveRequest.yourPiece,
        legalMovesCount: moveRequest.legalMoves.length,
      },
      "Requesting move from agent",
    );

    const startTime = Date.now();

    try {
      const response = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(moveRequest),
        signal: controller.signal,
      });

      const elapsed = Date.now() - startTime;

      if (!response.ok) {
        const body = await response.text().catch(() => "<unreadable>");
        logger.error(
          {
            endpointUrl,
            matchId: moveRequest.matchId,
            status: response.status,
            body,
            elapsedMs: elapsed,
          },
          "Agent returned non-OK status",
        );
        throw new Error(
          `Agent returned HTTP ${response.status}: ${body}`,
        );
      }

      const data = (await response.json()) as MoveResponse;

      logger.info(
        {
          endpointUrl,
          matchId: moveRequest.matchId,
          move: data.move,
          elapsedMs: elapsed,
        },
        "Agent responded with move",
      );

      return data;
    } catch (error: unknown) {
      const elapsed = Date.now() - startTime;

      if (error instanceof DOMException && error.name === "AbortError") {
        logger.error(
          {
            endpointUrl,
            matchId: moveRequest.matchId,
            timeoutMs: this.timeoutMs,
            elapsedMs: elapsed,
          },
          "Agent request timed out",
        );
        throw new Error(
          `Agent at ${endpointUrl} did not respond within ${this.timeoutMs}ms`,
        );
      }

      // Handle the abort error in Node.js environments where it may be a
      // different type than DOMException.
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("aborted"))
      ) {
        logger.error(
          {
            endpointUrl,
            matchId: moveRequest.matchId,
            timeoutMs: this.timeoutMs,
            elapsedMs: elapsed,
          },
          "Agent request aborted (timeout)",
        );
        throw new Error(
          `Agent at ${endpointUrl} did not respond within ${this.timeoutMs}ms`,
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          endpointUrl,
          matchId: moveRequest.matchId,
          error: message,
          elapsedMs: elapsed,
        },
        "Agent request failed",
      );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
