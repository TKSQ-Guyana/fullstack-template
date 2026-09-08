# Handover

A DATED, APPEND-ONLY session log. Each work session appends a section at the
top; nothing above the line is rewritten. The point: any person (or AI
session) can pick the project up from this file alone.

Keep three standing sections current at the very top, then the dated log:

## Where things stand

<One paragraph per active workstream: what is DONE (with the commit/PR),
what is IN FLIGHT, what is BLOCKED and on whom.>

## How to verify (the recipe every landed step used)

<The exact commands and clicks that prove the current state works — the cold
start, the sign-in, the screens to open, the data to expect.>

## Prompt to continue in a fresh session

<A self-contained paragraph a fresh AI session can be given verbatim: the
task, the constraints, where the truth lives, what not to touch.>

---

## <YYYY-MM-DD> — <what this session did>

- <changes, with commits>
- <decisions made, and why>
- <anything left deliberately undone>
