# opencode-plugins

A collection of plugins for the [opencode](https://opencode.ai) terminal UI.

## Layout

| Directory | SDK | Format |
| --- | --- | --- |
| `v1/` | `@opencode-ai/plugin` (legacy) | One file per plugin |
| `v2/` | `@opencode/plugin` (current) | Directory with `index.ts` + `tui.ts` |

`v2` targets opencode 1.19.x. `v1` is kept for older setups and reference.

## Plugins

### v2 (current)

| Plugin | Description |
| --- | --- |
| [location-sync](v2/location-sync/README.md) | Re-syncs the model list at startup and on demand |
| [pins](v2/pins/README.md) | Pinned sessions dialog with reorder, rename and delete |
| [ru-keys](v2/ru-keys/README.md) | Makes `alt`-shortcuts work on a Russian (ЙЦУКЕН) layout |
| [session-cycle](v2/session-cycle/README.md) | Tab, session and agent cycling shortcuts |
| [theme-toggle](v2/theme-toggle/README.md) | Light/dark toggle and theme list shortcuts |
| [mcp-watchdog](v2/mcp-watchdog.md) | Reconnects failed MCP servers with backoff |

### v1 (legacy)

| Plugin | Description |
| --- | --- |
| [ignore-guard](v1/ignore-guard.md) | Enforces `.opencodeignore` for file-access tools |
| [session-cycle](v1/session-cycle.md) | `<leader>`-based session cycling |
| [theme-toggle](v1/theme-toggle.md) | `<leader>v` light/dark toggle |

## Installation

opencode loads local plugins from a `plugins` directory:

- project: `<project>/.opencode/plugins/`
- global: `~/.config/opencode/plugins/`

Copy the plugin and restart opencode:

```sh
# v2: copy the whole directory
cp -r v2/pins ~/.config/opencode/plugins/pins

# v1: copy the single file
cp v1/ignore-guard.ts ~/.config/opencode/plugins/ignore-guard.ts
```

v2 plugins export from both `index.ts` and `tui.ts`; the directory name is up to
you, but keep it stable because some plugins resolve relative paths from their
own location. `mcp-watchdog` ships as a single file: copy `v2/mcp-watchdog.v2.ts`
as `.opencode/plugins/mcp-watchdog.ts`.

The plugins import the plugin SDK provided by opencode (`@opencode/plugin` for
v2, `@opencode-ai/plugin` for v1). The `.opencode/` runtime directory is not part
of this repository.

## License

MIT — see [LICENSE](LICENSE).
