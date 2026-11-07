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

// Ground truth for alacritty (and other legacy terminals): the wire carries
// ESC + full UTF-8 Cyrillic char (e.g. 1b d0 b4 for alt+д), but the native
// stdin parser mangles it BEFORE any input handler sees it: it emits two
// events, ESC+(cp & 0xFF) and ESC+U+FFFD, so the letter cannot be recovered
// from the event. The renderer copies every raw stdin chunk to stdinLogPath
// BEFORE parsing, so that file is the authoritative wire. This plugin reads
// it with a cursor: each ESC-prefixed event consumes exactly one wire
// ESC-sequence; if that sequence is ESC + UTF-8 Cyrillic, the Latin
// equivalent is injected. Real alt+ASCII needs no guessing and no delays.
const WIRE_LOG = "/tmp/opencode-stdin.log"

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
      stdinLogPath?: string
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

    // --- wire cursor state ---
    // deno-lint-ignore no-explicit-any
    let fs: any = null
    let cursor = 0
    const initWire = () => {
      if (fs) return true
      try {
        // deno-lint-ignore no-explicit-any
        fs = (globalThis as any).process?.getBuiltinModule?.("node:fs")
      } catch {}
      if (!fs) return false
      try {
        cursor = fs.statSync(WIRE_LOG).size
      } catch {
        cursor = 0
      }
      return true
    }
    initWire()

    /**
     * Find the first unconsumed wire Cyrillic sequence (ESC + 2-byte UTF-8
     * with a d0/d1 lead — a signature mouse CSI and alt+ASCII never have)
     * and consume the wire up to and including it. Junk between the cursor
     * and it (mouse wheel floods, plain typing, real alt+ASCII presses)
     * is skipped, because those do not reach this handler: mouse events are
     * eaten by processSingleMouseEvent, and alt+ASCII parses natively.
     * FIFO order matches press order, so batched presses stay aligned.
     */
    const consumeCyr = (): string | "none" | "unavail" => {
      if (!initWire()) return "unavail"
      let buf: Buffer
      try {
        const size = fs.statSync(WIRE_LOG).size
        // Bound staleness: never rewind more than 8 KiB behind the writer.
        const start = Math.min(cursor, Math.max(0, size - 8192))
        if (start > cursor) cursor = start
        buf = fs.readFileSync(WIRE_LOG).subarray(cursor, Math.min(size, cursor + 8192))
      } catch {
        return "unavail"
      }
      const base = cursor
      let i = 0
      while (i < buf.length) {
        let p = i
        while (p < buf.length && buf[p] !== 0x1b) p++
        if (p >= buf.length) {
          cursor = base + buf.length
          return "none"
        }
        const b1 = buf[p + 1]
        if (b1 === undefined) {
          // Lone ESC at the tail (Escape key press): leave it for the next
          // press to pair with.
          cursor = base + p
          return "none"
        }
        if (b1 === 0xd0 || b1 === 0xd1) {
          const b2 = buf[p + 2]
          if (b2 === undefined) {
            // Partial UTF-8 at the tail: wait for the continuation.
            cursor = base + p
            return "none"
          }
          if ((b2 & 0xc0) === 0x80) {
            const cp = ((b1 & 0x1f) << 6) | (b2 & 0x3f)
            const ch = String.fromCodePoint(cp)
            cursor = base + p + 3
            if (MAP[ch] !== undefined) return ch
            i = p + 3
            continue
          }
        }
        // Non-Cyrillic ESC sequence: CSI or ESC+byte. CSI final byte is
        // 0x40-0x7E; everything else is a two-byte ESC+byte. An ESC+ESC
        // pair is two sequence starts (Escape key + next press), so a lone
        // ESC consumes exactly one byte.
        if (b1 === 0x1b) {
          i = p + 1
          continue
        }
        let end = p + 2
        if (b1 === 0x5b) {
          let j = p + 2
          while (j < buf.length && !(buf[j] >= 0x40 && buf[j] <= 0x7e)) j++
          if (j >= buf.length) {
            // Incomplete CSI at the tail: leave it unconsumed.
            cursor = base + p
            return "none"
          }
          end = j + 1
        }
        i = end
      }
      cursor = base + buf.length
      return "none"
    }

    // Safety net when the wire is unreadable: stash the truncated alt+ASCII
    // event and replay it if no confirmation arrives.
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

      // Partner events (ESC+U+FFFD) belong to a press already handled via
      // the wire; they carry no new bytes -> swallow silently.
      if (sequence === "\x1b\ufffd") return false

      // Lone ESC (Escape key): consume nothing — its wire byte is absorbed
      // as junk by the next skip (e.g. ESC+ESC before a press).
      if (sequence.length === 1) return false

      // ESC+byte or exotic ESC event: match it against the next unconsumed
      // wire Cyrillic sequence (FIFO). Real alt+ASCII and mouse ESC events
      // see no Cyrillic pending and flow through natively.
      const r = consumeCyr()
      if (r === "unavail") {
        // Wire unavailable: fall back to the stash/timeout heuristic on
        // the truncated first event.
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
      if (r === "none") return false
      return replay(`\x1b${MAP[r]!}`)
    }

    renderer.prependInputHandler(handler)

    // Keep the renderer dumping raw stdin chunks to the wire log (checked
    // per chunk at runtime, so assigning it here is enough).
    try {
      renderer.stdinLogPath = WIRE_LOG
    } catch {}

    return () => {
      dropStash()
      renderer.removeInputHandler(handler)
    }
  },
})
