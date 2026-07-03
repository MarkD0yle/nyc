# Sim NYC Pass 2 — Synthetic Polling Engine (validated design)

## What this builds

A polling engine that takes a plain-English question, routes it to all 3,000
synthetic NYC personas, and returns geographically-disaggregated opinion data —
distributions by borough, income band, race/ethnicity, and housing status —
surfaced in a Next.js UI with summary pills, a by-borough table, and demographic
breakdown accordions.

## Background (Pass 1 recap)

- **3,000 weighted personas** live in Supabase table `personas` (`id`, `puma`,
  `borough`, `neighborhood`, `card` jsonb). Each `card` has: age, sex,
  race_ethnicity, education, employment, personal_income, household_income,
  household_size, housing, gross_rent, language_at_home, commute, context_notes.
- Schema `personas` / `poll_runs` / `poll_batch_results` exists (migration
  `0001_pass1_schema.sql`); public-read RLS in `0002_rls_public_read.sql`.
- Next.js app (App Router, Next 16.2.10, React 19) scaffolded with shadcn/ui and
  Tailwind v4. No API routes or poll pages yet.

## Key decisions (locked in brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Execution model | **Local/self-hosted, fire-and-forget** | Simplest v1; no Vercel 60s timeout to work around. Route handler returns `poll_id` immediately and continues processing in a detached async loop. |
| Schema enforcement | **Anthropic `tool_use` with a strict JSON schema** | Reliable structured output; schema defined in one place so it can be swapped for `output_config.format` later. |
| Scope | **Full vertical slice** | Setup → API (POST/GET/list) → both UI pages → one verified real poll run. |
| Aggregation | **On-the-fly in the GET handler** | Join batch results × personas in JS; 3,000 rows is trivial. `poll_batch_results` stays the single source of truth. |

### Corrections to the original spec

- **Scale is 55 Claude calls per run** (one per PUMA batch, each returning ~55
  persona answers), **not 3,025**. The cost estimate (~$0.03/run) already assumes
  55 batches; the "3,025 calls" line in the original Model section was wrong.
- Dependencies `@supabase/supabase-js` and `@anthropic-ai/sdk` are **not yet
  installed**, and personas are **not yet loaded** into Supabase — both become
  setup steps.

---

## Architecture

```
POST /api/polls
  → insert poll_run(status='running'), return { poll_id }
  └─ (not awaited) runPoll():
       fetch personas grouped by PUMA (55 groups, ~55 each)
       for each PUMA batch, sequentially:
         Claude call (tool_use) → PersonaAnswer[] → upsert poll_batch_results
       on success → status='complete'; on throw → status='failed'

GET /api/polls/[id]
  → load poll_run + all poll_batch_results for the run
  → join answers to personas.card in memory
  → return { question, status, total_personas, responded, summary, by_borough, by_demographic }

GET /api/polls
  → last 10 poll_runs (id, question, status, created_at)
```

**Batching strategy:** group personas by PUMA. One Claude call per PUMA batch;
each call's system prompt carries that batch's persona cards and returns one JSON
object per persona. Batches run **sequentially** to stay within Anthropic rate
limits (~3 min per full run on Haiku).

**Durability:** fire-and-forget means a process restart mid-run leaves the run at
`status='running'`. Partial results are still readable via GET while running.
Full resume logic is out of scope, but the `UNIQUE(run_id, batch_index)`
constraint (below) makes batch upserts idempotent, so a resume feature can be
added later without schema change.

---

## Module breakdown

Each unit has one purpose, a clear interface, and can be tested independently.

| File | Purpose | Depends on |
|---|---|---|
| `src/lib/supabase/server.ts` | Service-role client for route handlers (writes + full reads) | `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` |
| `src/lib/supabase/browser.ts` | Anon client for client-side read-only reads | `NEXT_PUBLIC_SUPABASE_*` |
| `src/lib/polls/types.ts` | Shared types (`PersonaAnswer`, `PollAggregate`, …) + `incomeBand()` helper | — |
| `src/lib/anthropic.ts` | Anthropic client + `runBatch(question, personas) → PersonaAnswer[]` via `tool_use` | `ANTHROPIC_API_KEY` |
| `src/lib/polls/aggregate.ts` | **Pure function** `(batchResults, personas) → PollAggregate`. Primary unit-test target. | `types.ts` |
| `src/lib/polls/runPoll.ts` | Orchestration: group personas, loop batches, upsert, set status; try/catch → `failed` | server client, `anthropic.ts` |
| `src/app/api/polls/route.ts` | `POST` (create + kick off), `GET` (list last 10) | server client, `runPoll` |
| `src/app/api/polls/[id]/route.ts` | `GET` (aggregate) | server client, `aggregate` |
| `src/app/page.tsx` | Home: question input + recent polls; submit → redirect to `/polls/[id]` | browser client |
| `src/app/polls/[id]/page.tsx` | Results: summary pills, by-borough table, breakdown accordions; polls GET every 2s | browser client |

---

## Data model

### `poll_runs` (exists)

```sql
id uuid primary key
question text not null
status text default 'running'   -- 'running' | 'complete' | 'failed'
created_at timestamptz
```

### `poll_batch_results` (exists)

```sql
id uuid primary key
run_id uuid references poll_runs(id)
puma text not null
batch_index int not null
results jsonb not null            -- PersonaAnswer[]
created_at timestamptz
```

### Migration `0003_pass2_fk_cascade.sql` (new — apply before any Pass 2 data)

Applies the two flags from the Pass 1 review:

1. Drop and re-add `poll_batch_results.run_id` FK with `ON DELETE CASCADE`.
2. Add `UNIQUE(run_id, batch_index)` (enables idempotent upsert / future resume).

### `PersonaAnswer` shape (stored in `results`)

```json
{
  "persona_id": "uuid",
  "answer": "yes" | "no" | "unsure",
  "confidence": 0.0,
  "reasoning": "one sentence, first person"
}
```

**Answer schema is yes/no/unsure only** for Pass 2. Multi-option questions are
out of scope.

### Income bands

`incomeBand(household_income)` buckets into: `<$30k`, `$30–60k`, `$60–100k`,
`$100–150k`, `$150k+`.

---

## Claude prompt design

**Model:** `claude-haiku-4-5-20251001` (fast, cheap, structured output).
`claude-sonnet-4-6` reserved for a future "deep mode" on smaller samples.

**Schema enforcement:** a single `tool_use` tool `record_responses` whose
`input_schema` is an array of `PersonaAnswer` objects (`answer` an enum,
`confidence` a number, `persona_id` + `reasoning` strings), forced via
`tool_choice: { type: "tool", name: "record_responses" }`. The schema lives in
`anthropic.ts` so it can be swapped for `output_config.format` later.

**System prompt (per batch):** the persona-simulation instruction from the
original spec (respond as each person would; no moralizing/hedging; one object
per persona; first-person one-sentence reasoning).

**User message:** `Question: {question}` followed by the batch's persona cards as
a JSON array with `id` fields.

**`max_tokens`:** sized for ~55 objects (≈4000).

### Cost (per full 3,000-persona run)

~44k input + ~11k output tokens across 55 Haiku batches ≈ **~$0.03/run**.

---

## API contracts

### `POST /api/polls`
Request: `{ "question": "Should NYC ban gas stoves in new buildings?" }`
Response: `{ "poll_id": "uuid" }` — processing continues in the background.

### `GET /api/polls/[id]`
```json
{
  "question": "...",
  "status": "running" | "complete" | "failed",
  "total_personas": 3000,
  "responded": 1540,
  "summary": { "yes": 0.47, "no": 0.38, "unsure": 0.15 },
  "by_borough": {
    "Manhattan": { "yes": 0.61, "no": 0.29, "unsure": 0.10, "n": 603 }
  },
  "by_demographic": {
    "housing":        { "owner": { "yes": 0.31, "no": 0.5, "unsure": 0.19, "n": 900 }, "renter": { } },
    "income_band":    { "<$30k": { }, "$30–60k": { } },
    "race_ethnicity": { }
  }
}
```

### `GET /api/polls`
Last 10 runs: `[{ id, question, status, created_at }]`.

---

## UI pages

### `/` (home)
- Large text input ("Ask NYC anything") → `POST /api/polls` → redirect to
  `/polls/[id]`.
- Recent polls list (`GET /api/polls`).

### `/polls/[id]` (results)
- Question at top; progress bar while `status === 'running'` (poll GET every 2s).
- **Summary row:** YES / NO / UNSURE percentage pills.
- **By-borough table:** 5 rows × (yes/no/unsure/n), sortable.
- **Breakdown accordions:** housing, income band, race/ethnicity — each a
  yes/no/unsure bar per group.
- shadcn/ui `Card` + `Progress` + `Table` + accordion components.

---

## Testing

- **`aggregate.ts` — unit tests** (primary target): fixture batch results +
  fixture personas → known percentages. Cover the empty run, partial run
  (some PUMAs missing), and a fully-complete run.
- **`runBatch` — one integration smoke test** behind a real `ANTHROPIC_API_KEY`,
  skipped in CI.
- **End-to-end:** one real poll run verified manually during setup.

---

## Setup runbook (new session)

1. `npm install @supabase/supabase-js @anthropic-ai/sdk`
2. Apply `scripts/out/personas_insert.sql` to Supabase; verify persona count = 3000.
3. Apply migration `0003_pass2_fk_cascade.sql`.
4. Create `.env.local` (gitignored) with `ANTHROPIC_API_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. Run one real poll end-to-end and confirm aggregates render.

**Next.js 16 caveat:** per `AGENTS.md`, this is not the Next.js in training data —
read the relevant App Router / route-handler guides in `node_modules/next/dist/docs/`
before writing route or page code.

---

## Out of scope for Pass 2

- User auth / saved polls
- Multi-option (non-binary) questions
- PUMA-level map visualization
- SSE / real-time streaming to client
- Per-persona "explain your answer" drilldown
- CSV export
- Automatic resume of an interrupted run (schema supports it; logic deferred)

---

## Tech constraints

- Next.js App Router, TypeScript strict, Tailwind v4.
- `@supabase/supabase-js` for DB access from route handlers.
- `@anthropic-ai/sdk` for Claude calls (`tool_use` schema enforcement).
- No client streaming in v1 — poll GET every 2s.
- PUMA batches run sequentially to respect Anthropic rate limits.
- Secrets in `.env.local` (gitignored); `NEXT_PUBLIC_*` for client reads only.
