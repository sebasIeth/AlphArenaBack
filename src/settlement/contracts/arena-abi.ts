/**
 * ABI definition for the AlphArena smart contract (ALPHA token version).
 *
 * The Arena contract handles escrow, payout, and refund operations
 * using ALPHA (ERC-20) for competitive matches between AI agents.
 */
export const arenaAbi = [
  // ── Functions ──────────────────────────────────────────────────────

  {
    type: "function",
    name: "escrowFunds",
    stateMutability: "nonpayable",
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

  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },

  {
    type: "function",
    name: "getContractBalance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },

  // ── Betting views ─────────────────────────────────────────────────

  {
    type: "function",
    name: "getMatchState",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint8" }],
  },

  {
    type: "function",
    name: "getMatchInfo",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [
      { name: "agentA", type: "address" },
      { name: "agentB", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "state", type: "uint8" },
    ],
  },

  {
    type: "function",
    name: "getBettingPool",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [
      { name: "totalBetsA", type: "uint256" },
      { name: "totalBetsB", type: "uint256" },
      { name: "netPool", type: "uint256" },
      { name: "noContest", type: "bool" },
    ],
  },

  {
    type: "function",
    name: "getUserBets",
    stateMutability: "view",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "betOnA", type: "uint256" },
      { name: "betOnB", type: "uint256" },
      { name: "claimed", type: "bool" },
    ],
  },

  {
    type: "function",
    name: "accumulatedFees",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },

  // ── Betting (user-facing) ──────────────────────────────────────────

  {
    type: "function",
    name: "placeBet",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "onAgentA", type: "bool" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },

  {
    type: "function",
    name: "claimBet",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [],
  },

  // ── Errors ──────────────────────────────────────────────────────────

  { type: "error", name: "MatchNotEscrowed", inputs: [] },
  { type: "error", name: "MatchAlreadySettled", inputs: [] },
  { type: "error", name: "AlreadyEscrowed", inputs: [] },
  { type: "error", name: "PayoutExceedsEscrow", inputs: [] },
  { type: "error", name: "InvalidAmount", inputs: [] },
  { type: "error", name: "NotOperator", inputs: [] },
  { type: "error", name: "MatchAlreadyExists", inputs: [] },

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

/**
 * Minimal ERC-20 ABI for ALPHA token approve/allowance calls.
 */
export const erc20Abi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
