# location-sync

Keeps the model list for the current location populated at startup.

## Behavior

1. Waits 1 second.
2. If no models are known for the current location, calls
   `context.data.location.sync(context.location)`.
3. Retries with exponential backoff `min(1000 * 2^n, 30000)` ms, up to 7
   attempts total.
4. Stops as soon as models are available.

## Commands

| Command | Description |
| --- | --- |
| `plugin.location.resync` | Reload models immediately ("Reload models" in the palette) |

## Files

- `index.ts` — plugin manifest (`setup` is a no-op).
- `tui.ts` — TUI logic and the palette command.

## Install

Copy `v2/location-sync` to `.opencode/plugins/location-sync/`.
