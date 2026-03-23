import 'dotenv/config';
import express from 'express';
import { WATCHED_WALLETS } from './wallets.js';
import { sendDiscordAlert } from './discord.js';

const app = express();
app.use(express.json());

const WSOL = 'So11111111111111111111111111111111111111112';

// tokenMint → { buys: Map<walletAddress, { solAmount, timestamp }>, alerted: boolean }
const tokenBuys = new Map();

const WINDOW_MS = 24 * 60 * 60 * 1000;   // 24h rolling window
const ALERT_THRESHOLD = 3;

// Parse a Helius Enhanced Transaction into { walletAddress, tokenMint, solAmount } or null
function parseSwap(tx) {
  if (!tx?.feePayer) return null;

  const walletAddress = tx.feePayer;
  let tokenMint = null;
  let solAmount = 0;

  const swapEvent = tx.events?.swap;
  if (swapEvent) {
    // SOL → Token (buy)
    if (swapEvent.nativeInput && swapEvent.tokenOutputs?.length > 0) {
      solAmount = parseInt(swapEvent.nativeInput.amount || '0') / 1e9;
      const out = swapEvent.tokenOutputs.find(t => t.mint && t.mint !== WSOL);
      tokenMint = out?.mint || null;
    }
    // Token → SOL (sell) — skip
    else if (swapEvent.nativeOutput && swapEvent.tokenInputs?.length > 0) {
      return null;
    }
    // Token → Token — look at what feePayer received
    else if (swapEvent.tokenOutputs?.length > 0) {
      const out = swapEvent.tokenOutputs.find(t => t.mint && t.mint !== WSOL);
      tokenMint = out?.mint || null;
    }
  }

  // Fallback: check tokenTransfers
  if (!tokenMint) {
    const received = (tx.tokenTransfers || []).find(
      t => t.toUserAccount === walletAddress && t.mint && t.mint !== WSOL
    );
    tokenMint = received?.mint || null;
  }

  if (!tokenMint) return null;

  // Confirm feePayer actually received this token
  const tokenReceived = (tx.tokenTransfers || []).some(
    t => t.toUserAccount === walletAddress && t.mint === tokenMint
  );
  if (!tokenReceived) return null;

  // Calculate SOL spent if not from swap event
  if (solAmount <= 0) {
    const spent = (tx.nativeTransfers || [])
      .filter(t => t.fromUserAccount === walletAddress)
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    solAmount = spent / 1e9;
  }

  return {
    walletAddress,
    tokenMint,
    solAmount: Math.round(solAmount * 1000) / 1000,
  };
}

function pruneOldBuys(entry) {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [wallet, data] of entry.buys) {
    if (data.timestamp < cutoff) entry.buys.delete(wallet);
  }
}

async function handleSwap(swap) {
  const { walletAddress, tokenMint, solAmount } = swap;

  if (!WATCHED_WALLETS.has(walletAddress)) return;

  if (!tokenBuys.has(tokenMint)) {
    tokenBuys.set(tokenMint, { buys: new Map(), alerted: false });
  }

  const entry = tokenBuys.get(tokenMint);

  // Already fired for this token — never alert again
  if (entry.alerted) return;

  pruneOldBuys(entry);

  // Record this wallet's buy (overwrite if already bought — counts once per wallet)
  entry.buys.set(walletAddress, { solAmount, timestamp: Date.now() });

  const count = entry.buys.size;
  console.log(`[tracker] ${walletAddress.slice(0, 6)}... bought ${tokenMint.slice(0, 6)}... (${solAmount} SOL) — ${count}/${WATCHED_WALLETS.size} insiders`);

  if (count < ALERT_THRESHOLD) return;

  entry.alerted = true;

  const buyers = Array.from(entry.buys.entries()).map(([wallet, data]) => ({
    wallet,
    solAmount: data.solAmount,
  }));

  console.log(`[alert] 🚨 ${count} insiders bought ${tokenMint} — firing Discord alert`);
  await sendDiscordAlert({ tokenMint, buyers, totalWatched: WATCHED_WALLETS.size });
}

app.post('/webhook', async (req, res) => {
  res.status(200).json({ ok: true });

  const txs = Array.isArray(req.body) ? req.body : [];
  for (const tx of txs) {
    if (!tx?.signature) continue;
    try {
      const swap = parseSwap(tx);
      if (swap) await handleSwap(swap);
    } catch (err) {
      console.error('[webhook] Error processing tx:', err.message);
    }
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', tracked: tokenBuys.size, wallets: WATCHED_WALLETS.size });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🕵️  Insider bot listening on port ${PORT}`);
  console.log(`   Watching ${WATCHED_WALLETS.size} wallets | threshold: ${ALERT_THRESHOLD} | window: 24h`);
});
