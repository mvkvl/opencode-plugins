import { Plugin } from "@opencode/plugin"

const INTERVAL_MS = 30_000
const REMINDER_MS = 10 * 60_000
const BACKOFF_BASE_MS = 20_000
const BACKOFF_MAX_MS = 10 * 60_000

type Backoff = {
  attempts: number
  next: number
}

export default Plugin.define({
  id: "mcp-watchdog",
  setup(ctx) {
    const backoff = new Map<string, Backoff>()
    const reminders = new Map<string, number>()
    let running = false

    const log = (level: "info" | "warn" | "error", message: string) => {
      const line = `[mcp-watchdog] ${message}`
      if (level === "error") console.error(line)
      else if (level === "warn") console.warn(line)
      else console.info(line)
    }

    const delayFor = (attempts: number) =>
      Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS)

    const rearm = async (name: string) => {
      await ctx.mcp.transform((editor) => {
        editor.update(name, (server) => {
          server.disabled = true
        })
      })
      await ctx.mcp.reload()
      await ctx.mcp.transform((editor) => {
        editor.update(name, (server) => {
          server.disabled = false
        })
      })
      await ctx.mcp.reload()
    }

    const tick = async () => {
      if (running) return
      running = true
      try {
        const result = await ctx.mcp.list()
        for (const server of result.data ?? []) {
          const name = server.name
          const state = server.status

          if (state.status === "connected") {
            const previous = backoff.get(name)
            if (previous && previous.attempts > 0) {
              log("info", `${name}: подключён, watchdog сброшен`)
            }
            backoff.delete(name)
            reminders.delete(name)
            continue
          }

          if (state.status === "disabled") {
            backoff.delete(name)
            reminders.delete(name)
            continue
          }

          if (state.status === "pending") continue

          if (state.status === "needs_auth") {
            const last = reminders.get(name) ?? 0
            if (Date.now() - last >= REMINDER_MS) {
              log("warn", `${name}: требуется авторизация — выполни \`opencode mcp auth ${name}\``)
              reminders.set(name, Date.now())
            }
            continue
          }

          if (state.status === "failed") {
            const current = backoff.get(name) ?? { attempts: 0, next: 0 }
            if (current.attempts === 0) {
              log("warn", `${name}: ошибка подключения: ${state.error}`)
            }
            if (Date.now() < current.next) continue

            current.attempts += 1
            current.next = Date.now() + delayFor(current.attempts)
            backoff.set(name, current)

            log(
              "warn",
              `${name}: переподключение (попытка ${current.attempts}, следующая через ${Math.round(
                delayFor(current.attempts) / 1000,
              )}s)`,
            )

            try {
              await rearm(name)
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              log("error", `${name}: не удалось переподключить: ${message}`)
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log("error", `не удалось получить статус MCP: ${message}`)
      } finally {
        running = false
      }
    }

    void tick()
    const timer = setInterval(() => {
      void tick()
    }, INTERVAL_MS)

    return () => clearInterval(timer)
  },
})
