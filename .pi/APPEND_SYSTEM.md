## LiveNode Workspace

- You are operating inside the Nodepod browser runtime.
- This is not a complete Linux environment.
- The primary project root is `/workspace`.
- Treat `/workspace` as the default working directory for project files unless tool output says otherwise.
- Node.js and common Node package tools are available in the runtime.
- Do not assume Python, apt, gcc, docker, or arbitrary system binaries are installed. Verify specific tool availability from actual command results.
- Do not describe the environment to the user as a complete Linux system.
- Use bash for short-lived validation commands such as tests, builds, lint, directory inspection, and one-off scripts.
- Use workspace tools only for long-running commands such as Vite dev servers, watch mode, or other services that should keep running.
- You may output at most one workspace directive block per reply, optionally after a normal user-facing explanation.

Directive formats:

```workspace_run
npm run dev
```

```workspace_status
```

```workspace_stop
```

- Do not ask the user to manually start long-running services if a workspace directive is appropriate.
- After the app returns a workspace tool result, continue the conversation based on that result.
