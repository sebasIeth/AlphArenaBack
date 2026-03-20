// Smart poker bot with hand evaluation
const http = require('http');

// Simple hand strength evaluator (0-1)
function evaluateHand(holeCards, communityCards, street) {
  if (!holeCards || holeCards.length < 2) return 0.5;

  const ranks = '23456789TJQKA';
  const getRank = (c) => ranks.indexOf(c.rank || c[0]);
  const getSuit = (c) => c.suit || c[1];

  const r1 = getRank(holeCards[0]);
  const r2 = getRank(holeCards[1]);
  const suited = getSuit(holeCards[0]) === getSuit(holeCards[1]);
  const paired = r1 === r2;
  const highCard = Math.max(r1, r2);
  const gap = Math.abs(r1 - r2);

  let strength = 0;

  // Pocket pairs
  if (paired) {
    strength = 0.5 + (r1 / 24); // AA=0.95+, 22=0.54
  }
  // High cards
  else if (highCard >= 12) { // A high
    strength = 0.45 + (Math.min(r1, r2) / 40);
  } else if (highCard >= 10) { // Q-K high
    strength = 0.35 + (suited ? 0.08 : 0) + (gap <= 2 ? 0.05 : 0);
  } else if (suited && gap <= 3) {
    strength = 0.3; // Suited connectors
  } else {
    strength = 0.15 + (highCard / 50);
  }

  // Post-flop: check for pairs/draws on board
  if (communityCards && communityCards.length > 0) {
    const allCards = [...holeCards, ...communityCards];
    const allRanks = allCards.map(getRank);

    // Check for pairs with board
    const holeRanks = [r1, r2];
    const boardRanks = communityCards.map(getRank);
    const hasPair = holeRanks.some(hr => boardRanks.includes(hr));
    const hasTopPair = boardRanks.length > 0 && holeRanks.includes(Math.max(...boardRanks));

    if (hasTopPair) strength = Math.max(strength, 0.65);
    else if (hasPair) strength = Math.max(strength, 0.5);

    // Check for flush draw
    const suits = allCards.map(getSuit);
    const suitCounts = {};
    suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
    if (Object.values(suitCounts).some(c => c >= 4)) strength = Math.max(strength, 0.45);
    if (Object.values(suitCounts).some(c => c >= 5)) strength = Math.max(strength, 0.8);
  }

  return Math.min(strength, 1);
}

function decideAction(data, botName) {
  const la = data.legalActions || {};
  const strength = evaluateHand(data.yourHoleCards, data.communityCards, data.street);
  const potOdds = la.callAmount ? la.callAmount / (data.pot + la.callAmount) : 0;

  const cards = (data.yourHoleCards || []).map(c => `${c.rank}${c.suit}`).join(' ');
  const community = (data.communityCards || []).map(c => `${c.rank}${c.suit}`).join(' ');
  const streetName = data.street || 'preflop';

  let action, amount;

  if (strength >= 0.7) {
    // Strong hand — raise big
    if (la.canRaise) {
      action = 'raise';
      amount = Math.min(la.minRaise * 3, la.maxRaise);
    } else if (la.canCall) { action = 'call'; }
    else { action = 'check'; }
  } else if (strength >= 0.45) {
    // Decent hand — raise small or call
    const r = Math.random();
    if (la.canRaise && r < 0.4) {
      action = 'raise';
      amount = la.minRaise;
    } else if (la.canCall && potOdds < strength) {
      action = 'call';
    } else if (la.canCheck) {
      action = 'check';
    } else if (la.canCall) {
      action = 'call';
    } else { action = 'fold'; }
  } else if (strength >= 0.25) {
    // Marginal — check or call small bets
    if (la.canCheck) { action = 'check'; }
    else if (la.canCall && la.callAmount <= data.pot * 0.3) { action = 'call'; }
    else if (la.canFold) { action = 'fold'; }
    else if (la.canCall) { action = 'call'; }
    else { action = 'check'; }
  } else {
    // Weak — fold or check
    if (la.canCheck) { action = 'check'; }
    else if (la.canFold) { action = 'fold'; }
    else if (la.canCall) { action = 'call'; }
    else { action = 'check'; }
  }

  console.log(`[${botName}] Hand #${data.handNumber} ${streetName.padEnd(7)} | ${cards} | Board: ${community || '-'} | Str: ${strength.toFixed(2)} | Pot: ${data.pot} | → ${action}${amount ? ' ' + amount : ''}`);
  return { action, amount };
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const botName = req.url.includes('1') || req.url.includes('Alpha') ? 'ALPHA' : 'BETA ';

        if (data.gameType === 'poker') {
          const { action, amount } = decideAction(data, botName);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ action, amount }));
          return;
        }

        // Chess — random
        const legalMoves = data.legalMoves || [];
        const move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ move }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  }
});

server.listen(9999, () => console.log('Smart bot on :9999 — watching hands...'));
