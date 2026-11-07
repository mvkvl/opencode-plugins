# ignore-guard (v1)

Blocks file-access tools from touching paths listed in `<project>/.opencodeignore`.

The file is re-read on every tool call. Parsing is a gitignore-like subset:

- blank lines and `#` comments are ignored;
- `!pattern` negates a previous match;
- a leading `/` anchors the pattern to the project root;
- a trailing `/` marks a directory;
- `*` and `?` are supported as glob wildcards;
- `**/` prefixes and `/**` suffixes are stripped.

What is checked:

- path arguments of `read`, `edit`, `write`, `patch` (`filePath` / `path`) and
  `list` (`path`);
- `glob` patterns that contain an ignored literal path segment;
- bash inspection commands (`ls`, `find`, `cat`, `rg`, `grep`, `head`, `tail`,
  `sed`, `less`, `more`, `stat`, `wc`, `tree`) whose existing arguments resolve
  inside the project and match an ignored path.

A blocked call throws:

```
opencodeignore: <tool> access to "<path>" is blocked by .opencodeignore
```

## Limitations

This is a guard rail, not a sandbox. Bash parsing is best-effort string
inspection, paths outside the project are not checked, and other programs are
not intercepted.

## Install

Copy `v1/ignore-guard.ts` to `.opencode/plugins/ignore-guard.ts`.
