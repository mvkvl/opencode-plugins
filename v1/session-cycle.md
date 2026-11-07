# session-cycle (v1)

Legacy TUI plugin for cycling through root sessions.

| Key | Action |
| --- | --- |
| `<leader>left` | switch to newer session |
| `<leader>right` | switch to older session |

Sessions are listed root-only (sub-agents are skipped). Pinned sessions come
first, in the order stored in `<state>/session.json` under `pinned`; the rest are
sorted by `time.updated` descending. When no session is open, the first entry is
selected.

Palette commands: `session.cycle.newer`, `session.cycle.older`.

Built against the legacy `@opencode-ai/plugin/tui` API (`api.keymap.registerLayer`,
`api.route`).

## Install

Copy `v1/session-cycle.ts` to `.opencode/plugins/session-cycle.ts`.
