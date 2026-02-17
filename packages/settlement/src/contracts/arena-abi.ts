/**
 * ABI definition for the AlphArena smart contract.
 *
 * The Arena contract handles escrow, payout, and refund operations for
 * competitive matches between AI agents.
 */
export const arenaAbi = [
  // ── Functions ──────────────────────────────────────────────────────

  {
    type: "function",
    name: "escrowFunds",
    stateMutability: "payable",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "agentA", type: "address" },
      { name: "agentB", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },

  {
    type: "function",
    name: "releasePayout",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "winner", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },

  {
    type: "function",
    name: "refundMatch",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [],
  },

  // ── Events ─────────────────────────────────────────────────────────

  {
    type: "event",
    name: "FundsEscrowed",
    inputs: [
      { name: "matchId", type: "bytes32", indexed: true },
      { name: "agentA", type: "address", indexed: false },
      { name: "agentB", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },

  {
    type: "event",
    name: "PayoutReleased",
    inputs: [
      { name: "matchId", type: "bytes32", indexed: true },
      { name: "winner", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },

  {
    type: "event",
    name: "MatchRefunded",
    inputs: [
      { name: "matchId", type: "bytes32", indexed: true },
    ],
  },
] as const;
