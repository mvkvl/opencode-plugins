import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const bindings = [{ key: "<leader>v", cmd: "theme.toggle.mode" }]

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "theme.toggle.mode",
        title: "Toggle light/dark mode",
        category: "Plugin",
        namespace: "palette",
        run: () => {
          api.keymap.dispatchCommand("theme.switch_mode")
        },
      },
    ],
    bindings,
  })
}

const plugin: TuiPluginModule = {
  id: "theme-toggle",
  tui,
}

export default plugin