import { Plugin } from "@opencode/plugin/tui"

// ЙЦУКЕН -> QWERTY, index-aligned (both length 33).
const RU = "йцукенгшщзхъфывапролджэячсмитьбю."
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`"

const MAP: Record<string, string> = {}
for (let i = 0; i < RU.length; i++) {
  MAP[RU[i]] = EN[i]
  MAP[RU[i].toUpperCase()] = EN[i].toUpperCase()
}

// Kitty keyboard protocol: ESC [ cp[:shifted][:base] ; mods[:event][:base] u
const KITTY_RE = /^\x1b\[(\d+)(?::(\d+))?(?::(\d+))?;(\d+)(?::(\d+))?(?::(\d+))?u$/

/** Whole-character forms: legacy ESC+Cyrillic and kitty CSI-u with modifiers. */
const translate = (seq: string): string | null => {
  if (seq.length === 2 && seq.charCodeAt(0) === 27) {
    const lat = MAP[seq[1]]
    return lat ? `\x1b${lat}` : null
  }
  const m = KITTY_RE.exec(seq)
  if (!m) return null
  const mods = Number(m[4])
  if (!(mods > 1)) return null
  const candidates: Array<[string | undefined, number]> = [
    [m[1], 1],
    [m[2], 2],
    [m[6], 3],
  ]
  for (const [field, group] of candidates) {
    if (field === undefined) continue
    const ch = String.fromCodePoint(Number(field))
    const lat = MAP[ch]
    if (!lat) continue
    const replaced = String(lat.codePointAt(0))
    const parts = [...m]
    parts[group] = replaced
    return `\x1b[${parts[1]}${parts[2] ? `:${parts[2]}` : ""}${parts[3] ? `:${parts[3]}` : ""};${parts[4]}${parts[5] ? `:${parts[5]}` : ""}${parts[6] ? `:${parts[6]}` : ""}u`
  }
  return null
}

export default Plugin.define({
  id: "ru-keys",
  setup(context) {
    // --- renderer surface ---
    const renderer = context.renderer as unknown as {
      prependInputHandler: (h: (sequence: string) => boolean) => void
      removeInputHandler: (h: (sequence: string) => boolean) => void
      stdinParser?: { push: (data: Buffer) => void }
      drainStdinParser?: () => void
      _internalKeyInput?: {
        processParsedKey: (key: Record<string, unknown>) => boolean
      }
    }

    let replaying = false
    let BufferCtor: (new (s: string) => Buffer) | null = null

    /** Push a sequence through the stdin parser as if the terminal sent it. */
    const replay = (seq: string): boolean => {
      if (renderer.stdinParser && renderer.drainStdinParser) {
        try {
          BufferCtor ??= (globalThis as any).process?.getBuiltinModule?.("node:buffer")
            .Buffer
          // deno-lint-ignore no-explicit-any
          if (!BufferCtor) return false
          replaying = true
          renderer.stdinParser.push(new BufferCtor(seq))
          renderer.drainStdinParser()
          return true
        } catch {
          return false
        } finally {
          replaying = false
        }
      }
      // Fallback: feed a synthesized parsed key directly to the key handler.
      const handler = renderer._internalKeyInput
      if (!handler) return false
      const ch = seq.length === 2 ? seq[1] : ""
      if (!ch) return false
      try {
        handler.processParsedKey({
          name: ch.toLowerCase(),
          ctrl: false,
          meta: true,
          shift: ch !== ch.toLowerCase(),
          option: false,
          number: /^[0-9]$/.test(ch),
          sequence: seq,
          raw: seq,
          eventType: "press",
          source: "raw",
        })
        return true
      } catch {
        return false
      }
    }

    // Fallback for legacy terminals: the parser splits ESC+UTF-8 Cyrillic
    // into ESC+(cp & 0xFF) and ESC+U+FFFD. Stash the truncated first event
    // and replay it if no confirmation arrives.
    let stash: { seq: string; timer: ReturnType<typeof setTimeout> } | null = null
    const dropStash = () => {
      if (!stash) return
      clearTimeout(stash.timer)
      stash = null
    }

    const handler = (sequence: string): boolean => {
      if (replaying) return false

      // Intact forms (kitty CSI-u with mods, or whole-char legacy meta).
      const whole = translate(sequence)
      if (whole) return replay(whole)

      if (sequence.charCodeAt(0) !== 27) return false

      // Partner event (ESC+U+FFFD) carries no new bytes -> swallow silently.
      if (sequence === "\x1b\ufffd") return false

      // Lone ESC (Escape key).
      if (sequence.length === 1) return false

      // ESC+byte: a legacy terminal split an alt+Cyrillic press. Stash the
      // truncated event and replay it if no confirmation arrives.
      dropStash()
      const timer = setTimeout(() => {
        if (stash?.timer === timer) {
          stash = null
          replay(sequence)
        }
      }, 60)
      stash = { seq: sequence, timer }
      return true
    }

    renderer.prependInputHandler(handler)

    return () => {
      dropStash()
      renderer.removeInputHandler(handler)
    }
  },
})
