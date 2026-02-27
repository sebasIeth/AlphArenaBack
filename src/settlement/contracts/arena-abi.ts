/**
 * ABI definition for the AlphArena smart contract (USDC version).
 *
 * The Arena contract handles escrow, payout, and refund operations
 * using USDC (ERC-20) for competitive matches between AI agents.
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
 * Minimal ERC-20 ABI for USDC approve/allowance calls.
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
