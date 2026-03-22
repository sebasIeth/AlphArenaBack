import { ELO_MATCH_RANGE } from '../common/constants/game.constants';
import { QueueEntryData } from './matchmaking.queue';

const STAKE_TOLERANCE = 0.2;
const POKER_MAX_PLAYERS = 9;
const POKER_MIN_PLAYERS = 2;

function stakesCompatible(stakeA: number, stakeB: number): boolean {
  const larger = Math.max(stakeA, stakeB);
  const smaller = Math.min(stakeA, stakeB);
  if (larger === 0) return smaller === 0;
  return smaller >= larger * (1 - STAKE_TOLERANCE);
}

/** Find common game types between two entries */
function getCommonGameTypes(a: QueueEntryData, b: QueueEntryData): string[] {
  const aTypes = a.gameTypes || [a.gameType];
  const bTypes = b.gameTypes || [b.gameType];
  return aTypes.filter(t => bTypes.includes(t));
}

/** Pick a random game type from common ones */
function pickRandomGameType(common: string[]): string {
  return common[Math.floor(Math.random() * common.length)];
}

/**
 * Universal pairing: match any 2 agents with compatible stake/elo and at least 1 common game type.
 * Returns pairs with the chosen gameType.
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

      // Must have at least 1 common game type
      const common = getCommonGameTypes(entryA, entryB);
      if (common.length === 0) continue;

      if (process.env.NODE_ENV !== 'development' && entryA.userId === entryB.userId) {
        const hasHumanOrPull = entryA.agentType === 'human' || entryB.agentType === 'human'
          || entryA.agentType === 'pull' || entryB.agentType === 'pull';
        if (!hasHumanOrPull) continue;
      }
      if (Math.abs(entryA.eloRating - entryB.eloRating) > ELO_MATCH_RANGE) continue;
      if (!stakesCompatible(entryA.stakeAmount, entryB.stakeAmount)) continue;

      // Same token required
      if ((entryA.token || 'ALPHA') !== (entryB.token || 'ALPHA')) continue;

      const chosenGame = pickRandomGameType(common);
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
 * Only groups agents that share "poker" in their game types.
 */
export function findPokerGroup(waitingEntries: QueueEntryData[]): QueueEntryData[] | null {
  // Filter to agents that support poker
  const pokerEntries = waitingEntries.filter(e => {
    const types = e.gameTypes || [e.gameType];
    return types.includes('poker');
  });

  if (pokerEntries.length < POKER_MIN_PLAYERS) return null;

  const sorted = [...pokerEntries].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  const group: QueueEntryData[] = [sorted[0]];

  for (let i = 1; i < sorted.length && group.length < POKER_MAX_PLAYERS; i++) {
    const candidate = sorted[i];
    const baseStake = group[0].stakeAmount;

    // Same token required
    if ((candidate.token || 'ALPHA') !== (group[0].token || 'ALPHA')) continue;

    // ELO range check against the group average
    const avgElo = group.reduce((s, e) => s + e.eloRating, 0) / group.length;
    if (Math.abs(candidate.eloRating - avgElo) > ELO_MATCH_RANGE * 1.5) continue;

    // Stake compatibility
    if (!stakesCompatible(baseStake, candidate.stakeAmount)) continue;

    group.push(candidate);
  }

  return group.length >= POKER_MIN_PLAYERS ? group : null;
}
