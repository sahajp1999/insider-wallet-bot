import 'dotenv/config';
import express from 'express';
import Redis from 'ioredis';
import { WATCHED_WALLETS } from './wallets.js';
import { sendDiscordAlert } from './discord.js';

const app = express();
app.use(express.json());

const WSOL = 'So11111111111111111111111111111111111111112';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const ALERT_THRESHOLD = 3;

// Redis keys
const ALERTED_KEY = 'insider:alerted';                     // Set of minted tokens already alerted
const buyKey = mint => `insider:buys:${mint}`;             // Hash: wallet → JSON({solAmount,timestamp})

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
redis.on('error', err => console.error('[redis] error:', err.message));

// ── helpers ───────────────────────────────────────────────────────────────────

async function hasAlerted(mint) {
  return redis.sismember(ALERTED_KEY, mint).then(r => r === 1);
}

async function recordBuy(mint, wallet, solAmount) {
  const key = buyKey(mint);
  await redis.hset(key, wallet, JSON.stringify({ solAmount, timestamp: Date.now() }));
  await redis.expire(key, 26 * 60 * 60); // 26h TTL — auto-cleanup
}

async function getActiveBuys(mint) {
  const key = buyKey(mint);
  const all = await redis.hgetall(key);
  if (!all) return [];

  const cutoff = Date.now() - WINDOW_MS;
  const active = [];

  for (const [wallet, raw] of Object.entries(all)) {
    const data = JSON.parse(raw);
    if (data.timestamp >= cutoff) {
      active.push({ wallet, ...data });
    }
  }
  return active;
}

// ── swap parser ───────────────────────────────────────────────────────────────

function parseSwap(tx) {
  if (!tx?.feePayer) return null;

  const walletAddress = tx.feePayer;
  let tokenMint = null;
  let solAmount = 0;

  const swapEvent = tx.events?.swap;
  if (swapEvent) {
    if (swapEvent.nativeInput && swapEvent.tokenOutputs?.length > 0) {
      solAmount = parseInt(swapEvent.nativeInput.amount || '0') / 1e9;
      const out = swapEvent.tokenOutputs.find(t => t.mint && t.mint !== WSOL);
      tokenMint = out?.mint || null;
    } else if (swapEvent.nativeOutput && swapEvent.tokenInputs?.length > 0) {
      return null; // sell
    } else if (swapEvent.tokenOutputs?.length > 0) {
      const out = swapEvent.tokenOutputs.find(t => t.mint && t.mint !== WSOL);
      tokenMint = out?.mint || null;
      // SOL was wrapped to WSOL before the swap — use WSOL input as the real SOL amount
      const wsolInput = swapEvent.tokenInputs?.find(t => t.mint === WSOL);
      if (wsolInput) {
        solAmount = parseInt(wsolInput.amount || '0') / 1e9;
      }
    }
  }

  if (!tokenMint) {
    const received = (tx.tokenTransfers || []).find(
      t => t.toUserAccount === walletAddress && t.mint && t.mint !== WSOL
    );
    tokenMint = received?.mint || null;
  }

  if (!tokenMint) return null;

  const tokenReceived = (tx.tokenTransfers || []).some(
    t => t.toUserAccount === walletAddress && t.mint === tokenMint
  );
  if (!tokenReceived) return null;

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

// ── core logic ────────────────────────────────────────────────────────────────

async function handleSwap({ walletAddress, tokenMint, solAmount }) {
  if (!WATCHED_WALLETS.has(walletAddress)) return;

  // Already alerted for this token — never ping again
  if (await hasAlerted(tokenMint)) return;

  await recordBuy(tokenMint, walletAddress, solAmount);

  const activeBuys = await getActiveBuys(tokenMint);
  const count = activeBuys.length;

  console.log(`[tracker] ${walletAddress.slice(0, 6)}... bought ${tokenMint.slice(0, 6)}... (${solAmount} SOL) — ${count}/${WATCHED_WALLETS.size} insiders`);

  if (count < ALERT_THRESHOLD) return;

  // Double-check race condition — mark before sending
  const added = await redis.sadd(ALERTED_KEY, tokenMint);
  if (added === 0) return; // another request already marked it

  console.log(`[alert] 🚨 ${count} insiders bought ${tokenMint} — firing Discord alert`);
  await sendDiscordAlert({ tokenMint, buyers: activeBuys, totalWatched: WATCHED_WALLETS.size });
}

// ── routes ────────────────────────────────────────────────────────────────────

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

app.get('/health', async (_req, res) => {
  const alertedCount = await redis.scard(ALERTED_KEY).catch(() => -1);
  res.json({ status: 'ok', wallets: WATCHED_WALLETS.size, alertedTokens: alertedCount });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🕵️  Insider bot listening on port ${PORT}`);
  console.log(`   Watching ${WATCHED_WALLETS.size} wallets | threshold: ${ALERT_THRESHOLD} | window: 24h`);
});
