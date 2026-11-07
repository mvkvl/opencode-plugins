import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "location-sync",
  setup(context) {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const ref = () => context.location ?? context.data.location.default()
    const models = () => context.data.location.model.list(ref()) ?? []

    const ensure = async () => {
      if (stopped) return
      if (models().length > 0) {
        stopped = true
        return
      }

      try {
        await context.data.location.sync(context.location)
      } catch {}

      if (stopped) return
      if (models().length > 0) {
        stopped = true
        return
      }

      attempts += 1
      if (attempts >= 7) return
      timer = setTimeout(ensure, Math.min(1000 * 2 ** attempts, 30000))
    }

    timer = setTimeout(ensure, 1000)

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "plugin.location.resync",
          title: "Reload models",
          group: "Plugin",
          palette: true,
          run: async () => {
            await context.data.location.sync(context.location)
          },
        },
      ],
    }))

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  },
})
