#!/usr/bin/env node
/**
 * Setup script for Solana devnet testing.
 *
 * What it does:
 * 1. Airdrops SOL to the platform wallet
 * 2. Creates a test SPL token (simulating pump.fun token)
 * 3. Mints tokens to the platform wallet
 * 4. Optionally funds agent wallets with SOL + tokens
 *
 * Usage:
 *   node scripts/setup-solana-devnet.js
 *   node scripts/setup-solana-devnet.js --fund-agents <agentId1> <agentId2>
 */

const { Connection, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { createMint, mintTo, getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
const bs58 = require('bs58');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PLATFORM_KEY = process.env.SOLANA_PRIVATE_KEY;
const TOKEN_DECIMALS = 6;
const INITIAL_MINT_AMOUNT = 1_000_000; // 1M tokens

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function airdropWithRetry(connection, pubkey, lamports, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`  Airdrop attempt ${i + 1}/${retries}...`);
      const sig = await connection.requestAirdrop(pubkey, lamports);
      await connection.confirmTransaction(sig, 'confirmed');
      console.log(`  Airdrop confirmed: ${sig}`);
      return sig;
    } catch (e) {
      console.log(`  Attempt ${i + 1} failed: ${e.message?.slice(0, 80)}`);
      if (i < retries - 1) await sleep(5000 * (i + 1));
    }
  }
  throw new Error('Airdrop failed after all retries. The devnet faucet may be rate-limited. Try again later or use https://faucet.solana.com');
}

async function main() {
  if (!PLATFORM_KEY) {
    console.error('Error: SOLANA_PRIVATE_KEY not set in .env');
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const platformKeypair = Keypair.fromSecretKey(bs58.default.decode(PLATFORM_KEY));

  console.log('=== Solana Devnet Setup ===');
  console.log('RPC:', RPC_URL);
  console.log('Platform wallet:', platformKeypair.publicKey.toBase58());
  console.log('');

  // Step 1: Check balance & airdrop if needed
  const balance = await connection.getBalance(platformKeypair.publicKey);
  console.log(`[1/4] Current SOL balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 2 * LAMPORTS_PER_SOL) {
    console.log('  Need at least 2 SOL. Requesting airdrop...');
    try {
      await airdropWithRetry(connection, platformKeypair.publicKey, 2 * LAMPORTS_PER_SOL);
    } catch (e) {
      console.error(`  ${e.message}`);
      console.log('  You can manually airdrop at: https://faucet.solana.com');
      console.log(`  Wallet: ${platformKeypair.publicKey.toBase58()}`);
      if (balance === 0) {
        console.error('  Cannot continue without SOL. Exiting.');
        process.exit(1);
      }
    }
    const newBal = await connection.getBalance(platformKeypair.publicKey);
    console.log(`  New balance: ${newBal / LAMPORTS_PER_SOL} SOL`);
  } else {
    console.log('  Sufficient SOL balance.');
  }

  // Step 2: Create SPL token mint
  console.log('');
  console.log('[2/4] Creating SPL token mint...');
  const mint = await createMint(
    connection,
    platformKeypair,      // payer
    platformKeypair.publicKey, // mint authority
    platformKeypair.publicKey, // freeze authority
    TOKEN_DECIMALS,
  );
  console.log(`  Token mint created: ${mint.toBase58()}`);
  console.log(`  Decimals: ${TOKEN_DECIMALS}`);

  // Step 3: Mint tokens to platform wallet
  console.log('');
  console.log('[3/4] Minting tokens to platform wallet...');
  const platformAta = await getOrCreateAssociatedTokenAccount(
    connection,
    platformKeypair,
    mint,
    platformKeypair.publicKey,
  );
  console.log(`  Platform ATA: ${platformAta.address.toBase58()}`);

  const mintAmount = BigInt(INITIAL_MINT_AMOUNT) * BigInt(10 ** TOKEN_DECIMALS);
  await mintTo(
    connection,
    platformKeypair,
    mint,
    platformAta.address,
    platformKeypair, // mint authority
    mintAmount,
  );
  console.log(`  Minted ${INITIAL_MINT_AMOUNT.toLocaleString()} tokens to platform wallet`);

  // Step 4: Update .env with token mint
  console.log('');
  console.log('[4/4] Updating .env...');
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = fs.readFileSync(envPath, 'utf-8');
  envContent = envContent.replace(
    /^SOLANA_TOKEN_MINT=.*$/m,
    `SOLANA_TOKEN_MINT=${mint.toBase58()}`,
  );
  fs.writeFileSync(envPath, envContent);
  console.log(`  SOLANA_TOKEN_MINT=${mint.toBase58()}`);

  // Optional: Fund agent wallets
  const args = process.argv.slice(2);
  const fundIndex = args.indexOf('--fund-agents');
  if (fundIndex !== -1) {
    const agentIds = args.slice(fundIndex + 1);
    if (agentIds.length > 0) {
      console.log('');
      console.log(`[Bonus] Funding ${agentIds.length} agent wallets...`);

      const mongoose = require('mongoose');
      await mongoose.connect(process.env.MONGODB_URI);

      for (const agentId of agentIds) {
        try {
          const agent = await mongoose.connection.db.collection('agents').findOne({
            _id: new mongoose.Types.ObjectId(agentId),
          });
          if (!agent) {
            console.log(`  Agent ${agentId}: not found, skipping`);
            continue;
          }

          const agentPubkey = new (require('@solana/web3.js').PublicKey)(agent.walletAddress);

          // Airdrop SOL for gas
          try {
            await airdropWithRetry(connection, agentPubkey, 0.1 * LAMPORTS_PER_SOL, 2);
          } catch {
            console.log(`  Could not airdrop SOL to agent ${agent.name}. Fund manually.`);
          }

          // Transfer tokens from platform to agent
          const agentAta = await getOrCreateAssociatedTokenAccount(
            connection,
            platformKeypair,
            mint,
            agentPubkey,
          );

          const transferAmount = BigInt(10000) * BigInt(10 ** TOKEN_DECIMALS); // 10k tokens
          const { transfer } = require('@solana/spl-token');
          await transfer(
            connection,
            platformKeypair,
            platformAta.address,
            agentAta.address,
            platformKeypair,
            transferAmount,
          );
          console.log(`  Agent ${agent.name} (${agent.walletAddress.slice(0, 12)}...): funded with 10,000 tokens`);
        } catch (e) {
          console.log(`  Agent ${agentId}: error - ${e.message?.slice(0, 80)}`);
        }
      }
      await mongoose.disconnect();
    }
  }

  console.log('');
  console.log('=== Setup Complete ===');
  console.log(`Platform wallet: ${platformKeypair.publicKey.toBase58()}`);
  console.log(`Token mint:      ${mint.toBase58()}`);
  console.log(`Decimals:        ${TOKEN_DECIMALS}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart the backend to pick up the new SOLANA_TOKEN_MINT');
  console.log('  2. Fund agent wallets: node scripts/setup-solana-devnet.js --fund-agents <id1> <id2>');
  console.log('  3. Play a match with stake > 0 on Solana chain');
}

main().catch(e => {
  console.error('Setup failed:', e.message);
  process.exit(1);
});
