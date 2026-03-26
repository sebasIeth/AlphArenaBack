import { ELO_MATCH_RANGE, GAME_TYPES } from '../common/constants/game.constants';
import { QueueEntryData } from './matchmaking.queue';

const STAKE_TOLERANCE = 0.2;
const POKER_MAX_PLAYERS = 9;
const POKER_MIN_PLAYERS = 2;

/** 2-player game types the system can pick from */
const TWO_PLAYER_GAMES = GAME_TYPES.filter(g => g !== 'poker');

function stakesCompatible(stakeA: number, stakeB: number): boolean {
  const larger = Math.max(stakeA, stakeB);
  const smaller = Math.min(stakeA, stakeB);
  if (larger === 0) return smaller === 0;
  return smaller >= larger * (1 - STAKE_TOLERANCE);
}

function pickRandomGame(): string {
  return TWO_PLAYER_GAMES[Math.floor(Math.random() * TWO_PLAYER_GAMES.length)];
}

/**
 * Universal pairing: match any 2 agents with compatible stake/elo/token.
 * The system picks the game type randomly.
 */
export function findPairs(waitingEntries: QueueEntryData[]): Array<[QueueEntryData, QueueEntryData, string]> {
  const sorted = [...waitingEntries].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  const paired = new Set<string>();
  const pairs: Array<[QueueEntryData, QueueEntryData, string]> = [];

  for (let i = 0; i < sorted.length; i++) {
    const entryA = sorted[i];
    if (paired.has(entryA.agentId)) continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const entryB = sorted[j];
      if (paired.has(entryB.agentId)) continue;

      if (process.env.NODE_ENV !== 'development' && entryA.userId === entryB.userId) {
        const hasHumanOrPull = entryA.agentType === 'human' || entryB.agentType === 'human'
          || entryA.agentType === 'pull' || entryB.agentType === 'pull';
        if (!hasHumanOrPull) continue;
      }
      if (Math.abs(entryA.eloRating - entryB.eloRating) > ELO_MATCH_RANGE) continue;
      if (!stakesCompatible(entryA.stakeAmount, entryB.stakeAmount)) continue;

      // Same token required
      if ((entryA.token || 'USDC') !== (entryB.token || 'USDC')) continue;

      // Respect specific game type requests; skip if incompatible
      const gtA = entryA.gameType;
      const gtB = entryB.gameType;
      const aSpecific = gtA && gtA !== 'any' && gtA !== 'poker';
      const bSpecific = gtB && gtB !== 'any' && gtB !== 'poker';
      let chosenGame: string;
      if (aSpecific && bSpecific) {
        if (gtA !== gtB) continue;
        chosenGame = gtA;
      } else if (aSpecific) {
        chosenGame = gtA;
      } else if (bSpecific) {
        chosenGame = gtB!;
      } else {
        chosenGame = pickRandomGame();
      }
      pairs.push([entryA, entryB, chosenGame]);
      paired.add(entryA.agentId);
      paired.add(entryB.agentId);
      break;
    }
  }
  return pairs;
}

/**
 * For poker: group 2-9 compatible agents into a single table.
 * Only groups agents that queued for "poker".
 */
export function findPokerGroup(waitingEntries: QueueEntryData[]): QueueEntryData[] | null {
  // Filter to agents that queued for poker
  const pokerEntries = waitingEntries.filter(e => e.gameType === 'poker');

  if (pokerEntries.length < POKER_MIN_PLAYERS) return null;

  const sorted = [...pokerEntries].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  const group: QueueEntryData[] = [sorted[0]];

  for (let i = 1; i < sorted.length && group.length < POKER_MAX_PLAYERS; i++) {
    const candidate = sorted[i];
    const baseStake = group[0].stakeAmount;

    // Same token required
    if ((candidate.token || 'USDC') !== (group[0].token || 'USDC')) continue;

    // ELO range check against the group average
    const avgElo = group.reduce((s, e) => s + e.eloRating, 0) / group.length;
    if (Math.abs(candidate.eloRating - avgElo) > ELO_MATCH_RANGE * 1.5) continue;

    // Stake compatibility
    if (!stakesCompatible(baseStake, candidate.stakeAmount)) continue;

    group.push(candidate);
  }

  return group.length >= POKER_MIN_PLAYERS ? group : null;
}
