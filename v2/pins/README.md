# pins

Pinned sessions with a searchable list, reordering, rename and delete.

## Keybindings

| Key | Where | Action |
| --- | --- | --- |
| `alt+l` | global | open the sessions list |
| `alt+p` | global | pin/unpin the current session |
| `alt+p` | in list | pin/unpin the highlighted session |
| `alt+j` | in list | move the pin up |
| `alt+k` | in list | move the pin down |
| `ctrl+r` | in list | rename the highlighted session |
| `ctrl+d` | in list | delete the highlighted session (asks for confirmation) |

Slash commands: `/pins` (list) and `/pin` (toggle).

## List layout

- Pinned sessions first, in saved order.
- The remaining sessions are grouped by update date (`Today`, `Yesterday`, then
  a localized date).
- A running session shows a spinner in the gutter; the current session is marked
  with a dot.
- The list is searchable by title.

## Persistence

Pins are kept in opencode's reactive storage under the `pins` key and mirrored
to:

```
<project>/.opencode/session/pins/pins.json
```

If the project directory is unavailable, the fallback path is relative to the
plugin directory (`../../session/pins/pins.json`). Pins are also pruned when a
session is deleted.

The home footer shows an `alt+l sessions` hint, and a short intro toast is shown
on first run.

## Install

Copy `v2/pins` to `.opencode/plugins/pins/`.
