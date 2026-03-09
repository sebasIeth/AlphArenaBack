import { ELO_MATCH_RANGE } from '../common/constants/game.constants';
import { QueueEntryData } from './matchmaking.queue';

const STAKE_TOLERANCE = 0.2;

/** ELO range expands by this amount per second of waiting */
const ELO_RANGE_EXPANSION_PER_SEC = 10;

function stakesCompatible(stakeA: number, stakeB: number): boolean {
  const larger = Math.max(stakeA, stakeB);
  const smaller = Math.min(stakeA, stakeB);
  if (larger === 0) return smaller === 0;
  return smaller >= larger * (1 - STAKE_TOLERANCE);
}

export function findPairs(waitingEntries: QueueEntryData[]): Array<[QueueEntryData, QueueEntryData]> {
  const sorted = [...waitingEntries].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  const paired = new Set<string>();
  const pairs: Array<[QueueEntryData, QueueEntryData]> = [];
  const now = Date.now();

  for (let i = 0; i < sorted.length; i++) {
    const entryA = sorted[i];
    if (paired.has(entryA.agentId)) continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const entryB = sorted[j];
      if (paired.has(entryB.agentId)) continue;
      if (entryA.gameType !== entryB.gameType) continue;
      if (entryA.chain !== entryB.chain) continue;
      if (process.env.NODE_ENV !== 'development' && entryA.userId === entryB.userId) {
        // Allow same-user pairing when one side is a human player
        const hasHuman = entryA.agentType === 'human' || entryB.agentType === 'human';
        if (!hasHuman) continue;
      }

      // ELO range expands the longer the oldest entry has waited
      const waitMs = now - entryA.joinedAt.getTime();
      const waitSec = waitMs / 1_000;
      const effectiveRange = ELO_MATCH_RANGE + waitSec * ELO_RANGE_EXPANSION_PER_SEC;
      if (Math.abs(entryA.eloRating - entryB.eloRating) > effectiveRange) continue;

      if (!stakesCompatible(entryA.stakeAmount, entryB.stakeAmount)) continue;

      pairs.push([entryA, entryB]);
      paired.add(entryA.agentId);
      paired.add(entryB.agentId);
      break;
    }
  }
  return pairs;
}
