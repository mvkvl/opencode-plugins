import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const bindings = [
  { key: "<leader>left", cmd: "session.cycle.newer" },
  { key: "<leader>right", cmd: "session.cycle.older" },
]

const tui: TuiPlugin = async (api) => {
  const readPinnedIds = (): string[] => {
    try {
      const stateDir = api.state.path.state
      if (!stateDir) return []
      const content = readFileSync(join(stateDir, "session.json"), "utf8")
      const parsed = JSON.parse(content) as { pinned?: unknown }
      if (Array.isArray(parsed.pinned)) {
        return parsed.pinned.filter((id): id is string => typeof id === "string")
      }
      return []
    } catch {
      return []
    }
  }

  const listSessions = async () => {
    const result = await api.client.session.list({ roots: true, limit: 100, scope: "project" })
    const sessions = (result.data ?? []).filter((session) => session.parentID === undefined)

    const pinnedIds = readPinnedIds()

    const pinnedSet = new Set(pinnedIds)
    const pinnedSessions = pinnedIds
      .map((id) => sessions.find((s) => s.id === id))
      .filter((s): s is (typeof sessions)[0] => s !== undefined)

    const unpinnedSessions = sessions
      .filter((s) => !pinnedSet.has(s.id))
      .toSorted((a, b) => b.time.updated - a.time.updated)

    return [...pinnedSessions, ...unpinnedSessions]
  }

  const cycle = async (dir: -1 | 1) => {
    const sessions = await listSessions()
    if (sessions.length === 0) return

    const route = api.route.current
    const currentID = route.name === "session" ? route.params.sessionID : undefined
    const index = currentID ? sessions.findIndex((session) => session.id === currentID) : -1
    const next = index === -1 ? sessions[0] : sessions[(index + dir + sessions.length) % sessions.length]

    api.route.navigate("session", { sessionID: next.id })
  }

  api.keymap.registerLayer({
    commands: [
      {
        name: "session.cycle.newer",
        title: "Switch to newer session",
        category: "Plugin",
        namespace: "palette",
        run: () => cycle(-1),
      },
      {
        name: "session.cycle.older",
        title: "Switch to older session",
        category: "Plugin",
        namespace: "palette",
        run: () => cycle(1),
      },
    ],
    bindings,
  })
}

const plugin: TuiPluginModule = {
  id: "session-cycle",
  tui,
}

export default plugin