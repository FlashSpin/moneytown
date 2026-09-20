import { useEffect, useState } from "react";
import {
  Coins,
  Crown,
  Minus,
  Plus,
  ScrollText,
  Sun,
  UserPlus,
  Wallet,
} from "lucide-react";
import { LIVING_CAP, RENT_GBP, STAKE_GBP, TRANSFER_GBP } from "./constants";
import { useGame } from "./store";
import type { BrainCatalog, BrainChoice, Tape, WalletMode } from "./types";
import { choiceLabel } from "./llm";
import { formatPurse, gbpToSats, satsToGbp, tapeGbp } from "./wallets";
import { playDawn, playGive, playSpawn } from "./audio";

function Key({ children }: { children: string }) {
  return <kbd className="keycap">{children}</kbd>;
}

function poundsFromSats(sats: number, tape: Tape): string {
  return satsToGbp(sats, tapeGbp(tape)).toFixed(2);
}

function AgentSelect({
  id,
  label,
  choice,
  model,
  catalog,
  onChange,
}: {
  id: string;
  label: string;
  choice: BrainChoice;
  model: string;
  catalog: BrainCatalog;
  onChange: (choice: BrainChoice, model: string) => void;
}) {
  const selectValue = model ? `${choice}:${model}` : choice;
  const scanWits = useGame((s) => s.scanWits);
  return (
    <>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="wits-select"
        value={selectValue}
        onFocus={() => void scanWits()}
        onChange={(e) => {
          const [next, ...rest] = e.target.value.split(":");
          onChange((next as BrainChoice) || "auto", rest.join(":"));
        }}
      >
        <option value="auto">Auto — local, then Grok</option>
        <optgroup label="On this machine">
          <option value="ollama">Ollama (any local model)</option>
          {catalog.ollama.map((m) => (
            <option key={`${id}-o-${m}`} value={`ollama:${m}`}>
              Ollama · {m}
            </option>
          ))}
          <option value="lmstudio">LM Studio</option>
          {catalog.lmstudio.map((m) => (
            <option key={`${id}-l-${m}`} value={`lmstudio:${m}`}>
              LM Studio · {m}
            </option>
          ))}
          <option value="chrome">On-device model</option>
        </optgroup>
        <optgroup label="Online">
          <option value="grok">Grok</option>
          <option value="pollinations">Free online wits</option>
        </optgroup>
        <option value="heuristic">Heuristic (no model)</option>
      </select>
    </>
  );
}

type WalletTarget = {
  id: string;
  title: string;
  wallet: string;
  walletMode: WalletMode;
  testBalance: number;
  chainBalance: number | null;
  balance: number;
  lastFlavor: string;
  king: boolean;
  brainChoice: BrainChoice;
  brainModel: string;
};

function TalkForm({ toId, name }: { toId: string | null; name: string }) {
  const converse = useGame((s) => s.converse);
  const talking = useGame((s) => s.talking);
  const dawnRunning = useGame((s) => s.dawnRunning);
  const [text, setText] = useState("");
  const busy = talking || dawnRunning;
  const parish = toId == null;

  async function send(shout: boolean) {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    await converse(toId, t, shout || parish);
  }

  return (
    <form
      className="talk-form"
      onSubmit={(e) => {
        e.preventDefault();
        void send(parish);
      }}
    >
      <label className="field-label" htmlFor={`talk-${toId ?? "parish"}`}>
        {parish ? "Speak to the parish" : `Speak to ${name}`}
      </label>
      <textarea
        id={`talk-${toId ?? "parish"}`}
        className="talk-input"
        rows={3}
        value={text}
        disabled={busy}
        placeholder={parish ? "Shout to the square…" : `A word for ${name}…`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send(parish);
          }
        }}
      />
      <div className="talk-actions">
        <button type="submit" className="ledger-btn" disabled={busy || !text.trim()}>
          {busy ? "Listening…" : parish ? "Shout" : "Say"}
        </button>
        {parish ? null : (
          <button
            type="button"
            className="ledger-btn"
            disabled={busy || !text.trim()}
            onClick={() => void send(true)}
          >
            Shout
          </button>
        )}
      </div>
    </form>
  );
}

function WalletInspect({ target, tape }: { target: WalletTarget; tape: Tape }) {
  const select = useGame((s) => s.select);
  const updateWallet = useGame((s) => s.updateWallet);
  const refreshChain = useGame((s) => s.refreshChain);
  const setAgent = useGame((s) => s.setAgent);
  const catalog = useGame((s) => s.brainCatalog);
  const scanWits = useGame((s) => s.scanWits);
  const [addr, setAddr] = useState(target.wallet);
  const [pounds, setPounds] = useState(poundsFromSats(target.testBalance, tape));
  const [mode, setMode] = useState<WalletMode>(target.walletMode);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const testing = mode === "test";

  useEffect(() => {
    setAddr(target.wallet);
    setPounds(poundsFromSats(target.testBalance, tape));
    setMode(target.walletMode);
    setErr("");
  }, [target.id, target.wallet, target.testBalance, target.walletMode, tape.btcGbp]);

  function apply(nextMode = mode) {
    const n = Number(pounds);
    if (nextMode === "test" && (!Number.isFinite(n) || n < 0)) {
      setErr("Test purse must be a number of pounds.");
      return false;
    }
    const sats = n <= 0 ? 0 : gbpToSats(n, tapeGbp(tape));
    const msg = updateWallet(target.id, {
      wallet: addr,
      testBalance: sats,
      walletMode: nextMode,
    });
    if (msg) {
      setErr(msg);
      return false;
    }
    setErr("");
    return true;
  }

  return (
    <section className="inspect">
      <div className="inspect-head">
        <p className="section-label">{target.king ? "Crown" : "Wallet"}</p>
        <button type="button" className="text-btn" onClick={() => select(null)}>
          Close
        </button>
      </div>
      <p className="inspect-name">
        {target.king ? <Crown size={16} /> : null}
        {target.title}
      </p>
      <p className="stat-num">{formatPurse(target.balance, tape)}</p>
      <p className="hint">
        Shown: {target.walletMode === "chain" ? "on-chain watch" : "test purse"} · test{" "}
        {formatPurse(target.testBalance, tape)}
        {target.chainBalance != null ? ` · chain ${formatPurse(target.chainBalance, tape)}` : ""}
      </p>

      <AgentSelect
        id={`agent-${target.id}`}
        label={target.king ? "King's agent" : "Linked agent"}
        choice={target.brainChoice}
        model={target.brainModel}
        catalog={catalog}
        onChange={(choice, model) => setAgent(target.id, choice, model)}
      />
      <p className="hint">
        {target.king
          ? "Commands the parish. Cannot make anyone."
          : "This agent must think and make money online for the wallet, or the King's tax hangs them."}
      </p>
      <button type="button" className="text-btn" onClick={() => void scanWits()}>
        Find local models
      </button>

      <label className="field-label" htmlFor={`wallet-addr-${target.id}`}>
        Bitcoin address
      </label>
      <input
        id={`wallet-addr-${target.id}`}
        className="wallet-input"
        value={addr}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setAddr(e.target.value)}
      />

      <label className="field-label" htmlFor={`wallet-gbp-${target.id}`}>
        Test purse (£){testing ? "" : " — locked off-test"}
      </label>
      <input
        id={`wallet-gbp-${target.id}`}
        className="wallet-input"
        inputMode="decimal"
        value={pounds}
        disabled={!testing}
        onChange={(e) => setPounds(e.target.value)}
      />

      <div className="mode-row" role="group" aria-label="Wallet mode">
        <button
          type="button"
          className={mode === "test" ? "mode-btn mode-btn-on" : "mode-btn"}
          onClick={() => {
            setMode("test");
            apply("test");
          }}
        >
          Test
        </button>
        <button
          type="button"
          className={mode === "chain" ? "mode-btn mode-btn-on" : "mode-btn"}
          onClick={() => {
            setMode("chain");
            apply("chain");
          }}
        >
          On-chain
        </button>
      </div>

      <div className="wallet-actions">
        <button type="button" className="ledger-btn" onClick={() => apply()}>
          Apply
        </button>
        <button
          type="button"
          className="ledger-btn"
          disabled={busy}
          onClick={() => {
            if (!apply(mode)) return;
            setBusy(true);
            void refreshChain(target.id).then((msg) => {
              setBusy(false);
              if (msg) setErr(msg);
            });
          }}
        >
          {busy ? "Fetching…" : "Fetch chain"}
        </button>
      </div>
      {err ? <p className="wallet-err">{err}</p> : null}
      <p className="hint">
        {target.king
          ? "No keys are stored. The £20 stake and tax come from this test purse. Edit pounds only in Test mode. On-chain is watch-only."
          : "No keys are stored. This linked agent must make money online — the game pays no wage — or hang. Edit pounds only in Test mode. On-chain is watch-only."}
      </p>
      <p className="hint">{target.lastFlavor}</p>
      <TalkForm toId={target.id} name={target.title} />
    </section>
  );
}

export function Ledger() {
  const exchequer = useGame((s) => s.exchequer);
  const king = useGame((s) => s.king);
  const subjects = useGame((s) => s.subjects);
  const taxRate = useGame((s) => s.taxRate);
  const tape = useGame((s) => s.tape);
  const day = useGame((s) => s.day);
  const log = useGame((s) => s.log);
  const dawnRunning = useGame((s) => s.dawnRunning);
  const selectedId = useGame((s) => s.selectedId);
  const brainChoice = useGame((s) => s.brainChoice);
  const brainModel = useGame((s) => s.brainModel);
  const catalog = useGame((s) => s.brainCatalog);
  const give = useGame((s) => s.give);
  const take = useGame((s) => s.take);
  const spawn = useGame((s) => s.spawn);
  const dawn = useGame((s) => s.dawn);
  const nudgeTax = useGame((s) => s.nudgeTax);
  const reset = useGame((s) => s.reset);
  const select = useGame((s) => s.select);
  const setBrain = useGame((s) => s.setBrain);
  const scanWits = useGame((s) => s.scanWits);

  const selected =
    selectedId === "king" ? null : (subjects.find((s) => s.id === selectedId) ?? null);
  const living = subjects.filter((s) => s.state !== "hanging" && s.state !== "condemned");
  const spawnLabel = choiceLabel(brainChoice, brainModel, catalog);

  const kingTarget: WalletTarget = {
    id: "king",
    title: king.name,
    wallet: king.wallet,
    walletMode: king.walletMode,
    testBalance: king.testBalance,
    chainBalance: king.chainBalance,
    balance: king.balance,
    lastFlavor: king.lastFlavor,
    king: true,
    brainChoice: king.brainChoice,
    brainModel: king.brainModel,
  };

  return (
    <aside className="ledger">
      <header className="ledger-head">
        <p className="ledger-kicker">Parish of</p>
        <h1>Ledgerford</h1>
        <p className="ledger-day">Day {day}</p>
      </header>

      <section className="stat-grid">
        <div>
          <p className="section-label">Exchequer</p>
          <p className="stat-num">{formatPurse(exchequer, tape)}</p>
        </div>
        <div>
          <p className="section-label">King</p>
          <button type="button" className="stat-hit" onClick={() => select("king")}>
            <p className="stat-num">{formatPurse(king.balance, tape)}</p>
          </button>
        </div>
      </section>
      <p className="hint">Sum of every purse, in pounds. Click the King to link his agent.</p>

      <section className="tithe-row">
        <p className="section-label">King's tax — yours to set</p>
        <div className="tithe-controls">
          <button type="button" className="icon-btn" onClick={() => nudgeTax(-1)} aria-label="Lower tax">
            <Minus size={16} />
          </button>
          <p className="tithe-value">{Math.round(taxRate * 100)}%</p>
          <button type="button" className="icon-btn" onClick={() => nudgeTax(1)} aria-label="Raise tax">
            <Plus size={16} />
          </button>
        </div>
        <p className="hint">
          Those who cannot pay hang. The King cannot change this. <Key>[</Key> <Key>]</Key>
        </p>
      </section>

      <section className="tape-card">
        <p className="section-label">Make a soul</p>
        <AgentSelect
          id="spawn-agent"
          label="Link this agent"
          choice={brainChoice}
          model={brainModel}
          catalog={catalog}
          onChange={(choice, model) => setBrain(choice, model)}
        />
        <p className="hint">
          You make them. The King cannot. Linked: {spawnLabel}. Costs £{STAKE_GBP} from the King.
          They must make money online or the tax hangs them.
        </p>
        <button
          type="button"
          className="ledger-btn"
          onClick={() => {
            if (spawn()) playSpawn();
          }}
        >
          <UserPlus size={15} /> Make soul <Key>S</Key>
        </button>
        <button type="button" className="text-btn" onClick={() => void scanWits()}>
          Find local models
        </button>
      </section>

      <section>
        <p className="section-label">
          Parish · {living.length}/{LIVING_CAP} living
        </p>
        {living.length === 0 ? (
          <p className="hint">No souls yet. Link an agent and make one.</p>
        ) : (
          <ul className="parish-roll">
            {living.map((sub) => (
              <li key={sub.id}>
                <button type="button" className="roll-hit" onClick={() => select(sub.id)}>
                  <span>{sub.firstName}</span>
                  <span className="roll-money">{formatPurse(sub.balance, tape)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="action-grid">
        <button
          type="button"
          className="ledger-btn"
          onClick={() => {
            playGive();
            give();
          }}
        >
          <Coins size={15} /> Give <Key>G</Key>
        </button>
        <button
          type="button"
          className="ledger-btn"
          onClick={() => {
            playGive();
            take();
          }}
        >
          <Wallet size={15} /> Take <Key>T</Key>
        </button>
        <button
          type="button"
          className="ledger-btn ledger-btn-dawn"
          disabled={dawnRunning}
          onClick={() => {
            playDawn();
            void dawn();
          }}
        >
          <Sun size={15} /> {dawnRunning ? "Dawning…" : "Next dawn"} <Key>N</Key>
        </button>
      </div>
      <p className="hint transfer">
        Give and Take £{TRANSFER_GBP}. Make a soul spends £{STAKE_GBP}. Upkeep £
        {RENT_GBP.toFixed(2)} plus the tax each dawn.
      </p>

      {selected ? (
        <WalletInspect
          tape={tape}
          target={{
            id: selected.id,
            title: selected.firstName,
            wallet: selected.wallet,
            walletMode: selected.walletMode,
            testBalance: selected.testBalance,
            chainBalance: selected.chainBalance,
            balance: selected.balance,
            lastFlavor: selected.lastFlavor,
            king: false,
            brainChoice: selected.brainChoice,
            brainModel: selected.brainModel,
          }}
        />
      ) : selectedId === "king" ? (
        <WalletInspect target={kingTarget} tape={tape} />
      ) : (
        <section className="inspect">
          <p className="section-label">The square</p>
          <p className="hint">Click a name to inspect wallet and linked agent — or shout below.</p>
          <TalkForm toId={null} name="the parish" />
        </section>
      )}

      <section className="log">
        <p className="section-label">
          <ScrollText size={13} /> Chronicle
        </p>
        <ol>
          {log.slice(0, 14).map((entry) => (
            <li key={entry.id} data-kind={entry.kind}>
              {entry.text}
            </li>
          ))}
        </ol>
      </section>

      <footer className="ledger-foot">
        <p>Click a soul to link an agent, edit the wallet, and speak. Esc deselects.</p>
        <button type="button" className="text-btn" onClick={reset}>
          New reign
        </button>
      </footer>
    </aside>
  );
}
