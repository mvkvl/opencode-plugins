# theme-toggle (v1)

Legacy TUI plugin that toggles the light/dark theme mode.

| Key | Action |
| --- | --- |
| `<leader>v` | toggle light/dark |

Palette command: `theme.toggle.mode`. It dispatches the built-in
`theme.switch_mode` command.

Built against the legacy `@opencode-ai/plugin/tui` API (`api.keymap.registerLayer`).

## Install

Copy `v1/theme-toggle.ts` to `.opencode/plugins/theme-toggle.ts`.
