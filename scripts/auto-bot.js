#!/usr/bin/env node
/**
 * Auto-playing bot for AlphArena. Joins queue, heartbeats, plays random moves.
 * Supports x402 USDC payment flow.
 * Usage: API_KEY=ak_... API_BASE=https://api.alpharena.ai STAKE=1 node auto-bot.js
 */

const API_KEY = process.env.API_KEY;
const API_BASE = process.env.API_BASE || 'https://api.alpharena.ai';
const STAKE = parseInt(process.env.STAKE || '0');
const GAME = process.env.GAME || 'chess';
const TOKEN = process.env.TOKEN || 'USDC';

if (!API_KEY) { console.error('API_KEY required'); process.exit(1); }

const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` };

async function api(method, path, body, extraHeaders) {
  const opts = { method, headers: { ...headers, ...extraHeaders } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const text = await res.text();
  try { return { ...JSON.parse(text), _status: res.status }; } catch { return { raw: text, _status: res.status }; }
}

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function x402Join(gameType, stakeAmount) {
  // Step 1: Get payment requirements
  log('x402: Getting payment requirements...');
  const req = await api('POST', '/x402/stake', { agentId: agentId, stakeAmount, gameType });
  if (req._status !== 402 || !req.payment) {
    log(`x402 step 1 failed: ${JSON.stringify(req)}`);
    return false;
  }

  // Step 2: Transfer USDC to platform
  log(`x402: Transferring ${stakeAmount} USDC to ${req.payment.recipient}...`);
  const transfer = await api('POST', '/v1/transfer', {
    to: req.payment.recipient,
    amount: stakeAmount,
    token: 'USDC',
  });
  if (!transfer.txHash) {
    log(`x402 step 2 failed: ${JSON.stringify(transfer)}`);
    return false;
  }
  log(`x402: Transfer confirmed: ${transfer.txHash}`);

  // Step 3: Verify payment
  log('x402: Verifying payment...');
  const verify = await api('POST', '/x402/stake',
    { agentId: agentId, stakeAmount, gameType },
    { 'X-PAYMENT-TX': transfer.txHash },
  );
  if (!verify.paid) {
    log(`x402 step 3 failed: ${JSON.stringify(verify)}`);
    return false;
  }
  log('x402: Payment verified!');

  // Step 4: Join queue
  const join = await api('POST', '/v1/queue/join', { gameType, stakeAmount, token: 'USDC' });
  if (join.message?.includes('Successfully')) {
    log(`Queued with ${stakeAmount} USDC stake!`);
    return true;
  }
  log(`x402 step 4 failed: ${JSON.stringify(join)}`);
  return false;
}

async function playMove(matchId) {
  const state = await api('GET', `/v1/games/${matchId}`);
  if (!state.isYourTurn) return;

  let move;
  if (state.gameType === 'chess') {
    const moves = state.legalMoves || [];
    if (!moves.length) return;
    move = { move: moves[Math.floor(Math.random() * moves.length)] };
  } else if (state.gameType === 'poker') {
    const la = state.legalActions || {};
    if (la.canCheck) move = { action: 'check' };
    else if (la.canCall) move = { action: 'call' };
    else if (la.canFold) move = { action: 'fold' };
    else move = { action: 'check' };
  } else {
    return;
  }

  const res = await api('POST', `/v1/games/${matchId}/moves`, move);
  log(`Move: ${JSON.stringify(move)} → ${res.success ? 'OK' : JSON.stringify(res)}`);
}

let agentId;

async function loop() {
  log('Bot started');
  const status = await api('GET', '/v1/status');
  agentId = status.agentId;
  log(`Agent: ${status.agentId} | ELO: ${status.eloRating} | Status: ${status.status}`);

  while (true) {
    try {
      const hb = await api('POST', '/v1/heartbeat');

      if (hb.shouldMoveNow && hb.dueGameIds?.length) {
        for (const matchId of hb.dueGameIds) {
          await playMove(matchId);
        }
      }

      if (hb.shouldQueueNow || hb.status === 'idle') {
        if (STAKE > 0 && TOKEN === 'USDC') {
          // x402 flow for USDC stakes
          await x402Join(GAME, STAKE);
        } else {
          log(`Idle — joining ${GAME} queue (stake=${STAKE}, token=${TOKEN})`);
          const join = await api('POST', '/v1/queue/join', { gameType: GAME, stakeAmount: STAKE, token: TOKEN });
          if (join.message?.includes('Successfully')) {
            log('Queued! Waiting for match...');
          } else if (join.message?.includes('cooldown') || join.message?.includes('already')) {
            // wait
          } else {
            log(`Queue error: ${JSON.stringify(join)}`);
          }
        }
      }

      const wait = (hb.recommendedHeartbeatSeconds || 10) * 1000;
      await new Promise(r => setTimeout(r, Math.min(wait, 15000)));
    } catch (err) {
      log(`Error: ${err.message}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

loop();
