# Development Guide — Thatgfsj Code

This document is for contributors / maintainers. End users should read
[`README.md`](./README.md) instead.

---

## 1. Overview

**Thatgfsj Code** is a Claude Code–style interactive AI coding assistant that
runs entirely in your terminal. It is written in TypeScript, published as an
ESM npm package, distributed under MIT, and targets **Node.js ≥ 18**.

The tool exposes:

- A non-interactive single-shot CLI (`gfcode "..."`).
- An interactive REPL (`gfcode` with no args).
- Subcommands: `init`, `explain`, `debug`, `chat`, `template`.

The release pipeline is: **bug fix → docs → smoke test → git commit + tag →
push → GitHub release → `npm publish`**. Everything in `src/` compiles to
`dist/` via `tsc`; the `package.json` `files` whitelist decides what ships
in the npm tarball.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         src/index.ts                          │
│   CLI entry · commander program · subcommand dispatch         │
│   (init / explain / debug / chat / template / default REPL)  │
└─────────────────────────┬────────────────────┬───────────────┘
                          │                    │
              ┌───────────▼──────────┐ ┌───────▼─────────────┐
              │   AI Engine + Tools  │ │      REPL Loop       │
              │ src/core/ai-engine   │ │ src/repl/{loop,...}  │
              │ src/tools/{file,…}   │ │ @inquirer/input      │
              └───────────┬──────────┘ └───────┬─────────────┘
                          │                    │
              ┌───────────▼────────────────────▼───────────────┐
              │        Core / Utils / Agent / MCP              │
              │ src/core/{config,session,types,subagent,…}     │
              │ src/utils/{diff-preview,memory,project-…}     │
              │ src/agent/{core,intent,streaming}             │
              │ src/mcp/client.ts                              │
              └────────────────────────────────────────────────┘
```

### Module responsibilities

| Layer     | Files                                        | Job                                                                |
|-----------|----------------------------------------------|--------------------------------------------------------------------|
| Entry     | `src/index.ts`                               | commander program, subcommand handlers, REPL bootstrap             |
| REPL      | `src/repl/{input,output,loop,welcome}.ts`    | interactive prompt, ANSI output, SIGINT, welcome/init wizard       |
| Core      | `src/core/{ai-engine,config,session,…}.ts`   | AI provider abstraction, config loading, session state            |
| Tools     | `src/tools/{file,shell,git,search}.ts`       | file I/O, shell exec, git ops, code search                         |
| Agent     | `src/agent/{core,intent,streaming}.ts`       | intent classification, agent loop, streamed terminal output        |
| Utils     | `src/utils/{diff-preview,memory,…}.ts`       | side-effect-free helpers                                           |
| MCP       | `src/mcp/client.ts`                          | Model Context Protocol stdio client                                |

### Data flow on a single prompt

```
User ──▶ commander ──▶ executeTask(prompt)
                       │
                       ├─▶ ConfigManager.load()         (process.env + ~/.thatgfsj/config.json)
                       │
                       ├─▶ AIEngine.chatStream(messages) ──▶ provider base URL /v1/chat/completions
                       │                                  or Anthropic /messages
                       │                                  or Gemini :generateContent
                       │
                       └─▶ process.stdout.write(chunks) ──▶ terminal (scrollable history)
```

---

## 3. Build & install

### Prerequisites

- Node.js ≥ 18 (project uses native `fetch`, `AbortController`, top-level `await`,
  `node --test`).
- npm ≥ 9 (so `npm publish` understands the `files` whitelist).
- Git (for the install scripts and during release).

### Local development

```bash
git clone https://github.com/Thatgfsj/thatgfsj-code.git
cd thatgfsj-code
npm install
npm run build           # produces ./dist
npm test                # node --test tests/
npm start               # node dist/index.js (interactive REPL)
npm run dev             # tsc && node dist/index.js

# Optional: link globally so `gfcode` is in your PATH
npm link
```

`npm install` after cloning will trigger `prepublishOnly` if you have it
configured (we do). Always run `npm run build` after editing source so the
`dist/` matches `src/`.

### Platform notes

- **Windows**: `src/index.ts` invokes `chcp 65001` synchronously before any
  output to force UTF-8 in the legacy Windows console. Done via
  `createRequire(import.meta.url)` so it works under `"type": "module"`.
- **Numeric keypad arrows**: the REPL uses `@inquirer/input` instead of Node's
  built-in `readline.question()` because the latter doesn't reliably translate
  numeric-keypad ANSI escape sequences on Windows terminals (Bug #1 history).
- **Streaming output**: `process.stdout.write` directly, never `rl.question`
  inside the loop — the latter would reset the terminal and lose scrollback.

---

## 4. Adding a provider

1. Add the env-var map to `src/core/config.ts` (`envKeys`).
2. Add a `*_MODELS` array to `src/repl/welcome.ts` and wire it through
   `getModelsForProvider()` and `interactiveSetup()` (numbered choice).
3. Update `WelcomeScreen.hasApiKey()` in `src/repl/welcome.ts` to include the
   new env-var name.
4. If the provider uses a non-OpenAI request format, extend the dispatcher
   in `src/core/ai-engine.ts::streamRequest`.
5. Update `docs/API_KEY_GUIDE.md` and `README.md`'s provider list.

No other files should care about the specific provider.

---

## 5. Adding a built-in CLI command

`src/index.ts` is the single `commander` program. Register a new command
**before** `program.parse(process.argv)`:

```ts
program
  .command('foo')
  .description('...')
  .argument('<bar>', '...')
  .action(async (bar) => { /* ... */ });
```

For REPL-internal slash-style commands (visible only inside the interactive
loop), add a new `case` to `src/repl/loop.ts::handleCommand`.

### Built-in REPL commands (current)

| Command          | Behavior                                                                         |
| ---------------- | -------------------------------------------------------------------------------- |
| `help`           | Show built-in command list                                                       |
| `exit` / `quit`  | Leave the REPL                                                                   |
| `clear`          | Clear the screen                                                                 |
| `context`        | Show the current project context                                                 |
| `history`        | Show the command history for this session                                         |
| `tools`          | List registered tools                                                            |
| `models`         | Read-only listing of the current provider's models                               |
| `providers`      | Read-only listing of all providers                                               |
| `/model`         | **Interactive picker — actually switches the active model** for the current provider. Persists to `~/.thatgfsj/config.json` and calls `AIEngine.updateConfig()`. |
| `/provider`      | **Interactive picker — switches provider + chains into `/model`** for the new one. Warns if the corresponding env-var / saved API key is missing. |
| `Ctrl+C`         | Aborts the in-flight stream once, exits after two empty-prompt cancels.          |

Both `/model` and `/provider` accept either a numeric index or the exact
provider/model id; pressing Enter with no input keeps the current value. After
a switch, `REPLLoop` injects a one-line `[system: ... switched to ...]`
message into the session so the LLM can see the change in the next turn.

---

## 6. Adding a tool

Tools implement the `Tool` interface declared in `src/core/types.ts`:

```ts
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute(params: any, ctx: ToolContext): Promise<ToolResult>;
}
```

Steps:
1. Create `src/tools/<name>.ts` exporting a class implementing `Tool`.
2. Register it in `src/tools/index.ts::getBuiltInTools()` so both the REPL
   `REPLLoop.init` and `executeTask` pick it up automatically.

> **Known limitation (0.2.2):** `src/core/ai-engine.ts::extractToolCalls`
> currently returns `undefined`. Tools are registered but never actually
> invoked from a streamed response. Wiring this up requires parsing each
> provider's native `tool_calls` delta and is tracked under "Unreleased" in
> `CHANGELOG.md`. Until then, `ToolRegistry` is a forward-compatible seam.

---

## 7. MCP integration

`src/mcp/client.ts` defines a small stdio MCP client. It spawns a child
process and exchanges JSON-RPC via newline-delimited messages. The current
shape is intentionally minimal — see the file for the protocol mapping.

---

## 8. Cross-platform & UX details

- **Encoding**: Windows-only `chcp 65001` in `src/index.ts:9-15`. Skipped
  silently if it fails.
- **Color**: `chalk` v5 is ESM-only; the project is `"type": "module"` so
  this is fine.
- **Spinner**: `ora` v7 with `dots` spinner; cyan.
- **History**: local to a single REPL session (not persisted across runs).

---

## 9. Tests

```bash
npm test                # runs node --test tests/  (full TAP output)
npm run test:silent     # dot reporter, for noisy CI logs
```

Tests live in `tests/` and use Node's built-in `node:test` runner — no
vitest / jest dev-dep. They cover:

- Smoke tests of the compiled `dist/index.js` binary (`--version`, `--help`,
  subcommand empty-arg guards, `bash -n install.sh`).
- Boundary tests of pure modules (`SessionManager`, `DiffPreview`,
  `REPLOutput`) — empty input, unicode, CRLF, very long input.
- No network. No mocked API keys. No shell-out side-effects other than the
  install script's `bash -n` parse-check.

CI integration: if you set this up later, run `npm test && npm run build`
in the job; the `prepublishOnly` script already chains them.

---

## 10. Release process

1. Edit `package.json` `version` (semver).
2. Add a new section at the top of `CHANGELOG.md`.
3. `npm test && npm run build` locally — make sure both are green.
4. `git add -A && git commit -m "release: vX.Y.Z"`
5. `git tag vX.Y.Z`
6. `git push origin main --follow-tags`
7. `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file CHANGELOG.md`
   (the section for the new version is the top entry; trim if needed).
8. `npm publish --access public` (a `prepublishOnly` step in `package.json`
   re-runs tests + build, so you can't accidentally publish a stale build).

### Semver policy

- **patch** (`Z`): bug fixes, docs, refactors, no public API change.
- **minor** (`Y`): new public command, new provider, new tool.
- **major** (`X`): breaking change to the CLI surface or the JS API surface
  (currently no JS API is stable).

---

## 11. Troubleshooting

### `ReferenceError: require is not defined`

You're editing TypeScript and accidentally called `require(...)` outside of a
`createRequire(import.meta.url)` shim. The project is ESM. Use `import x from 'y'`
at the top of the file.

### `npm publish` ships no `dist/`

You forgot to run `npm run build` (or the `prepublishOnly` script was
removed). The `files` whitelist in `package.json` requires the `dist/`
directory to exist locally when publishing.

### `gfcode --version` shows the wrong number

Edit it in `package.json` only — `src/index.ts` and `src/repl/output.ts` both
read `VERSION` from `package.json` via `import pkg from '../package.json' …`.

### REPL keypresses / Ctrl+C misbehave on Windows

Make sure you're on Windows Terminal or any TTY that emits ANSI escape
sequences natively. The legacy `cmd.exe` console has incomplete ANSI
support — upgrade to Windows Terminal or use PowerShell.
