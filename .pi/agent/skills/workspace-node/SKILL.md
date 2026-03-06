---
name: workspace-node
description: Use this when a request involves a Node.js project in /workspace and you need to choose between short-lived checks and long-running workspace services.
---

# Workspace Node

Apply this skill for Node.js project tasks inside `/workspace`, such as inspecting files, installing packages, running tests, building, starting a local server, or diagnosing startup failures.

## Core Rules

- Treat `/workspace` as the default project root unless tool output shows a nested app directory.
- This runtime is not a complete Linux machine. Do not assume Python, apt, gcc, docker, or arbitrary system binaries exist.
- For short-lived project commands that should finish and return output quickly, use `bash` and rely on the exact stdout, stderr, and exit code.
- For long-running project commands that keep a service alive, use a workspace directive instead of waiting on bash to exit.
- Read `package.json` or relevant config files before guessing a start command when the project entrypoint is unclear.
- Diagnose project config, missing files, bad scripts, and port conflicts before concluding Node or bash is unavailable.
- Emit at most one workspace directive block per reply.

## Short-Lived Command Examples

- `ls`
- `pwd`
- `cat package.json`
- `npm install`
- `npm test`
- `npm run build`
- `node -v`

## Long-Running Command Examples

- `npm start`
- `npm run dev`
- `vite`
- `next dev`
- `pnpm dev`
- watch mode or any local server that should stay running

## Workspace Directives

Use these exact directive formats for long-running services:

```workspace_run
npm run dev
```

```workspace_status
```

```workspace_stop
```

After the app returns a workspace tool result, continue from that result instead of repeating the same directive immediately.
