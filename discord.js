const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

function short(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export async function sendDiscordAlert({ tokenMint, buyers, totalWatched }) {
  if (!WEBHOOK_URL) {
    console.log('[discord] No webhook URL set — skipping');
    return;
  }

  const buyerLines = buyers
    .map((b, i) => `${i + 1}. \`${short(b.wallet)}\` — **${b.solAmount} SOL**`)
    .join('\n');

  const embed = {
    title: `🚨 ${buyers.length}/${totalWatched} Insiders Buying`,
    color: 0xFF4500,
    fields: [
      {
        name: '👛 Wallets',
        value: buyerLines,
        inline: false,
      },
      {
        name: '🔗 Links',
        value: [
          `[DexScreener](https://dexscreener.com/solana/${tokenMint})`,
          `[Birdeye](https://birdeye.so/token/${tokenMint}?chain=solana)`,
          `[Solscan](https://solscan.io/token/${tokenMint})`,
        ].join(' · '),
        inline: false,
      },
    ],
    footer: {
      text: `Token: ${tokenMint}`,
    },
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    console.error('[discord] Failed to send alert:', err.message);
  }
}
