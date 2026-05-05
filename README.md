# Workout Log — M Tucker A

A mobile-first PWA for logging the **M Tucker A** Infinity Fitness program. Built for iPhone Safari with installable home-screen support, offline mode, and local-first persistence.

**Live URL:** https://meltckr.github.io/workout-log-app/

## Features

- **Plan / Log / History / App** tabs with sticky top bar and bottom nav
- Day 1–4 selector and Week 1–6 tabs, prescription auto-loads from the source PDF
- Per-set weight, reps, RPE, set-complete checkmark
- Session metadata: date, body weight, energy, pain/strain, notes
- Completion tracking and progress bar per day
- Local-first persistence via `localStorage` (data stays on device)
- Optional Supabase cloud sync (push/pull) configurable in the App tab
- JSON / CSV export, JSON import
- Installable as a PWA (Apple touch icon, manifest, service worker)
- Works offline after first load

## Install on iPhone

1. Open the live URL in **Safari** on your iPhone.
2. Tap the **Share** button (square with up arrow).
3. Choose **Add to Home Screen**.
4. Open the app from your home screen — it runs full-screen with no browser chrome.

## File layout

```
index.html                 — single entry point
styles.css                 — athletic dark theme
app.js                     — UI, state, persistence, export/sync
data/plan.js               — full M Tucker A program (Days 1–4, Weeks 1–6)
manifest.webmanifest       — PWA manifest
service-worker.js          — offline cache for the app shell
icons/                     — PWA + apple-touch-icon
```

## Data model (localStorage)

- `wlog.entries.v1` — array of entries, one per (date, day, exerciseCode, week)
- `wlog.state.v1` — UI state (current tab/day/week)
- `wlog.settings.v1` — optional cloud sync settings

- `wlog.daily.v1` — daily metrics keyed by date (body weight, energy, pain/strain, daily note)

Each entry stores set-by-set `weight`, `reps`, `rpe`, `done`. Daily metrics are stored once per date in `wlog.daily.v1`.

## Cross-device sync (Supabase)

The app syncs your iPhone, MacBook, and Mac Studio in the background once you connect a free Supabase project. Local storage stays the source of truth; cloud is the backup that fans out to every device.

### One-time setup (~5 minutes)

**1. Create the project**
- Go to [supabase.com](https://supabase.com) → sign in with GitHub → **New project**.
- Pick a name (e.g. `workout-log`), set a DB password, choose the closest region (US-West for Scottsdale/Michigan).
- Wait ~1 min for it to provision.

**2. Run the schema**
- In your project, open **SQL Editor** → **New query** → paste this whole block and click **Run**:

```sql
-- ===== workout-log-app schema v1.4 (bulletproof sync) =====

-- Entries: one row per (date, day, exercise, week)
create table if not exists workout_entries (
  entry_key text primary key,
  user_id text,
  date date,
  day_id text,
  exercise_code text,
  week int,
  payload jsonb,
  client_version bigint,            -- monotonic version supplied by client (Date.now())
  client_device_id text,            -- which device wrote this (for ignoring self-echoes)
  client_updated_at timestamptz,    -- when the client edited it
  server_updated_at timestamptz default now() not null,  -- authoritative server clock
  deleted boolean default false not null
);
create index if not exists workout_entries_server_updated_at_idx on workout_entries (server_updated_at);
create index if not exists workout_entries_user_idx on workout_entries (user_id);

-- Daily metrics: one row per date
create table if not exists workout_daily (
  date date primary key,
  user_id text,
  body_weight numeric,
  energy int,
  pain_strain int,
  notes text,
  payload jsonb,
  client_version bigint,
  client_device_id text,
  client_updated_at timestamptz,
  server_updated_at timestamptz default now() not null,
  deleted boolean default false not null
);
create index if not exists workout_daily_server_updated_at_idx on workout_daily (server_updated_at);
create index if not exists workout_daily_user_idx on workout_daily (user_id);

-- Trigger: server stamps server_updated_at on every change. This is the conflict tiebreaker.
create or replace function wlog_touch() returns trigger language plpgsql as $$
begin
  new.server_updated_at := now();
  return new;
end $$;

drop trigger if exists wlog_entries_touch on workout_entries;
create trigger wlog_entries_touch before insert or update on workout_entries
  for each row execute function wlog_touch();

drop trigger if exists wlog_daily_touch on workout_daily;
create trigger wlog_daily_touch before insert or update on workout_daily
  for each row execute function wlog_touch();

-- Row-level security: anon key has full access (single-user; treat anon key like a password)
alter table workout_entries enable row level security;
alter table workout_daily   enable row level security;

drop policy if exists "anon all entries" on workout_entries;
drop policy if exists "anon all daily"   on workout_daily;
create policy "anon all entries" on workout_entries for all using (true) with check (true);
create policy "anon all daily"   on workout_daily   for all using (true) with check (true);

-- Realtime: enable change broadcasts so other devices learn instantly
alter publication supabase_realtime add table workout_entries;
alter publication supabase_realtime add table workout_daily;
```

Already running an older v1.3 schema? Run only the migration block below — it adds the new columns/triggers without losing data:

```sql
alter table workout_entries
  add column if not exists client_version bigint,
  add column if not exists client_device_id text,
  add column if not exists client_updated_at timestamptz,
  add column if not exists server_updated_at timestamptz default now() not null,
  add column if not exists deleted boolean default false not null;
alter table workout_daily
  add column if not exists client_version bigint,
  add column if not exists client_device_id text,
  add column if not exists client_updated_at timestamptz,
  add column if not exists server_updated_at timestamptz default now() not null,
  add column if not exists deleted boolean default false not null;
create index if not exists workout_entries_server_updated_at_idx on workout_entries (server_updated_at);
create index if not exists workout_daily_server_updated_at_idx on workout_daily (server_updated_at);
-- (re-run the trigger function and Realtime publication blocks above)
```

**3. Copy your credentials**
- Open **Project Settings → API** (or **Data API**).
- Copy **Project URL** (looks like `https://abcdxyz.supabase.co`).
- Copy **anon (public) key** — the long `eyJ...` string. **Do not** copy the service_role key.

**4. Connect the app**
- Open the app → **App** tab → *Sync across devices*.
- Paste Project URL and Anon key. Leave table names as defaults.
- Tap **Test connection** — you should see `Connected ✓`.
- Tap **Push all** once to seed the cloud with your existing logs.

**5. Repeat on every other device**
- Open the same live URL, paste the same Project URL + anon key.
- The app will pull existing data automatically. From here on, every change syncs in the background.

### How sync works (bulletproof mode)

- **Server is the clock.** A Postgres trigger stamps `server_updated_at` on every write. The client never trusts its own clock for conflict resolution.
- **Conflict order:** newer `client_version` wins; ties broken by `server_updated_at`. Same write twice is a no-op (idempotent UPSERT on primary key).
- **Durable outbox.** Every write is queued in `localStorage` *before* the network call. App killed mid-write, airplane mode, dead WiFi — the queue survives and drains on reconnect.
- **Exponential backoff.** Failed writes retry at 1s → 3s → 7s → 15s → … capped at 60s, with jitter.
- **Incremental pull with watermark.** The app remembers the last `server_updated_at` it consumed and only fetches rows newer than that. Tiny payloads, fast on 5G, paginated for big offline gaps.
- **Tombstones for deletes.** Deleting an exercise on iPhone is propagated as `deleted=true`; other devices honor it instead of resurrecting the row.
- **Realtime push, polling backup.** Supabase Realtime gives instant cross-device updates; if the WebSocket can't connect (corporate WiFi, captive portal), a 30s background poll catches up.
- **Self-echo suppression.** A device tags every write with its `client_device_id`; Realtime echoes of its own writes don't trigger redundant work.
- **Cross-tab safe.** Editing in one tab is reflected in another tab on the same browser instantly via the `storage` event.
- **Run diagnostics** in the App tab does a full write/read/delete round-trip and reports latency — if anything's wrong it tells you exactly which step failed.

## Deployment (GitHub Pages)

Repo: `meltckr/workout-log-app`, branch `main`, root.

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/meltckr/workout-log-app.git
git push -u origin main
```

Then in the repo settings: **Pages → Build from a branch → main / (root)**.

## Assumptions while extracting the plan

- Day 2 has two B2-coded movements ("Rear Leg Elevated Lunge" and "Ball squeeze"). The second was renamed to **B2b** internally so each exercise has a unique key. The original code label is preserved in the notes.
- Reps in parentheses (e.g. `(6-8)`) are kept as the verbatim prescribed range.
- Compound rep notations like `(4-6)-(6-8)` are preserved as-is — these are cluster/drop ranges from the sheet.
- "na" tempo (e.g. ball squeeze, hamstring pray, cable core) is preserved as the literal `na` string and shown as the prescribed tempo.
- Time-based reps (e.g. `20 sec`, `30 sec`) are kept as text in the reps field.
- Rest is recorded in seconds per set, exactly as on the sheet.
- Day labels (Day 1 — Upper Push/Pull, Day 2 — Lower, Day 3 — Arms, Day 4 — Core) are descriptive labels added for clarity; only "Day 1/2/3/4" is on the source PDF.

## Local development

This is a fully static site. Run any local server, e.g.:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Service worker requires `https://` or `localhost`.
