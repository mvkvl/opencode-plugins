import { Plugin } from "@opencode/plugin/tui"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

/** Snapshot of a pinned session (title cached in case the session is not loaded). */
type PinItem = { id: string; title: string }

/** Session row as returned by the API / session data hub. */
type SessionRow = {
  id: string
  title?: string
  parentID?: string
  projectID?: string
  time?: { updated?: string | number; archived?: string | number }
  location?: { directory?: string; subpath?: string }
}

type SelectOption = {
  title: string
  value: string
  category?: string
  description?: string
  gutter?: (color?: unknown) => unknown
}

/** Session time.updated may arrive as epoch ms (number) or ISO string. */
const updatedMs = (row?: SessionRow): number => {
  const t = row?.time?.updated as unknown
  if (typeof t === "number") return t
  if (typeof t === "string" && t.length > 0) {
    const v = Date.parse(t)
    return Number.isNaN(v) ? 0 : v
  }
  return 0
}

const dateCategory = (iso?: string | number): string => {
  if (iso === undefined || iso === null || iso === "") return "Older"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "Older"
  const today = new Date()
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  const diffDays = Math.round(
    (new Date(day(today)).getTime() - new Date(day(d)).getTime()) / 86_400_000,
  )
  if (diffDays <= 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(d)
}

export default Plugin.define({
  id: "pins",
  setup(context) {
    // Pinned sessions, persisted; array order == display order.
    const [pins, updatePins] = context.storage.store<{ items: PinItem[] }>("pins", {
      initial: { items: [] },
    })
    // Snapshot of the recent sessions for the open list (memory only, refreshed on open).
    const [snap, updateSnap] = context.storage.memory<{ rows: SessionRow[] }>("sessions", {
      initial: { rows: [] },
    })
    const [meta, updateMeta] = context.storage.store<{ introShown: boolean }>("meta", {
      initial: { introShown: false },
    })

    // Pins are mirrored to <project>/.opencode/session/pins/pins.json — that
    // directory survives sandbox/host restarts (unlike opencode's state dir).
    const pinFile = (() => {
      try {
        const projectDir = context.location?.directory
        if (typeof projectDir === "string" && projectDir.length > 0) {
          return path.join(projectDir, ".opencode", "session", "pins", "pins.json")
        }
        // Fallback: relative to the plugin file (.opencode/plugins/pins).
        return path.join(import.meta.dir, "..", "..", "session", "pins", "pins.json")
      } catch {
        return undefined
      }
    })()

    const loadPinsFromFile = () => {
      if (!pinFile) return
      try {
        const raw = JSON.parse(readFileSync(pinFile, "utf8")) as { items?: PinItem[] }
        const items = Array.isArray(raw.items)
          ? raw.items.filter((p) => p && typeof p.id === "string")
          : []
        if (items.length > 0) {
          void updatePins((draft) => {
            draft.items = items
          })
        }
      } catch {}
    }

    /** Update pins via reactive storage, then mirror the result to the file. */
    const persistPins = async (mutate: (draft: { items: PinItem[] }) => void) => {
      await updatePins(mutate)
      if (!pinFile) return
      try {
        mkdirSync(path.dirname(pinFile), { recursive: true })
        writeFileSync(pinFile, JSON.stringify({ items: pins.items }, null, 2))
      } catch {}
    }

    loadPinsFromFile()

    const currentSessionID = (): string | undefined => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    const rowTitle = (row?: SessionRow): string => {
      const t = row?.title?.trim()
      return t && t.length > 0 ? t : "(без названия)"
    }

    const projectIDForLocation = (): string | undefined => {
      const location = context.location ?? context.data.location.default()
      if (!location?.directory) return undefined
      const data = context.data as unknown as {
        location: {
          info?: (l?: unknown) => { project?: { id?: string } } | undefined
        }
      }
      try {
        const info = data.location.info?.()
        if (info?.project?.id) return info.project.id
      } catch {}
      try {
        const info = data.location.info?.(location)
        if (info?.project?.id) return info.project.id
      } catch {}
      return undefined
    }

    const fetchSessions = async (): Promise<SessionRow[]> => {
      const projectID = projectIDForLocation()
      try {
        const res: unknown = await context.client.session.list(
          projectID
            ? { project: projectID, limit: 200, order: "desc", parentID: null, archived: false }
            : { limit: 200, order: "desc", parentID: null, archived: false },
        )
        const rows = Array.isArray(res)
          ? (res as SessionRow[])
          : ((res as { data?: SessionRow[] }).data ?? [])
        if (Array.isArray(rows) && rows.length >= 0) return rows
      } catch {}
      return (context.data.session.list() as SessionRow[]) ?? []
    }

    const refreshSnapshot = async () => {
      const rows = await fetchSessions()
      await updateSnap((draft) => {
        draft.rows = rows.filter(
          (s) => !s.parentID && !s.time?.archived && s.time?.updated,
        )
      })
    }

    const isPinned = (id: string): boolean => pins.items.some((p) => p.id === id)

    // Running = the session itself or any of its sub-agents is active.
    const isRunning = (id: string): boolean => {
      try {
        if (context.data.session.status(id) === "running") return true
        const family = context.data.session.family(id) as unknown
        if (Array.isArray(family)) {
          return family.some(
            (sid) => context.data.session.status(sid as string) === "running",
          )
        }
      } catch {}
      return false
    }

    const togglePin = (id: string) => {
      const already = isPinned(id)
      if (already) {
        void persistPins((draft) => {
          draft.items = draft.items.filter((p) => p.id !== id)
        })
        context.ui.toast.show({ message: "Unpinned", variant: "info" })
        return
      }
      const row = snap.rows.find((s) => s.id === id)
      const title = rowTitle(row ?? (context.data.session.get(id) as SessionRow | undefined))
      void persistPins((draft) => {
        draft.items = [...draft.items, { id, title }]
      })
      context.ui.toast.show({ message: `Pinned: ${title}`, variant: "success" })
    }

    const movePin = (id: string, dir: -1 | 1) => {
      if (!isPinned(id)) {
        context.ui.toast.show({
          message: "Сессия не закреплена — сначала alt+p",
          variant: "info",
        })
        return
      }
      void persistPins((draft) => {
        const items = [...draft.items]
        const i = items.findIndex((p) => p.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= items.length) return
        ;[items[i], items[j]] = [items[j], items[i]]
        draft.items = items
      })
    }

    const buildOptions = (): SelectOption[] => {
      const byId = new Map(snap.rows.map((s) => [s.id, s]))
      const current = currentSessionID()
      const pinnedOptions = pins.items.map((p) => ({
        title: byId.get(p.id) ? rowTitle(byId.get(p.id)) : p.title,
        value: p.id,
        category: "Pinned",
        // Gutter priority: running spinner > current dot (drawn when no gutter)
        // > pinned checkmark.
        gutter: isRunning(p.id)
          ? (color?: unknown) => <spinner color={color} />
          : p.id === current
            ? undefined
            : (color?: unknown) => <text fg={color}>✓</text>,
      }))
      const pinnedIDs = new Set(pins.items.map((p) => p.id))
      const rest = snap.rows
        .filter((s) => !pinnedIDs.has(s.id))
        .toSorted((a, b) => updatedMs(b) - updatedMs(a))
        .map((s) => ({
          title: rowTitle(s),
          value: s.id,
          category: dateCategory(s.time?.updated),
          // Running non-pinned session shows a spinner in the gutter column.
          gutter: isRunning(s.id) ? (color?: unknown) => <spinner color={color} /> : undefined,
        }))
      return [...pinnedOptions, ...rest]
    }

    const renameSession = (id: string) => {
      void (async () => {
        const current = rowTitle(
          snap.rows.find((s) => s.id === id) ??
            (context.data.session.get(id) as SessionRow | undefined),
        )
        const next = await context.ui.dialog.prompt({
          title: "Rename session",
          value: current,
          placeholder: "Session title",
        })
        const title = typeof next === "string" ? next.trim() : ""
        if (!title || title === current) {
          openList()
          return
        }
        await context.client.session.update({ sessionID: id, title })
        await persistPins((draft) => {
          const pin = draft.items.find((p) => p.id === id)
          if (pin) pin.title = title
        })
        await refreshSnapshot()
        context.ui.toast.show({ message: `Renamed: ${title}`, variant: "success" })
        openList()
      })().catch(() => {
        context.ui.toast.show({ message: "Rename failed", variant: "error" })
        openList()
      })
    }

    const deleteSession = (id: string) => {
      void (async () => {
        const title = rowTitle(
          snap.rows.find((s) => s.id === id) ??
            (context.data.session.get(id) as SessionRow | undefined),
        )
        const ok = await context.ui.dialog.confirm({
          title: "Delete session?",
          message: `Delete "${title}"?`,
          label: { confirm: "Delete", cancel: "Cancel" },
        })
        if (!ok) {
          openList()
          return
        }
        await context.client.session.remove({ sessionID: id })
        await persistPins((draft) => {
          draft.items = draft.items.filter((p) => p.id !== id)
        })
        await refreshSnapshot()
        context.ui.toast.show({ message: "Session deleted", variant: "info" })
        openList()
      })().catch(() => {
        context.ui.toast.show({ message: "Delete failed", variant: "error" })
        openList()
      })
    }

    const openList = () => {
      void refreshSnapshot()
      const opened = context.ui.dialog
        .select({
          title: "Sessions",
          placeholder: "Search sessions",
          get current() {
            return currentSessionID()
          },
          get options() {
            return buildOptions()
          },
          search: (query, options) => {
            const q = query.trim().toLowerCase()
            if (!q) return options
            return options.filter((o) => o.title.toLowerCase().includes(q))
          },
          actions: [
            {
              bind: "alt+p",
              title: "pin/unpin",
              onTrigger: (value) => {
                if (typeof value === "string") togglePin(value)
              },
            },
            {
              bind: "alt+j",
              title: "move up",
              onTrigger: (value) => {
                if (typeof value === "string") movePin(value, -1)
              },
            },
            {
              bind: "alt+k",
              title: "move down",
              onTrigger: (value) => {
                if (typeof value === "string") movePin(value, 1)
              },
            },
            {
              bind: "ctrl+r",
              title: "rename",
              onTrigger: (value) => {
                if (typeof value === "string") renameSession(value)
              },
            },
            {
              bind: "ctrl+d",
              title: "delete",
              onTrigger: (value) => {
                if (typeof value === "string") deleteSession(value)
              },
            },
          ],
        }) as Promise<string | undefined>
      // select() resets the dialog size to "medium" on show; widen it afterwards.
      context.ui.dialog.set({ size: "xlarge" })
      // The runtime wrapper resolves the promise with the selected value on Enter
      // (its own onSelect replaces any prop) and clears the dialog itself.
      return opened.then((id) => {
        if (typeof id === "string" && id.length > 0) {
          const focused = context.ui.tabs.focus(id)
          if (!focused) context.ui.router.navigate({ type: "session", sessionID: id })
        }
        void updateMeta((draft) => {
          draft.introShown = true
        })
      })
    }

    const toggleCurrent = () => {
      const id = currentSessionID()
      if (!id) {
        context.ui.toast.show({ message: "Нет активной сессии", variant: "info" })
        return
      }
      if (!isPinned(id) && !snap.rows.find((s) => s.id === id)) {
        void refreshSnapshot().then(() => togglePin(id))
        return
      }
      togglePin(id)
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "plugin.pins.list",
          title: "Sessions: pinned list",
          group: "Plugin",
          bind: "alt+l",
          palette: true,
          slash: { name: "pins" },
          run: openList,
        },
        {
          id: "plugin.pins.toggle",
          title: "Pin/unpin session",
          group: "Plugin",
          bind: "alt+p",
          palette: true,
          slash: { name: "pin" },
          run: toggleCurrent,
        },
      ],
      bindings: ["plugin.pins.list", "plugin.pins.toggle"],
    }))

    const stopDeleted = context.data.on("session.deleted", (event) => {
      const id = event.data.sessionID
      void persistPins((draft) => {
        if (draft.items.some((p) => p.id === id)) {
          draft.items = draft.items.filter((p) => p.id !== id)
        }
      })
    })

    // Hint in the home footer, next to the built-in status items.
    // Built-in pattern ("ctrl+p commands"): key text inherits the text's
    // fg (theme.text.base), label span gets its color via style.fg.
    context.ui.slot({
      append: "home.footer.status",
      render: () => (
        <text fg={context.theme.text.base}>
          alt+l<span style={{ fg: context.theme.text.muted }}> sessions</span>
        </text>
      ),
    })

    if (!meta.introShown) {
      context.ui.toast.show({
        title: "pins",
        message: "alt+l — список сессий, alt+p — пин/анпин",
        variant: "info",
        duration: 6000,
      })
      void updateMeta((draft) => {
        draft.introShown = true
      })
    }

    return () => stopDeleted()
  },
})
