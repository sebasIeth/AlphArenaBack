import { UserModel } from "./models/user.model.js";
import { AgentModel } from "./models/agent.model.js";
import { DEFAULT_ELO } from "@alpharena/shared";

/**
 * Seed the database with test users and agents if no users exist.
 * Idempotent: does nothing if users already exist in the database.
 */
export async function seedDatabase(): Promise<void> {
  const existingUserCount = await UserModel.countDocuments();

  if (existingUserCount > 0) {
    console.log("[seed] Database already has users, skipping seed.");
    return;
  }

  console.log("[seed] No users found. Seeding database with test data...");

  const userA = await UserModel.create({
    walletAddress: "0xAliceTestWallet0000000000000000000000001",
    username: "alice",
    email: "alice@test.local",
    passwordHash: "$2b$10$placeholderHashForAliceTestUser000000000000000000",
    balance: 1000,
  });

  const userB = await UserModel.create({
    walletAddress: "0xBobTestWallet00000000000000000000000002",
    username: "bob",
    email: "bob@test.local",
    passwordHash: "$2b$10$placeholderHashForBobTestUser00000000000000000000",
    balance: 1000,
  });

  await AgentModel.create({
    userId: userA._id,
    name: "AliceBot",
    endpointUrl: "http://localhost:4001/move",
    eloRating: DEFAULT_ELO,
    stats: {
      wins: 0,
      losses: 0,
      draws: 0,
      totalMatches: 0,
      winRate: 0,
      totalEarnings: 0,
    },
    status: "idle",
    gameTypes: ["reversi"],
  });

  await AgentModel.create({
    userId: userB._id,
    name: "BobBot",
    endpointUrl: "http://localhost:4002/move",
    eloRating: DEFAULT_ELO,
    stats: {
      wins: 0,
      losses: 0,
      draws: 0,
      totalMatches: 0,
      winRate: 0,
      totalEarnings: 0,
    },
    status: "idle",
    gameTypes: ["reversi"],
  });

  console.log("[seed] Created test users: alice, bob");
  console.log("[seed] Created test agents: AliceBot, BobBot");
  console.log("[seed] Database seeding complete.");
}
