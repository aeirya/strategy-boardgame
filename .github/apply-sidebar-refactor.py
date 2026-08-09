from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


def replace_count(text: str, old: str, new: str, expected: int, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} matches, found {count}")
    return text.replace(old, new)


main_path = Path("apps/web/src/main.tsx")
styles_path = Path("apps/web/src/styles.css")
board_view_path = Path("apps/web/src/board-view.css")
responsive_path = Path("apps/web/src/responsive.css")

main = main_path.read_text()

# The board already owns the order tray and unit icon language. The sidebar was
# repeating both, while pushing the useful contextual panels below the fold.
old_sidebar_tail = '''              <InfluenceBoard state={effectiveState} compact={gameStarted} />
              <OrdersPanel localOrders={localOrders} playerId={playerId} state={effectiveState} />
              <PlayerPanel state={effectiveState} me={me} compact={gameStarted} />
              <AreaPanel area={selected} state={effectiveState} />
              {effectiveState.phase === "advance" && <PieceLegend />}
              <CombatCardsPanel me={me} />
              <LogPanel state={effectiveState} />'''
new_sidebar_tail = '''              <AreaPanel area={selected} state={effectiveState} />
              <PlayerPanel state={effectiveState} me={me} compact={gameStarted} />
              <InfluenceBoard state={effectiveState} compact={gameStarted} />
              <CombatCardsPanel me={me} />
              <LogPanel state={effectiveState} />'''
main = replace_once(main, old_sidebar_tail, new_sidebar_tail, "sidebar panel order")

main = replace_count(main, '<h2>Resource Tracks</h2>', '<h2>Priority Tracks</h2>', 2, "priority track heading")
main = replace_once(
    main,
    '<h2>{me ? playerTheme[me.playerKey].label : gameBundle.ui.playerPlural}</h2>',
    '<h2>Scores</h2>',
    "compact score heading"
)
main = replace_once(
    main,
    '      <p className="hint">Combat card choice will plug into this hand once card effects are implemented.</p>\n',
    '',
    "stale combat card hint"
)
main = replace_once(
    main,
    '          <button className="ghost" disabled={!myTurn} onClick={onDefaultOrders}>Quick Demo Orders</button>\n',
    '',
    "planning demo button"
)
main = replace_once(
    main,
    '      <button className="ghost" disabled={!myTurn} onClick={onAutoplay}>Auto-play My Step · Space</button>',
    '''      <details className="command-assist">
        <summary>Assist & testing</summary>
        {state.phase === "planning" && <button className="ghost" disabled={!myTurn} onClick={onDefaultOrders}>Fill demo orders</button>}
        <button className="ghost" disabled={!myTurn} onClick={onAutoplay}>Auto-play current step · Space</button>
      </details>''',
    "command assist disclosure"
)
main = replace_count(main, "advanceing", "advancing", 2, "advancing copy typo")

# Remove the two dead sidebar-only components instead of merely hiding them.
piece_pattern = re.compile(r'\nfunction PieceLegend\(\) \{.*?\n\}\n\nfunction IconDesigner', re.S)
main, count = piece_pattern.subn('\nfunction IconDesigner', main, count=1)
if count != 1:
    raise SystemExit(f"PieceLegend removal: expected 1 match, found {count}")

orders_pattern = re.compile(r'\nfunction OrdersPanel\(\{ localOrders, playerId, state \}:.*?\n\}\n\nfunction commandHint', re.S)
main, count = orders_pattern.subn('\nfunction commandHint', main, count=1)
if count != 1:
    raise SystemExit(f"OrdersPanel removal: expected 1 match, found {count}")

main_path.write_text(main)

styles = styles_path.read_text()
styles = replace_once(
    styles,
    '''.layout {
  align-items: flex-start;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 6px;
}''',
    '''.layout {
  align-items: flex-start;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(248px, 18vw, 282px);
  gap: 6px;
}''',
    "desktop layout columns"
)
styles = replace_once(
    styles,
    '''.side-panel {
  display: grid;
  width: 220px;
  gap: 7px;
}''',
    '''.side-panel {
  position: sticky;
  top: 48px;
  display: grid;
  align-self: start;
  align-content: start;
  width: 100%;
  max-height: calc(100dvh - 56px);
  gap: 7px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
  scrollbar-width: thin;
}''',
    "desktop sidebar shell"
)
styles = replace_once(
    styles,
    '''.compact-panel summary h2::after {
  content: "+";
  float: right;
  color: #d7b66f;
}

.compact-panel[open] summary h2::after {
  content: "-";
}''',
    '''.compact-panel summary.panel-heading {
  grid-template-areas:
    "eyebrow marker"
    "title marker";
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 8px;
}

.compact-panel summary.panel-heading .eyebrow {
  grid-area: eyebrow;
}

.compact-panel summary.panel-heading h2 {
  grid-area: title;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compact-panel summary.panel-heading::after {
  grid-area: marker;
  content: "+";
  color: #d7b66f;
  font-size: 16px;
  font-weight: 900;
}

.compact-panel[open] summary.panel-heading::after {
  content: "−";
}''',
    "compact panel disclosure marker"
)

assist_anchor = '''.command-hint {
  border-left: 4px solid #ffd36f;
  background: rgba(255, 239, 199, 0.09);
  color: #f1dfbf;
  padding: 9px 10px;
  font-size: 13px;
  line-height: 1.35;
}
'''
assist_css = assist_anchor + '''
.command-assist {
  border-top: 1px solid rgba(232, 211, 173, 0.12);
  padding-top: 6px;
}

.command-assist summary {
  cursor: pointer;
  color: #ad9b80;
  font-size: 11px;
  font-weight: 800;
}

.command-assist[open] {
  display: grid;
  gap: 6px;
}

.command-assist button {
  width: 100%;
  min-height: 32px;
  padding: 6px 8px;
  box-shadow: none;
  font-size: 11px;
}

.side-panel .compact-panel:not([open]) {
  box-shadow: none;
  padding-block: 7px;
}
'''
styles = replace_once(styles, assist_anchor, assist_css, "sidebar compact styling")
styles_path.write_text(styles)

board_view = board_view_path.read_text()
board_view = replace_once(
    board_view,
    '''.fit-board-view .layout {
  grid-template-columns: minmax(0, 1fr);
}

.fit-board-view .side-panel {
  width: 100%;
  min-width: 0;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 6px;
}

''',
    '',
    "fit-mode sidebar relocation"
)
board_view = board_view.replace(
    ' * ratio, freezes camera navigation, and moves tool shelves below the map.\n',
    ' * ratio and freezes camera navigation. The gameplay sidebar keeps its normal\n * desktop position so switching camera modes does not rearrange the whole UI.\n'
)
board_view_path.write_text(board_view)

responsive = responsive_path.read_text()
responsive = replace_once(
    responsive,
    '''  .side-panel {
    width: 100%;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 4px;
  }''',
    '''  .side-panel {
    position: static;
    display: flex;
    align-items: flex-start;
    align-content: flex-start;
    flex-wrap: wrap;
    width: 100%;
    max-height: none;
    min-width: 0;
    gap: 4px;
    overflow: visible;
    padding-right: 0;
  }

  .side-panel > .current-command {
    flex: 1 1 280px;
  }

  .side-panel > .compact-panel {
    flex: 1 1 210px;
    max-width: 320px;
  }''',
    "narrow sidebar wrapping"
)
responsive = replace_once(
    responsive,
    '''  .side-panel {
    grid-template-columns: minmax(0, 1fr);
  }''',
    '''  .side-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .side-panel > .current-command,
  .side-panel > .compact-panel {
    max-width: none;
  }''',
    "phone sidebar stack"
)
responsive_path.write_text(responsive)
