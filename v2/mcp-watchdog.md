# mcp-watchdog

Watches MCP servers and reconnects failed ones with exponential backoff.

## Behavior

The status of all MCP servers is polled every 30 seconds.

| Status | Action |
| --- | --- |
| `connected` | reset backoff and auth reminders |
| `disabled` | clear state, do nothing |
| `pending` | wait for the next tick |
| `needs_auth` | warn at most every 10 minutes: ``opencode mcp auth <name>`` |
| `failed` | reconnect with backoff |

Reconnecting (`rearm`) is done by disabling the server, reloading MCP, enabling
it again and reloading once more.

Backoff starts at 20 seconds and doubles per attempt, capped at 10 minutes:

```
min(20000 * 2^(attempts - 1), 600000)
```

The first failure is logged, and every retry logs the attempt number and the
delay until the next one.

## Logging

Messages are prefixed with `[mcp-watchdog]` and written via
`console.info` / `console.warn` / `console.error`.

## Install

This plugin is a single file. Copy `v2/mcp-watchdog.v2.ts` to
`.opencode/plugins/mcp-watchdog.ts`.
