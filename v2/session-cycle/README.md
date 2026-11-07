# session-cycle

Tab, session and agent cycling shortcuts.

| Key | Action |
| --- | --- |
| `alt+left` | previous session tab (falls back to cycling sessions when no tabs) |
| `alt+right` | next session tab (same fallback) |
| `alt+w` | close the current tab |
| `alt+n` | create a new session and open it |
| `alt+up` | switch to a newer session |
| `alt+down` | switch to an older session |
| `tab` | next agent (dispatches `agent.cycle`) |

Session cycling only considers root sessions, ordered by `time.updated`
descending. When no session is open, the first one is selected.

Palette commands: `plugin.session.tab.previous`, `plugin.session.tab.next`,
`plugin.session.tab.close`, `plugin.session.new`, `plugin.session.cycle.newer`,
`plugin.session.cycle.older`, `plugin.agent.cycle`.

## Files

- `index.ts` — plugin manifest (`setup` is a no-op).
- `tui.ts` — keymap layer and handlers.

## Install

Copy `v2/session-cycle` to `.opencode/plugins/session-cycle/`.
