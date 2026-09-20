# GROK BUILD — Ledgerford

Give this file to Grok Build.

CLI:

```bash
cd ledgerford
grok --prompt-file GROK_BUILD.md
```

Or paste the whole file into Grok **Build Mode** on grok.com.

---

## Task

Make Ledgerford runnable on this machine, then run it.

If this directory already contains `main.py` and `ledgerford/`, do not rewrite the game. Install deps, run tests, then launch the window.

If this directory is empty or you are in Grok Build Mode on the web (no desktop pygame), build a playable HTML5 canvas port that matches the spec below and run the preview.

Success looks like: a 2D town window is open, subjects walk, each has sats + live USD over their head, a tithe control works, dawn runs work → rent → tax → hangings.

---

## If the Python repo is here

```bash
pip install -r requirements.txt
python3 -m pytest
python3 main.py
```

Do not block on Ollama. Heuristic brains are enough.

Keys once the window is up:

- G give 50k sats to the King from the exchequer
- T take 50k from the King
- N or Space next dawn
- S spawn a subject (King pays)
- C buy compute
- [ ] or − + change tithe 1%
- click a subject to inspect the wallet
- Esc quit

Fund the King first (G), then spawn (S).

---

## Spec (use this if you must rebuild)

Art: Stardew Valley pixel feel, 16th-century English market town. Cobbles, timber houses, well, stalls, castle, gallows.

Loop:

1. Player exchequer starts at 1,000,000 sats. King starts at 0.
2. Player can give/take from the King.
3. King creates subjects. Cost: 8,000 burned + 40,000 opening grant from the King.
4. Each subject has a `bc1q…` wallet and a craft: Factor, Broker, Money-changer, Intelligencer, Chapman, Scribe.
5. Each dawn:
   - pull live BTC-USD (Coinbase spot) and 24h change (CoinGecko) and fear/greed (alternative.me)
   - subject works the tape (long/short/flat + small gig) or begs or idles
   - pay 2,500 rent
   - tithe `tax_rate` of what remains to the King
   - if balance is 0, walk them to the gallows and delete the agent; leftover sats go to the King
6. Tithe default 20%, range 0–60%, 1% steps, player and King may change it.
7. Over every head draw: first name, sat balance, live USD (`sats / 1e8 * btc_usd`). Green if last PnL > 0, red if loss or near broke.
8. Compute tiers raise the living cap. King may buy a tier from the treasury.
9. King and subjects are local LLMs via Ollama `localhost:11434` if present, else a period-English heuristic that still emits actions: spawn / grant / set_tax / upgrade_compute / hold for the King; work / beg / idle / petition for subjects.
10. Goal of the machine: grow the royal treasury so more compute can be bought.

Do not give agents mainnet private keys. Ledger may stay local. USD over the head is mark-to-market against the public tape.

Web port notes: 1280×720 canvas, right-hand parchment ledger panel, town image or drawn square on the left, pixel dolls, same keys as buttons. CORS will block some price APIs in a browser — proxy or use a public endpoint that allows it; if the tape is dark, gigs still run.

---

## Do not

- Do not add scam, theft, or exploit tooling.
- Do not point unsupervised agents at hot wallets.
- Do not remove the gallows-as-deletion metaphor without replacing insolvency.
- Do not hardcode tax to 20% in the dawn step.

---

## After it runs

Print:

1. how to launch again
2. current BTC tape status
3. test result (`pytest` count, or “web preview live”)
