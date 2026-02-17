import { ELO_MATCH_RANGE } from "@alpharena/shared";
import type { QueueEntry } from "./queue.js";

/**
 * Maximum percentage difference allowed between two agents' stake amounts.
 * Two stakes are considered compatible if the smaller is at least 80% of the larger.
 */
const STAKE_TOLERANCE = 0.2;

/**
 * Determine whether two stake amounts are within the acceptable tolerance.
 * Returns true if the smaller stake is at least (1 - STAKE_TOLERANCE) of the larger.
 */
function stakesCompatible(stakeA: number, stakeB: number): boolean {
  const larger = Math.max(stakeA, stakeB);
  const smaller = Math.min(stakeA, stakeB);
  if (larger === 0) return smaller === 0;
  return smaller >= larger * (1 - STAKE_TOLERANCE);
}

/**
 * Find all valid pairs from an array of waiting queue entries.
 *
 * Pairing criteria:
 * - Same gameType (caller should pre-filter, but this is enforced here too)
 * - ELO ratings within +/- ELO_MATCH_RANGE (default 200)
 * - Stake amounts within 20% of each other
 * - Different users (an agent cannot be matched against another agent owned by the same user)
 *
 * Entries are sorted by joinedAt ascending so that the longest-waiting agents
 * are paired first. Each entry is used in at most one pair per call.
 */
export function findPairs(
  waitingEntries: QueueEntry[]
): Array<[QueueEntry, QueueEntry]> {
  // Sort by wait time: oldest first
  const sorted = [...waitingEntries].sort(
    (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()
  );

  const paired = new Set<string>();
  const pairs: Array<[QueueEntry, QueueEntry]> = [];

  for (let i = 0; i < sorted.length; i++) {
    const entryA = sorted[i];

    // Skip if this agent has already been paired in this pass
    if (paired.has(entryA.agentId)) continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const entryB = sorted[j];

      // Skip if this agent has already been paired in this pass
      if (paired.has(entryB.agentId)) continue;

      // Must be same game type
      if (entryA.gameType !== entryB.gameType) continue;

      // Must be different users
      if (entryA.userId === entryB.userId) continue;

      // ELO must be within range
      const eloDiff = Math.abs(entryA.eloRating - entryB.eloRating);
      if (eloDiff > ELO_MATCH_RANGE) continue;

      // Stakes must be within tolerance
      if (!stakesCompatible(entryA.stakeAmount, entryB.stakeAmount)) continue;

      // Valid pair found
      pairs.push([entryA, entryB]);
      paired.add(entryA.agentId);
      paired.add(entryB.agentId);
      break; // Move on to the next unmatched agent
    }
  }

  return pairs;
}
