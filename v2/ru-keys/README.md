# ru-keys

Makes `alt`-shortcuts work when the keyboard layout is Russian (ЙЦУКЕН).

The plugin maps a Cyrillic character typed with `alt` to the Latin key in the
same physical position (33-character layout map) and feeds the result back to
the renderer, so shortcuts such as `alt+l` or `alt+p` fire regardless of the
active layout.

## What is handled

- **Kitty keyboard protocol** — `ESC [ codepoint[:shifted][:base] ; mods ... u`
  sequences with modifiers; the Cyrillic codepoint is rewritten to Latin while
  modifiers are preserved.
- **Legacy whole-character form** — `ESC + Cyrillic` is rewritten to
  `ESC + Latin`.
- **Legacy split form** — some terminals split `ESC + UTF-8 Cyrillic` into
  `ESC + (codepoint & 0xFF)` and `ESC + U+FFFD`. The truncated event is stashed
  and replayed after 60 ms if no confirmation arrives.

Injected keys are pushed through the renderer's stdin parser
(`stdinParser.push` + `drainStdinParser`), with
`_internalKeyInput.processParsedKey` as a fallback.

The plugin writes no logs and creates no temporary files.

## Limitations

- Relies on private renderer internals (`prependInputHandler`,
  `stdinParser`, `drainStdinParser`, `_internalKeyInput`); an opencode update can
  break it.
- Only affects `alt`-modified input.
- On legacy terminals the split-form path adds a 60 ms delay.

## Install

Copy `v2/ru-keys` to `.opencode/plugins/ru-keys/`.
