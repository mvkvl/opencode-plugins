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
// from the event. The plugin therefore shadows the raw stream in memory:
// every stdin chunk is appended to a bounded buffer ahead of the renderer's
// parser listener, so by the time an event is dispatched the shadow already
// holds its bytes. Each ESC-prefixed, non-control-sequence event scans the
// shadow for the first unconsumed ESC + UTF-8 Cyrillic sequence and injects
// its Latin equivalent; everything else (arrows, mouse CSIs, real alt+ASCII)
// flows through natively with no delays and no disk writes.

// Hard cap for the shadow: a flood with no ESC key event (mouse scrolling,
// plain typing) must not grow memory. When it fires, the oldest bytes are
// dropped — the same staleness tradeoff as the cursor cap they replace.
const WIRE_CAP = 16384
const WIRE_TRIM = 4096

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
      stdin?: {
        on: (event: string, listener: (...args: unknown[]) => void) => unknown
        removeListener: (event: string, listener: (...args: unknown[]) => void) => unknown
        listeners?: (event: string) => unknown[]
      }
    }

    let replaying = false
    // deno-lint-ignore no-explicit-any
    let BufferCtor: any = null

    /** Push a sequence through the stdin parser as if the terminal sent it. */
    const replay = (seq: string): boolean => {
      if (renderer.stdinParser && renderer.drainStdinParser) {
        try {
          BufferCtor ??= (globalThis as any).process?.getBuiltinModule?.("node:buffer")
            .Buffer
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

    // --- in-memory wire shadow ---
    // The shadow always holds exactly the unconsumed wire bytes: the
    // consumed prefix is dropped after every scan, so no separate cursor
    // index is needed and memory stays bounded.
    // deno-lint-ignore no-explicit-any
    let shadow: any = null
    // deno-lint-ignore no-explicit-any
    let stream: any = null
    // deno-lint-ignore no-explicit-any
    let onData: any = null

    const attachWire = (): boolean => {
      if (shadow) return true
      if (!BufferCtor) {
        try {
          BufferCtor = (globalThis as any).process?.getBuiltinModule?.("node:buffer")
            .Buffer
        } catch {}
      }
      if (!BufferCtor) return false
      const s = renderer.stdin ?? (globalThis as any).process?.stdin
      if (!s || typeof s.on !== "function") return false
      shadow = new BufferCtor(0)
      onData = (chunk: unknown): void => {
        try {
          const c = BufferCtor.isBuffer(chunk) ? chunk : BufferCtor.from(chunk as string)
          shadow = shadow.length > 0 ? BufferCtor.concat([shadow, c]) : BufferCtor.from(c)
          if (shadow.length > WIRE_CAP) {
            shadow = BufferCtor.from(shadow.subarray(shadow.length - WIRE_TRIM))
          }
        } catch {}
      }
      try {
        // Register ahead of the renderer's parser listener so the shadow
        // already holds the bytes of the event being dispatched. If the
        // parser listener exists already, move ours in front of it.
        const existing = typeof s.listeners === "function" ? s.listeners("data") : []
        for (const l of existing) s.removeListener("data", l as (...args: unknown[]) => void)
        s.on("data", onData)
        for (const l of existing) s.on("data", l as (...args: unknown[]) => void)
      } catch {
        shadow = null
        onData = null
        return false
      }
      stream = s
      return true
    }

    /** Drop the consumed prefix; keep only bytes from `consumed` onward. */
    const commit = (consumed: number): void => {
      if (!shadow) return
      shadow =
        consumed >= shadow.length
          ? new BufferCtor(0)
          : BufferCtor.from(shadow.subarray(consumed))
    }

    /**
     * Find the first unconsumed wire Cyrillic sequence (ESC + 2-byte UTF-8
     * with a d0/d1 lead — a signature mouse CSI and alt+ASCII never have)
     * and consume the wire up to and including it. Junk before it (mouse
     * wheel floods, plain typing, arrows, real alt+ASCII presses) is
     * skipped, because those do not reach this handler or parse natively.
     * FIFO order matches press order, so batched presses stay aligned.
     */
    const consumeCyr = (): string | "none" | "unavail" => {
      if (!attachWire() || !shadow) return "unavail"
      const buf = shadow
      let i = 0
      let at = buf.length
      while (i < buf.length) {
        let p = i
        while (p < buf.length && buf[p] !== 0x1b) p++
        if (p >= buf.length) {
          at = buf.length
          break
        }
        const b1 = buf[p + 1]
        if (b1 === undefined) {
          // Lone ESC at the tail (Escape key press): leave it for the next
          // press to pair with.
          at = p
          break
        }
        if (b1 === 0xd0 || b1 === 0xd1) {
          const b2 = buf[p + 2]
          if (b2 === undefined) {
            // Partial UTF-8 at the tail: wait for the continuation.
            at = p
            break
          }
          if ((b2 & 0xc0) === 0x80) {
            const cp = ((b1 & 0x1f) << 6) | (b2 & 0x3f)
            const ch = String.fromCodePoint(cp)
            at = p + 3
            if (MAP[ch] !== undefined) {
              commit(at)
              return ch
            }
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
            at = p
            break
          }
          end = j + 1
        }
        i = end
      }
      commit(at)
      return "none"
    }

    // Safety net when the wire is unavailable: stash the ambiguous
    // ESC+single-byte event and replay it if no confirmation arrives.
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

      // Real control sequences (CSI: arrows, Delete, Home/End, PgUp/PgDn,
      // modified arrows; SS3: F1-F4) are never mangled alt+Cyrillic: pass
      // them through untouched, with no wire scan and no delay. A mangled
      // Cyrillic char always splits into ESC + a byte in 0x10-0x4F, so it
      // can never start with ESC [ ; the 2-byte ESC O event stays covered
      // by the scan below (real SS3 always has a third byte).
      if (sequence.startsWith("\x1b[") || (sequence.startsWith("\x1bO") && sequence.length > 2)) {
        return false
      }

      // ESC+byte or exotic ESC event: match it against the next unconsumed
      // wire Cyrillic sequence (FIFO). Real alt+ASCII sees no Cyrillic
      // pending and flows through natively.
      const r = consumeCyr()
      if (r === "none") return false
      if (r === "unavail") {
        // Wire unavailable: only the ambiguous ESC+single-byte event, which
        // may be a mangled alt+Cyrillic, uses the stash/timeout heuristic;
        // everything unambiguous was already passed through above.
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
      return replay(`\x1b${MAP[r]!}`)
    }

    renderer.prependInputHandler(handler)

    // Attach the shadow early so it is registered before the renderer's
    // parser listener attaches its own; if that one exists already,
    // attachWire moves ours in front of it.
    attachWire()

    return () => {
      dropStash()
      renderer.removeInputHandler(handler)
      if (stream && onData) {
        try {
          stream.removeListener("data", onData)
        } catch {}
      }
      stream = null
      onData = null
      shadow = null
    }
  },
})
