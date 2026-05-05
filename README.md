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

Each entry stores set-by-set `weight`, `reps`, `rpe`, `done`, plus session-level `bodyWeight`, `energy`, `painStrain`, `notes`.

## Optional cloud sync (Supabase)

If you want cross-device sync, create a Supabase project and a table:

```sql
create table workout_entries (
  entry_key text primary key,
  user_id text,
  date date,
  day_id text,
  exercise_code text,
  week int,
  payload jsonb,
  updated_at timestamptz default now()
);
```

Then in the **App** tab, paste your project URL, anon key, and table name. Use **Push all** to upload local logs and **Pull from cloud** to merge remote changes (newest `updatedAt` wins).

> Local storage remains the source of truth; cloud is optional backup/sync.

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
