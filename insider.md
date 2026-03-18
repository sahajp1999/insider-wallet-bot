# Insider Wallet Alert Bot

**Last updated:** 2026-03-17

---

## What This Bot Does

Monitors 20 specific "insider" Solana wallets and sends a Discord alert whenever **3 or more of them buy the same token** within a 24-hour rolling window.

No scoring, no filters — pure consensus detection. If the insiders are piling in, we want to know.

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Transaction data | Helius Enhanced Webhook (parsed swap events) |
| Supplementary RPC | QuickNode (HTTP RPC endpoint) |
| Server | Express (Node.js) |
| Hosting | Railway |
| Alerts | Discord Webhook |

### Why Helius for the webhook (not QuickNode)?
QuickNode Streams deliver **raw transaction data** — you'd need to call `getParsedTransaction()` for every tx to identify swaps, which burns RPC credits fast. Helius webhooks deliver **pre-parsed swap events** (`events.swap`) for free, telling you exactly what token was bought and for how much SOL. QuickNode is still used as the RPC endpoint for any supplementary on-chain lookups.

---

## Watched Wallets (20)

```
4fditHPQymxNi9ANECKprF74BKp41DjRLHUhvLbJv8CM
9ePysmHQinofw8jccUL2buUpM9Ue2sJD6PR2X5CN5xxy
5JADERYSwSiUACV4bvh3Fw4tFfecmybzzXcKwrzC9mNG
3R5p7EcTCcGMAhuVib2JVdTxexXopQ9qBD2P5vnpfT5L
6U3gaUH3wn2LswyvP2ZTqkNsQb7dC8nP9tFhjdw2fEmN
53RmEdYFNc3gmuKhb3hB4bvooV15RAhUbFrtZ3pHUoTe
GwRCK2MiZ6NrXUu4eCmTpd5KEY4eJ3qNpkTNdGYwR5Xa
ALuYzdfihf5GiMAo1pyr2tVcJMhhScx7G9iWbD2LH6zm
HnNLtQmwA6UwQ3HTbz9qP2LnsNQTHFZHsfCzoK55UhKG
9SkC9wDJv8BTWXDJnJLbCWsYNoR23JGgrSByWYFGB7nz
AnmfJx5xHJVZXfcjxfzRpe1voFqu7EnjdSz6A6aU1cui
5dgyf37fkNq3UpNGzUr9xe8gS6qfCUiTFPpECgYMqAHV
H6NiqJrgm7z7fhPELZQsejSqGdeQvzyfYNd6m12B3uqs
2CeL62Y1999ZA4NNwqUwn1JXAQSEKywoxFk4M54cneYD
Ak4Uxp9wm8euDF3gmUMr8pKidvqYs4FQcAGRNzmKg7AV
EGxY9eDjgjaairt7zGr6KUa3y7QtdtJdsoYRNd1uBS9B
2yv9xtS7D49tMTfuWzzU1L2CG3Gh1jTr7KVGKHw5h459
6YQha3NSvYsaabKkbDtvTqDNDniY2Eepam97Fo6h1Qi3
CEQFnN3yZ1SrJ5ajQU454w14AuNAusepmWkosR46qe89
Brf8Jzn8X7maygAiyVQ1tvTV8HY4bCikfd7LL3tk6eTR
```

---

## Alert Logic

- **Trigger:** 3+ wallets buy the same token mint within 24 hours
- **Cooldown:** 6 hours before re-alerting for the same token
- **Buy detection:** wallet receives a non-SOL token in exchange for SOL (via `events.swap`)
- **No minimum buy size** (all buys counted regardless of SOL amount)

---

## Discord Alert Contains

- Token mint (shortened) + Solscan link
- How many insiders bought (e.g. "4/20 insiders")
- Which wallets (abbreviated addresses)
- SOL amounts per wallet
- DexScreener link

---

## File Structure

```
insider/
├── index.js          # Express server, webhook handler, consensus tracker
├── discord.js        # Discord embed sender
├── wallets.js        # Set of 20 watched wallet addresses
├── .env              # Secrets (not committed)
├── package.json
├── railway.toml      # Railway deploy config
└── insider.md        # This file — project summary
```

---

## Environment Variables

```
DISCORD_WEBHOOK_URL=       # Discord channel webhook URL
HELIUS_WEBHOOK_SECRET=     # Auth header to validate incoming webhooks
PORT=3000
```

---

## Helius Webhook Config (Manual Setup)

After deploying to Railway:
1. Go to [helius.dev](https://helius.dev) → Webhooks → Create Webhook
2. Type: **Enhanced Transaction**
3. Paste all 20 wallet addresses
4. Webhook URL: `https://<railway-url>/webhook`
5. Authorization header: value from `HELIUS_WEBHOOK_SECRET`
6. Transaction types: `SWAP`

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-17 | Initial build — 20 wallets, 3-of-N consensus, Helius + Railway |
