# nyc playground scaffold — design

**Date:** 2026-07-03
**Status:** Approved

## Purpose

A React experiment/playground. Content doesn't matter yet; the goal is a
ready-to-use sandbox with a modern component toolkit.

## Stack

- Next.js (App Router) via `create-next-app` — TypeScript, ESLint, Tailwind
  CSS v4, `src/` directory, `@/*` import alias
- shadcn/ui initialized with the radix base and Nova preset (Lucide / Geist)
- Starter components: button, card, input, dialog, dropdown-menu

## Layout

- Repo: `git@github.com:MarkD0yle/nyc.git`, cloned to
  `~/Documents/dev/nyc`
- Home page (`src/app/page.tsx`) renders a card with the starter components
  as a smoke test

## Out of scope

No routing structure, testing, or architecture beyond the scaffold — it's a
sandbox and will evolve as experiments demand.
