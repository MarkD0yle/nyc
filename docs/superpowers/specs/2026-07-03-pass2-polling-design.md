# Sim NYC Pass 2 — Synthetic Polling Engine

## What this builds

A polling engine that takes a plain-English question, routes it to all 3,000 synthetic NYC personas, and returns geographically-disaggregated opinion data — real distributions by borough, neighborhood, income band, race/ethnicity, and housing status. The results are surfaced in a Next.js UI with a map and breakdown charts.

## Background (Pass 1 recap)

- **3,000 weighted personas** are loaded in Supabase table `personas` (id, puma, borough, neighborhood, card jsonb)
- Each `card` has: age, sex, race_ethnicity, education, employment, personal_income, household_income, household_size, housing, gross_rent, language_at_home, commute, context_notes
- Supabase schema already has `poll_runs` and `poll_batch_results` tables (see migration `0001_pass1_schema.sql`)
- Next.js app at `src/` is scaffolded with shadcn/ui, Tailwind v4, App Router

---

## Architecture

```
User submits question
       │
       ▼
POST /api/polls                          (Next.js Route Handler)
  → insert poll_run row (status: running)
  → stream personas from Supabase by PUMA batch
  → for each batch: Claude API call → store poll_batch_results row
  → mark poll_run complete
       │
       ▼
GET /api/polls/[id]                      (polling / SSE)
  → aggregate batch results
  → return by-borough, by-demographic breakdowns
       │
       ▼
/polls/[id] page                         (Next.js)
  → live result tiles per borough
  → breakdown table (race, income band, housing)
  → PUMA-level map (optional stretch)
```

**Batching strategy:** group personas by PUMA (55 groups, ~55 personas each). One Claude API call per PUMA batch. Each call gets a system prompt with the batch's persona cards and returns structured JSON with one response per persona.

---

## Data model

### `poll_runs` (already exists)
```sql
id uuid primary key
question text not null
status text default 'running'   -- 'running' | 'complete' | 'failed'
created_at timestamptz
```

### `poll_batch_results` (already exists)
```sql
id uuid primary key
run_id uuid references poll_runs(id)
puma text not null
batch_index int not null
results jsonb not null           -- array of {persona_id, answer, reasoning?}
created_at timestamptz
```

**`results` shape:**
```json
[
  {
    "persona_id": "uuid",
    "answer": "yes" | "no" | "unsure",
    "confidence": 0.0–1.0,
    "reasoning": "one sentence"
  }
]
```

**Answer schema is question-dependent.** For yes/no questions the above works. For multi-option questions the engine must parse the question type and instruct Claude accordingly. Start with yes/no/unsure only.

---

## Claude prompt design

### System prompt (per batch)
```
You are simulating how a group of NYC residents would respond to a survey question.
Each persona below is a real statistical profile drawn from ACS 2024 census data.
Respond as each person would based on their demographics, income, housing situation, and life context.
Do not moralize or hedge. Each person has a genuine, consistent viewpoint shaped by their circumstances.
Return a JSON array — one object per persona — with fields: persona_id, answer ("yes"|"no"|"unsure"), confidence (0.0–1.0), reasoning (one sentence, first person).
```

### User message
```
Question: {question}

Personas:
{json array of persona cards with id field}
```

### Model
`claude-haiku-4-5-20251001` — fast and cheap for high-volume structured output. ~55 personas × 55 PUMAs = 3,025 Claude calls total per poll run. Use `claude-sonnet-4-6` only for a "deep mode" option on smaller samples.

### Cost estimate
- Haiku input: ~800 tokens/batch × 55 batches = ~44k tokens ≈ $0.02 per poll run
- Output: ~200 tokens/batch × 55 = ~11k tokens ≈ $0.01 per poll run
- **Total: ~$0.03 per full poll run** (3,000 personas)

---

## API routes

### `POST /api/polls`
**Request:** `{ "question": "Should NYC ban gas stoves in new buildings?" }`
**Response:** `{ "poll_id": "uuid" }` — kicks off background processing

Background work (in the route handler, using streaming or a queue):
1. Insert `poll_runs` row
2. Fetch all personas from Supabase grouped by PUMA
3. For each PUMA batch: call Claude, parse JSON, upsert `poll_batch_results`
4. Update `poll_runs.status = 'complete'`

### `GET /api/polls/[id]`
**Response:**
```json
{
  "question": "...",
  "status": "running" | "complete",
  "total_personas": 3000,
  "responded": 1540,
  "summary": {
    "yes": 0.47,
    "no": 0.38,
    "unsure": 0.15
  },
  "by_borough": {
    "Manhattan": { "yes": 0.61, "no": 0.29, "unsure": 0.10, "n": 603 },
    ...
  },
  "by_demographic": {
    "housing": {
      "owner": { "yes": 0.31, ... },
      "renter": { "yes": 0.55, ... }
    },
    "income_band": { ... },
    "race_ethnicity": { ... }
  }
}
```

### `GET /api/polls` — list recent polls (last 10)

---

## UI pages

### `/` (home) — question input
- Large text input: "Ask NYC anything"
- Recent polls list
- Submit → redirect to `/polls/[id]`

### `/polls/[id]` — results
- Question displayed at top
- Progress bar while running (poll `GET /api/polls/[id]` every 2s)
- **Summary row:** YES / NO / UNSURE percentage pills
- **By borough table:** 5 rows × 3 columns, sortable
- **Breakdown accordion:** housing, income band, race/ethnicity — each shows yes/no/unsure bars
- shadcn/ui Card + Progress + Table components

---

## Tech constraints

- Next.js App Router, TypeScript strict, Tailwind v4
- Supabase JS client (`@supabase/supabase-js`) for DB reads/writes from route handlers
- Anthropic SDK (`@anthropic-ai/sdk`) for Claude calls — use structured output / `tool_use` to enforce JSON schema
- No streaming to client in v1 — poll the GET endpoint every 2 seconds; add SSE in v2 if needed
- Rate limiting: run PUMA batches sequentially (not parallel) to avoid Anthropic rate limits; ~3 minutes for a full run on Haiku
- `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (gitignored)
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for client-side reads (read-only)

---

## Out of scope for Pass 2

- User authentication / saved polls
- Multi-option (non-binary) questions
- PUMA-level map visualization
- SSE / real-time streaming to client
- Persona "explain your answer" drilldown
- Export to CSV

---

## Open questions for the new session

1. **Background job execution:** Next.js Route Handlers time out at 60s on Vercel. The full 55-batch run takes ~3 min. Decide: (a) Vercel background functions, (b) chunked polling where the client triggers batch-by-batch, or (c) keep it simple and run on local/self-hosted where there's no timeout. Recommendation: start with (c) for v1, add Vercel background functions when deploying.

2. **Structured output enforcement:** Use Claude `tool_use` with a strict JSON schema per batch, or parse raw JSON from the response? Tool use is more reliable for schema enforcement.

3. **`poll_batch_results.run_id` FK needs `ON DELETE CASCADE`** (flagged in Pass 1 review). Apply as a migration before Pass 2 inserts data.

4. **Personas not yet in Supabase** — Pass 1 loader generates `scripts/out/personas_insert.sql`; needs to be applied before Pass 2 can run. Add to Pass 2 setup steps.
