import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "session-cycle",
  setup(context) {
    const listSessions = () =>
      context.data.session
        .list()
        .filter((session) => session.parentID === undefined)
        .toSorted((a, b) => b.time.updated - a.time.updated)

    const cycle = (dir: -1 | 1) => {
      const sessions = listSessions()
      if (sessions.length === 0) return

      const route = context.ui.router.current()
      const currentID = route.type === "session" ? route.sessionID : undefined
      const index = currentID ? sessions.findIndex((session) => session.id === currentID) : -1
      const next = index === -1 ? sessions[0] : sessions[(index + dir + sessions.length) % sessions.length]

      context.ui.router.navigate({ type: "session", sessionID: next.id })
    }

    const cycleTab = (dir: -1 | 1) => {
      const tabs = context.ui.tabs.list()
      if (tabs.length === 0) return cycle(dir)

      const index = tabs.findIndex((tab) => tab.active)
      const next = tabs[(index + dir + tabs.length) % tabs.length]
      context.ui.tabs.focus(next.sessionID)
    }

    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      commands: [
        {
          id: "plugin.session.tab.previous",
          title: "Previous session tab",
          group: "Plugin",
          bind: "alt+left",
          palette: true,
          run: () => cycleTab(-1),
        },
        {
          id: "plugin.session.tab.next",
          title: "Next session tab",
          group: "Plugin",
          bind: "alt+right",
          palette: true,
          run: () => cycleTab(1),
        },
        {
          id: "plugin.session.tab.close",
          title: "Close session tab",
          group: "Plugin",
          bind: "alt+w",
          palette: true,
          run: () => context.ui.tabs.close(),
        },
        {
          id: "plugin.session.new",
          title: "New session tab",
          group: "Plugin",
          bind: "alt+n",
          palette: true,
          run: async () => {
            const location = context.location ?? context.data.location.default()
            const session = await context.client.session.create({
              location: { directory: location.directory },
            })
            context.ui.router.navigate({ type: "session", sessionID: session.id })
          },
        },
        {
          id: "plugin.agent.cycle",
          title: "Next agent",
          group: "Plugin",
          bind: "tab",
          palette: true,
          run: () => context.keymap.dispatch("agent.cycle"),
        },
        {
          id: "plugin.session.cycle.newer",
          title: "Switch to newer session",
          group: "Plugin",
          bind: "alt+up",
          palette: true,
          run: () => cycle(-1),
        },
        {
          id: "plugin.session.cycle.older",
          title: "Switch to older session",
          group: "Plugin",
          bind: "alt+down",
          palette: true,
          run: () => cycle(1),
        },
      ],
    }))
  },
})
