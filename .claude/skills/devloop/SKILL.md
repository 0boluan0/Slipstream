---
name: devloop
description: Three-agent development loop — Planner, Builder, Judge cycle until the app works. Use when asked to build an app from scratch, implement a feature, or develop software iteratively.
---

# DevLoop — Three-Agent Development Loop

Plan → Build → Judge → loop until PASS.

## Usage

When user says `/devloop "build a macOS countdown app"`:

1. Confirm requirements briefly (1-2 exchanges max)
2. Launch workflow:
   ```
   Workflow({ scriptPath: ".claude/skills/devloop/devloop.workflow.mjs", args: { requirements: "..." } })
   ```
3. Report results when workflow completes

## The Three Agents

| Role | Responsibility |
|------|---------------|
| **Planner** | Read project state. Break work into small verifiable steps. Each step: exact files, acceptance criteria, build command |
| **Builder** | Implement exactly ONE step. Write code → compile → run → screenshot. Report honestly |
| **Judge** | Review diff + screenshot (or CLI output). Compare to acceptance criteria. PASS or FAIL with specific feedback |

On FAIL: Judge feedback goes directly to Planner for next iteration.

## Key Principles

1. **Small steps** — 1-2 files per iteration, one verifiable feature
2. **Must see it running** — screenshot for GUI apps, output for CLI
3. **Builder is strict** — implement exactly what Planner specified, no extras
4. **FAIL is data** — each failure teaches the next Planner iteration

## Termination

- All planned steps get PASS → success
- Hit maxIterations (default 20) → report progress
- Planner declares requirements met → stop

## Files

```
.claude/skills/devloop/
  SKILL.md                  ← this file
  devloop.workflow.mjs      ← the three-agent loop script
```
