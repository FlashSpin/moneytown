# Moving Ledgerford to real money on Kraken

Today every trade is **paper**: villagers' purses are numbers in the database,
marked to Kraken's live prices. Nothing is bought or sold. This note records
what switching to real orders would take, so the paper game is already shaped
for it.

## Why Kraken

- **UK-ready:** FCA-registered (e-money institution; a separate FCA-authorised
  investment firm), GBP deposits by Faster Payments. Binance cannot take new
  UK customers.
- **Built for automated trading:** REST, WebSocket and FIX APIs; API keys with
  per-permission scopes; published minimum order sizes.
- **Already the price source:** the parish's coins are exactly the ones Kraken
  lists against USD (`src/lib/market.ts`), priced from Kraken's public Ticker
  (`src/lib/tape.server.ts`), and each pair's `ordermin`/`costmin` is already
  parsed for when orders are real.

## What real trading would need (not built)

1. **One Kraken account and API key**, kept only in Vercel's environment
   variables: permissions *Query funds*, *Query open orders & trades*, and
   *Create & modify orders* — **never** *Withdraw funds*. Restrict the key to
   the server's IPs if Kraken allows it for your plan.
2. **An order step** after each review: turn each villager's decision (coin,
   long/flat, size × purse) into a Kraken `AddOrder` for the *difference* from
   its current holding, respecting `ordermin`/`costmin` (most coins need about
   $0.50–$5 per order, so £20 purses are near the floor).
3. **Spot only.** UK retail customers cannot use crypto derivatives, so there
   is no real SHORT: a short would have to become FLAT (or sell a holding).
4. **Bookkeeping from the exchange**, not the game: purses must be reconciled
   against Kraken balances and fills (with fees, ~0.25–0.40% per trade on
   small accounts), not marked from the ticker.
5. **Hard safety limits in code**, outside anything the AI can change: a
   total-capital cap, a per-trade cap, a daily-loss stop that halts all
   trading, and a manual kill switch (e.g. an env var the royal seal can't
   override).
6. **Tax and rules:** UK crypto disposals are subject to Capital Gains Tax;
   keep the trade log. The FCA's new cryptoasset regime (applications from
   30 September 2026, in force 25 October 2027) may change what is allowed.

No strategy — AI or otherwise — guarantees a profit. Only ever risk money you
can afford to lose, and start with the smallest stakes the exchange allows.
