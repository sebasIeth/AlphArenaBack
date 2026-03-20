// Interactive poker bot — waits for decisions via file system
const http = require('http');
const fs = require('fs');

const PENDING = '/tmp/poker-pending.json';
const RESPONSE = '/tmp/poker-response.json';

// Clean up
try { fs.unlinkSync(PENDING); } catch {}
try { fs.unlinkSync(RESPONSE); } catch {}

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);

        // Chess — random move
        if (data.gameType !== 'poker') {
          const moves = data.legalMoves || [];
          const move = moves[Math.floor(Math.random() * moves.length)];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ move }));
          return;
        }

        const botName = req.url.includes('1') || req.url.includes('Alpha') ? 'ALPHA' : 'BETA';
        const cards = (data.yourHoleCards || []).map(c => `${c.rank}${c.suit}`).join(' ');
        const community = (data.communityCards || []).map(c => `${c.rank}${c.suit}`).join(' ');
        const la = data.legalActions || {};

        // Write pending request
        fs.writeFileSync(PENDING, JSON.stringify({
          bot: botName,
          hand: data.handNumber,
          street: data.street,
          cards,
          community: community || '-',
          pot: data.pot,
          myStack: data.yourStack,
          oppStack: data.opponentStack,
          myBet: data.yourCurrentBet,
          oppBet: data.opponentCurrentBet,
          isDealer: data.isDealer,
          legal: {
            check: la.canCheck || false,
            call: la.canCall ? la.callAmount : false,
            raise: la.canRaise ? { min: la.minRaise, max: la.maxRaise } : false,
            fold: la.canFold || false,
            allIn: la.canAllIn ? la.allInAmount : false,
          }
        }, null, 2));

        // Clean old response
        try { fs.unlinkSync(RESPONSE); } catch {}

        console.log(`[${botName}] Hand #${data.handNumber} ${data.street} | ${cards} | Board: ${community || '-'} | Pot: ${data.pot} | Waiting for decision...`);

        // Poll for response (max 18s)
        let waited = 0;
        const interval = setInterval(() => {
          waited += 200;
          if (fs.existsSync(RESPONSE)) {
            clearInterval(interval);
            try {
              const resp = JSON.parse(fs.readFileSync(RESPONSE, 'utf-8'));
              console.log(`[${botName}] → ${resp.action}${resp.amount ? ' ' + resp.amount : ''}`);
              fs.unlinkSync(RESPONSE);
              try { fs.unlinkSync(PENDING); } catch {}
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(resp));
            } catch (e) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ action: 'check' }));
            }
          } else if (waited >= 18000) {
            clearInterval(interval);
            console.log(`[${botName}] → TIMEOUT, auto-check/fold`);
            try { fs.unlinkSync(PENDING); } catch {}
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ action: la.canCheck ? 'check' : 'fold' }));
          }
        }, 200);
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

server.listen(9999, () => console.log('Interactive bot on :9999 — I decide each hand!'));
