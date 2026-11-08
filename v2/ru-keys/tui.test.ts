// Test harness for the ru-keys TUI plugin (in-memory wire shadow).
// Stubs the plugin import, feeds a fake renderer + fake stdin stream, and
// drives the raw-sequence handler exactly like dispatchSequenceHandlers does.
// Run: node tui.test.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"

const HERE = new URL(".", import.meta.url).pathname
const SRC = `${HERE}tui.ts`
const TMP = "/tmp/opencode/rukeys-test"
mkdirSync(TMP, { recursive: true })

let src = readFileSync(SRC, "utf8")
src = src.replace(
  'import { Plugin } from "@opencode/plugin/tui"',
  "const Plugin = { define: (x: unknown) => x }",
)
if (src.includes("@opencode/plugin/tui")) throw new Error("import stub failed")
writeFileSync(`${TMP}/plugin.ts`, src)

const { default: plugin } = await import(`${TMP}/plugin.ts`)

// --- fake renderer surface ---
const pushes: string[] = []
const fakeStdin = {
  ls: [] as ((c: unknown) => void)[],
  on(ev: string, l: (c: unknown) => void) {
    if (ev === "data") this.ls.push(l)
    return this
  },
  removeListener(ev: string, l: (c: unknown) => void) {
    this.ls = this.ls.filter((x) => x !== l)
    return this
  },
  listeners(ev: string) {
    return ev === "data" ? [...this.ls] : []
  },
  emitData(buf: Buffer) {
    // Real streams hand the SAME chunk to every listener, in order.
    for (const l of this.ls) l(buf)
  },
}
// Simulate the renderer's parser listener attached before plugin setup.
fakeStdin.on("data", () => {})
const rendererListener = fakeStdin.ls[0]

const fakeRenderer = {
  handlers: [] as ((seq: string) => boolean)[],
  prependInputHandler(h: (seq: string) => boolean) {
    this.handlers.unshift(h)
  },
  removeInputHandler(h: (seq: string) => boolean) {
    this.handlers = this.handlers.filter((x) => x !== h)
  },
  stdinParser: {
    push(b: Buffer) {
      pushes.push(b.toString("latin1"))
    },
  },
  drainStdinParser() {},
  stdin: fakeStdin,
}

const cleanup = plugin.setup({ renderer: fakeRenderer })
const handle = (seq: string): boolean => fakeRenderer.handlers[0](seq)

let failed = 0
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) console.log(`ok   ${name}`)
  else {
    failed++
    console.log(`FAIL ${name} ${detail}`)
  }
}
const lastPush = () => pushes[pushes.length - 1]

// 1. Shadow registered ahead of the renderer's listener.
check(
  "shadow listener ahead of renderer listener",
  fakeStdin.ls[0] !== rendererListener && fakeStdin.ls[1] === rendererListener,
  JSON.stringify(fakeStdin.ls.length),
)

// 2. Plain keys untouched.
check("plain char passes", handle("a") === false)
check("CR passes", handle("\r") === false)

// 3. Arrows / CSI / SS3 pass with no scan cost and no replay.
fakeStdin.emitData(Buffer.from("\x1b[A\x1b[B\x1b[1;2C"))
pushes.length = 0
check("arrow up passes", handle("\x1b[A") === false)
check("arrow down passes", handle("\x1b[B") === false)
check("shift+arrow passes", handle("\x1b[1;2C") === false)
check("SS3 F1 passes", handle("\x1bOP") === false)
check("DA response passes", handle("\x1b[?1;2c") === false)
check("no replays for control seqs", pushes.length === 0, JSON.stringify(pushes))

// 4. Kitty CSI-u alt+Cyrillic translated directly (no wire needed).
pushes.length = 0
check("kitty alt+д consumed", handle("\x1b[1076;3u") === true)
check("kitty alt+д -> alt+l", lastPush() === "\x1b[108;3u", JSON.stringify(lastPush()))

// 5. Legacy alt+Cyrillic: wire has ESC+d0+b4, event is mangled ESC+'4'.
pushes.length = 0
fakeStdin.emitData(Buffer.from([0x1b, 0xd0, 0xb4])) // alt+д
check("legacy alt+д consumed", handle("\x1b4") === true)
check("legacy alt+д -> alt+l", lastPush() === "\x1bl", JSON.stringify(lastPush()))

// 6. Partner event swallowed.
check("ESC+FFFD partner swallowed", handle("\x1b\ufffd") === false)

// 7. Escape key passes; lone ESC wire byte pairs with the next press.
check("Escape passes", handle("\x1b") === false)
fakeStdin.emitData(Buffer.from([0x1b])) // Escape press on the wire
fakeStdin.emitData(Buffer.from([0x1b, 0xd0, 0xb4])) // then alt+д
pushes.length = 0
check("ESC then alt+д", handle("\x1b4") === true && lastPush() === "\x1bl", JSON.stringify(lastPush()))

// 8. Batched presses keep FIFO order (two Cyrillic in one chunk).
fakeStdin.emitData(Buffer.from([0x1b, 0xd0, 0xb4, 0x1b, 0xd0, 0xbb])) // alt+д alt+л
pushes.length = 0
check("batched 1st", handle("\x1b4") === true && lastPush() === "\x1bl")
check("batched 2nd", handle("\x1b;") === true && lastPush() === "\x1bk", JSON.stringify(lastPush()))

// 9. UTF-8 split across chunks still pairs.
fakeStdin.emitData(Buffer.from([0x1b, 0xd0]))
fakeStdin.emitData(Buffer.from([0xbb]))
pushes.length = 0
check("split UTF-8 alt+л", handle("\x1b;") === true && lastPush() === "\x1bk", JSON.stringify(lastPush()))

// 10. Arrow flood between Cyrillic presses: junk skipped, still aligned.
for (let i = 0; i < 200; i++) fakeStdin.emitData(Buffer.from("\x1b[B"))
fakeStdin.emitData(Buffer.from([0x1b, 0xd0, 0xbe])) // alt+о (mangles to ESC+'>')
pushes.length = 0
check("after arrow flood", handle("\x1b>") === true && lastPush() === "\x1bj", JSON.stringify(lastPush()))

// 11. Real alt+ASCII flows through natively (no Cyrillic pending).
pushes.length = 0
fakeStdin.emitData(Buffer.from([0x1b, 0x78])) // alt+x
check("real alt+x passes", handle("\x1bx") === false && pushes.length === 0)

// 12. Hard cap keeps memory bounded under flood with a pending partial.
fakeStdin.emitData(Buffer.from([0x1b, 0xd0])) // pending partial (will be capped away)
for (let i = 0; i < 4000; i++) fakeStdin.emitData(Buffer.from("\x1b[B\x1b[B\x1b[B\x1b[B"))
fakeStdin.emitData(Buffer.from([0x1b, 0xd1, 0x80])) // alt+р (mangles to ESC+'@')
pushes.length = 0
check("post-cap alt+р", handle("\x1b@") === true && lastPush() === "\x1bh", JSON.stringify(lastPush()))

// 13. Cleanup removes listeners and handler.
check("ours + renderer registered", fakeStdin.ls.length === 2, JSON.stringify(fakeStdin.ls.length))
cleanup()
check("cleanup removed stdin listener", fakeStdin.ls.length === 1 && fakeStdin.ls[0] === rendererListener)
check("cleanup removed input handler", fakeRenderer.handlers.length === 0)

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
