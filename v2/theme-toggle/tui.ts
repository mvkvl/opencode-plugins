import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "theme-toggle",
  setup(context) {
    context.keymap.layer(() => ({
      commands: [
        {
          id: "theme.toggle.mode",
          title: "Toggle light/dark mode",
          group: "Plugin",
          bind: "alt+v",
          palette: true,
          run: () => context.keymap.dispatch("theme.switch_mode"),
        },
        {
          id: "theme.switch.list",
          title: "Switch theme (list)",
          group: "Plugin",
          bind: "alt+t",
          palette: true,
          run: () => context.keymap.dispatch("theme.switch"),
        },
      ],
    }))
  },
})
