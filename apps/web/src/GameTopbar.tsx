import { gameBundle, playerTheme, type GameState, type PlayerKey } from "@tabletop/rules";
import { useEffect, useRef, useState } from "react";
import "./session-toolbar.css";

type GameTopbarProps = {
  botEnabled: boolean;
  gameId: string;
  hash: string;
  playerKey: PlayerKey;
  playerName: string;
  state: GameState;
  onBotEnabledChange: (enabled: boolean) => void;
};

const toolLinks = [
  { label: "Icons", href: "#icon-designer" },
  { label: "Map", href: "#map-editor" }
] as const;

export function GameTopbar({ botEnabled, gameId, hash, playerKey, playerName, state, onBotEnabledChange }: GameTopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const actor = state.pending
    ? playerTheme[state.pending.playerKey].label
    : state.winner
      ? `${playerTheme[state.winner].label} wins`
      : "None";

  useEffect(() => {
    setMenuOpen(false);
  }, [hash]);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !toggleRef.current?.contains(target)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function copyGameId() {
    if (!gameId) return;
    await navigator.clipboard.writeText(gameId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 900);
  }

  return (
    <nav className="game-topbar" aria-label="Game navigation">
      <div className="game-topbar-status" aria-label="Game status">
        <StatusItem label="Round" value={state.tracks.round} />
        <StatusItem label="Phase" value={phaseLabel(state.phase)} />
        <StatusItem label="To act" value={actor} />
        <StatusItem label={gameBundle.ui.threatLabel} value={state.tracks.threat} emphasis />
      </div>

      <div className="game-topbar-actions">
        {toolLinks.map(({ label, href }) => {
          const active = hash === href;
          return (
            <a
              key={href}
              className={`game-topbar-action${active ? " active" : ""}`}
              href={href}
              aria-current={active ? "page" : undefined}
            >
              {label}
            </a>
          );
        })}

        <div className="game-menu">
          <button
            ref={toggleRef}
            type="button"
            className="game-topbar-action"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            Game
          </button>

          {menuOpen && (
            <section ref={menuRef} className="session-menu-popover" aria-label="Game session details">
              <header>
                <strong>Game session</strong>
                <button className="session-menu-close" type="button" aria-label="Close game session details" onClick={() => setMenuOpen(false)}>×</button>
              </header>
              <DetailRow label="Player" value={playerName} />
              <DetailRow label="House" value={playerTheme[playerKey].label} />
              <div className="session-detail-row session-id-row">
                <span>Game ID</span>
                <code>{gameId || "—"}</code>
                <button type="button" disabled={!gameId} onClick={() => void copyGameId()}>{copied ? "Copied" : "Copy"}</button>
              </div>
              <label className="session-ai-toggle">
                <input type="checkbox" checked={botEnabled} onChange={(event) => onBotEnabledChange(event.target.checked)} />
                <span>AI pilot</span>
              </label>
            </section>
          )}
        </div>
      </div>
    </nav>
  );
}

function StatusItem({ label, value, emphasis = false }: { label: string; value: string | number; emphasis?: boolean }) {
  return (
    <div className={`game-topbar-stat${emphasis ? " is-emphasis" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="session-detail-row">
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function phaseLabel(phase: GameState["phase"]) {
  return phase.replace(/^\w/, (letter) => letter.toUpperCase());
}
