import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

const IGNORE_FILE = ".opencodeignore"

interface Rule {
  pattern: string
  negated: boolean
  anchored: boolean
  hasGlob: boolean
}

function parseIgnore(content: string): Rule[] {
  const rules: Rule[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    let negated = false
    if (line.startsWith("!")) {
      negated = true
      line = line.slice(1).trim()
    }

    let anchored = false
    if (line.startsWith("/")) {
      anchored = true
      line = line.slice(1)
    }

    if (line.endsWith("/")) line = line.slice(0, -1)
    line = line.replace(/^\*\*\/+/, "").replace(/\/\*\*$/, "")
    if (!line) continue

    rules.push({ pattern: line, negated, anchored, hasGlob: /[*?]/.test(line) })
  }
  return rules
}

function globMatch(input: string, pattern: string): boolean {
  let p = 0
  let s = 0
  let starP = -1
  let starS = 0
  while (s < input.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === input[s])) {
      p++
      s++
    } else if (p < pattern.length && pattern[p] === "*") {
      starP = p
      p++
      starS = s
    } else if (starP >= 0) {
      s = ++starS
      p = starP + 1
    } else {
      return false
    }
  }
  while (p < pattern.length && pattern[p] === "*") p++
  return p === pattern.length
}

function matchesRule(rel: string, rule: Rule): boolean {
  if (rule.hasGlob) return globMatch(rel, rule.pattern)
  if (rule.pattern.includes("/")) return rel === rule.pattern || rel.startsWith(rule.pattern + "/")
  if (rule.anchored) return rel === rule.pattern || rel.startsWith(rule.pattern + "/")
  return rel === rule.pattern || rel.split("/").includes(rule.pattern)
}

function isIgnored(rel: string, rules: Rule[]): boolean {
  let ignored = false
  for (const rule of rules) {
    if (matchesRule(rel, rule)) ignored = !rule.negated
  }
  return ignored
}

function toRelative(root: string, abs: string): string | null {
  const rel = path.relative(path.resolve(root), path.resolve(abs))
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join("/")
}

const PATH_ARG_TOOLS: Record<string, string[]> = {
  read: ["filePath", "path"],
  edit: ["filePath", "path"],
  write: ["filePath", "path"],
  patch: ["filePath", "path"],
  list: ["path"],
}

const BASH_INSPECT = new Set([
  "ls",
  "find",
  "cat",
  "rg",
  "grep",
  "head",
  "tail",
  "sed",
  "less",
  "more",
  "stat",
  "wc",
  "tree",
])

function bashTokens(command: string): string[] {
  return command.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g) ?? []
}

function stripQuotes(token: string): string {
  if (
    token.length >= 2 &&
    ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")))
  ) {
    return token.slice(1, -1)
  }
  return token
}

function bashBlocked(command: string, root: string, rules: Rule[]): string | null {
  const tokens = bashTokens(command)
  for (let i = 0; i < tokens.length; i++) {
    const keyword = stripQuotes(tokens[i]).toLowerCase()
    if (!BASH_INSPECT.has(keyword)) continue
    const patternFirst = keyword === "grep" || keyword === "rg"
    let positional = 0
    for (let j = i + 1; j < tokens.length; j++) {
      const raw = tokens[j]
      if (/^[|&;<>()[\]{}]$/.test(raw)) break
      const token = stripQuotes(raw)
      if (!token || token.startsWith("-") || /^[~$]|^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue
      if (patternFirst) {
        positional++
        if (positional === 1) continue
      }
      const abs = path.resolve(root, token)
      let exists = false
      try {
        statSync(abs)
        exists = true
      } catch {
        exists = false
      }
      if (!exists) continue
      const rel = toRelative(root, abs)
      if (rel === null) continue
      if (isIgnored(rel, rules)) return rel
    }
  }
  return null
}

export const IgnoreGuard: Plugin = async ({ directory }) => {
  const root = directory ?? process.cwd()

  const loadRules = (): Rule[] => {
    try {
      return parseIgnore(readFileSync(path.join(root, IGNORE_FILE), "utf8"))
    } catch {
      return []
    }
  }

  const deny = (tool: string, target: string) => {
    throw new Error(`opencodeignore: ${tool} access to "${target}" is blocked by ${IGNORE_FILE}`)
  }

  return {
    "tool.execute.before": async (input, output) => {
      const rules = loadRules()
      if (rules.length === 0) return

      const toolName = input.tool
      const args = output.args as Record<string, unknown>

      const checkPath = (value: unknown): void => {
        if (typeof value !== "string" || value.length === 0) return
        const rel = toRelative(root, path.resolve(root, value))
        if (rel !== null && isIgnored(rel, rules)) deny(toolName, rel)
      }

      const pathArgs = PATH_ARG_TOOLS[toolName]
      if (pathArgs) {
        for (const key of pathArgs) checkPath(args[key])
      }

      if (toolName === "glob" && typeof args.pattern === "string") {
        const segments = args.pattern.split("/").filter(Boolean)
        for (const rule of rules) {
          if (rule.negated || rule.hasGlob || rule.pattern.includes("/")) continue
          if (segments.includes(rule.pattern)) deny(toolName, args.pattern)
        }
      }

      if (toolName === "bash" && typeof args.command === "string") {
        const blocked = bashBlocked(args.command, root, rules)
        if (blocked !== null) deny(toolName, blocked)
      }
    },
  }
}
