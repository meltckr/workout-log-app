// Workout Log — app.js
// Persistence: localStorage. Optional cloud sync via Supabase if configured in App tab.

(function () {
  'use strict';

  const STORAGE = {
    state: 'wlog.state.v1',
    entries: 'wlog.entries.v1',
    settings: 'wlog.settings.v1',
    daily: 'wlog.daily.v1',
    outbox: 'wlog.outbox.v1',     // durable write queue, survives app kills
    syncMeta: 'wlog.syncMeta.v1', // { deviceId, lastWatermark }
    tombstones: 'wlog.tombstones.v1'
  };

  const APP_VERSION = '1.4.0';

  // ---------- State ----------
  const defaultState = {
    tab: 'plan',
    week: 1,
    dayId: 'day1',
    exerciseCode: null   // null = day overview
  };

  const defaultSettings = {
    supabaseUrl: '',
    supabaseAnonKey: '',
    supabaseTable: 'workout_entries',
    dailyTable: 'workout_daily',
    userId: '',
    autoSync: true,
    realtimeSync: true   // websocket realtime; falls back to polling
  };

  // Device id: stable per browser install, used to ignore self-echoes from realtime
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return Object.assign({}, fallback, JSON.parse(raw));
    } catch (_) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }
  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE.entries);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }
  function saveEntries(arr) {
    save(STORAGE.entries, arr);
  }
  function loadDaily() {
    try {
      const raw = localStorage.getItem(STORAGE.daily);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function saveDaily(obj) {
    try { localStorage.setItem(STORAGE.daily, JSON.stringify(obj)); } catch (_) {}
  }

  let state = load(STORAGE.state, defaultState);
  let settings = load(STORAGE.settings, defaultSettings);
  let entries = loadEntries();
  let daily = loadDaily(); // { 'YYYY-MM-DD': { bodyWeight, energy, painStrain, notes, updatedAt } }

  // Sync meta: device id + watermark (last server timestamp seen, ISO string)
  let syncMeta = load(STORAGE.syncMeta, { deviceId: '', lastWatermarkEntries: '1970-01-01T00:00:00Z', lastWatermarkDaily: '1970-01-01T00:00:00Z' });
  if (!syncMeta.deviceId) { syncMeta.deviceId = uuid(); save(STORAGE.syncMeta, syncMeta); }

  // Tombstones: { entries: { entry_key: { deleted_at, version } }, daily: { date: { deleted_at, version } } }
  let tombstones = load(STORAGE.tombstones, { entries: {}, daily: {} });
  function saveTombstones() { save(STORAGE.tombstones, tombstones); }

  // Outbox: durable queue of pending writes. Each item: { id, op, table, key, payload, attempts, queued_at }
  function loadOutbox() {
    try { return JSON.parse(localStorage.getItem(STORAGE.outbox) || '[]'); } catch (_) { return []; }
  }
  function saveOutbox(arr) {
    try { localStorage.setItem(STORAGE.outbox, JSON.stringify(arr)); } catch (_) {}
  }
  let outbox = loadOutbox();
  function enqueue(item) {
    item.id = item.id || uuid();
    item.queued_at = item.queued_at || Date.now();
    item.attempts = item.attempts || 0;
    // Coalesce: if a queued write for the same table+key exists, replace it (latest payload wins locally).
    const i = outbox.findIndex((x) => x.table === item.table && x.key === item.key);
    if (i >= 0) outbox[i] = item; else outbox.push(item);
    saveOutbox(outbox);
    scheduleDrain();
  }

  function getDaily(date) {
    return daily[date] || { bodyWeight: '', energy: '', painStrain: '', notes: '' };
  }
  function setDaily(date, patch) {
    const cur = getDaily(date);
    const next = Object.assign({}, cur, patch, { updatedAt: Date.now() });
    daily[date] = next;
    saveDaily(daily);
    maybeSyncDaily(date, next);
    return next;
  }

  // One-time migration: lift any per-entry meta into the daily store
  (function migrateMeta() {
    let migrated = false;
    entries.forEach((e) => {
      const hasMeta = e.bodyWeight || e.energy || e.painStrain;
      if (!e.date || !hasMeta) return;
      const cur = getDaily(e.date);
      const next = {
        bodyWeight: cur.bodyWeight || e.bodyWeight || '',
        energy: cur.energy || e.energy || '',
        painStrain: cur.painStrain || e.painStrain || ''
      };
      daily[e.date] = Object.assign({}, cur, next, { updatedAt: Date.now() });
      // Strip from entry so it stays single-source-of-truth
      delete e.bodyWeight; delete e.energy; delete e.painStrain;
      migrated = true;
    });
    if (migrated) { saveDaily(daily); saveEntries(entries); }
  })();

  // ---------- Helpers ----------
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== undefined && attrs[k] !== null) node.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  function todayISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset();
    const local = new Date(d.getTime() - tz * 60000);
    return local.toISOString().slice(0, 10);
  }

  function findDay(dayId) { return PLAN.days.find((d) => d.id === dayId); }
  function findExercise(day, code) { return day && day.exercises.find((e) => e.code === code); }
  function findRx(ex, week) { return ex && ex.weeks.find((w) => w.week === week); }

  function entryKey(date, dayId, exerciseCode, week) {
    return `${date}::${dayId}::${exerciseCode}::w${week}`;
  }
  function findEntry(date, dayId, exerciseCode, week) {
    const k = entryKey(date, dayId, exerciseCode, week);
    return entries.find((e) => e.key === k);
  }
  function upsertEntry(entry) {
    entry.key = entryKey(entry.date, entry.dayId, entry.exerciseCode, entry.week);
    entry.updatedAt = Date.now();
    const idx = entries.findIndex((e) => e.key === entry.key);
    if (idx >= 0) entries[idx] = entry; else entries.push(entry);
    saveEntries(entries);
    maybeSyncCloud(entry);
  }
  function deleteEntry(key) {
    entries = entries.filter((e) => e.key !== key);
    saveEntries(entries);
    // Tombstone so other devices don't resurrect it on next sync
    tombstones.entries[key] = { deleted_at: new Date().toISOString(), version: Date.now() };
    saveTombstones();
    if (cloudReady() && settings.autoSync) {
      enqueue({ op: 'delete', table: settings.supabaseTable, key, payload: { entry_key: key } });
    }
  }
  function deleteDaily(date) {
    if (daily[date]) { delete daily[date]; saveDaily(daily); }
    tombstones.daily[date] = { deleted_at: new Date().toISOString(), version: Date.now() };
    saveTombstones();
    if (cloudReady() && settings.autoSync) {
      enqueue({ op: 'delete', table: settings.dailyTable, key: date, payload: { date } });
    }
  }

  function setState(patch) {
    state = Object.assign({}, state, patch);
    save(STORAGE.state, state);
    render();
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------- Cloud sync (bulletproof) ----------
  // Server is the clock. Conflict order: (version DESC, server_updated_at DESC).
  // Writes go to a durable outbox; reads use an incremental watermark.
  //
  // Status: 'off' | 'syncing' | 'ok' | 'error' | 'queued'
  let syncStatus = 'off';
  let syncMessage = '';
  let syncListeners = [];
  function setSyncStatus(s, m) {
    syncStatus = s;
    syncMessage = m || '';
    syncListeners.forEach((fn) => { try { fn(); } catch (_) {} });
  }
  function onSyncChange(fn) { syncListeners.push(fn); return () => { syncListeners = syncListeners.filter((x) => x !== fn); }; }

  function cloudReady() {
    return !!(settings.supabaseUrl && settings.supabaseAnonKey && settings.supabaseTable && settings.dailyTable);
  }
  function sbHeaders(extra) {
    return Object.assign({
      'apikey': settings.supabaseAnonKey,
      'Authorization': `Bearer ${settings.supabaseAnonKey}`
    }, extra || {});
  }
  function sbUrl(table, qs) {
    const base = settings.supabaseUrl.replace(/\/$/, '');
    return `${base}/rest/v1/${table}${qs ? '?' + qs : ''}`;
  }
  function userFilter() {
    return settings.userId ? `user_id=eq.${encodeURIComponent(settings.userId)}` : '';
  }

  // Fetch with timeout so a flaky network never hangs the queue forever
  async function sbFetch(url, opts, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
    try {
      const res = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
      return res;
    } finally { clearTimeout(t); }
  }

  // ----- Outbox (durable write queue) -----
  // Items: { id, op:'upsert'|'delete', table, key, payload, attempts, queued_at, next_attempt }
  let drainTimer = null;
  let draining = false;
  function scheduleDrain(delay) {
    if (drainTimer) clearTimeout(drainTimer);
    drainTimer = setTimeout(drainOutbox, delay != null ? delay : 400);
  }
  function backoffMs(attempts) {
    // 1s, 3s, 7s, 15s, capped at 60s; jittered ±25%
    const base = Math.min(60000, 1000 * (Math.pow(2, attempts) - 1));
    const jitter = base * (0.75 + Math.random() * 0.5);
    return Math.max(1000, jitter);
  }

  async function drainOutbox() {
    if (draining) return;
    if (!cloudReady()) return;
    if (!settings.autoSync) return;
    if (!navigator.onLine) { setSyncStatus('queued', `Offline · ${outbox.length} queued`); return; }
    draining = true;
    setSyncStatus('syncing', `Syncing ${outbox.length}…`);
    try {
      // Group items by op+table so we can batch upserts in one POST per table
      const upsertByTable = new Map();   // table -> [items]
      const deletes = [];                // [{table, key, payload}]
      const now = Date.now();
      outbox.forEach((it) => {
        if (it.next_attempt && it.next_attempt > now) return; // still in backoff
        if (it.op === 'delete') deletes.push(it);
        else {
          if (!upsertByTable.has(it.table)) upsertByTable.set(it.table, []);
          upsertByTable.get(it.table).push(it);
        }
      });

      const succeededIds = new Set();
      const failedItems = [];

      // Upserts: one batched POST per table with merge-duplicates
      for (const [table, items] of upsertByTable) {
        const body = items.map((it) => {
          const p = Object.assign({}, it.payload);
          // Stamp client metadata used by the trigger to set server fields
          p.client_updated_at = new Date(it.queued_at).toISOString();
          p.client_device_id = syncMeta.deviceId;
          return p;
        });
        try {
          const res = await sbFetch(sbUrl(table), {
            method: 'POST',
            headers: sbHeaders({
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates,return=minimal'
            }),
            body: JSON.stringify(body)
          });
          if (!res.ok) {
            const txt = await res.text();
            throw new Error(`${table} ${res.status}: ${txt.slice(0,120)}`);
          }
          items.forEach((it) => succeededIds.add(it.id));
        } catch (e) {
          items.forEach((it) => failedItems.push({ it, err: e }));
        }
      }

      // Deletes: soft-delete via UPSERT with deleted=true so tombstones replicate cleanly
      if (deletes.length) {
        const byTable = new Map();
        deletes.forEach((it) => {
          if (!byTable.has(it.table)) byTable.set(it.table, []);
          const tomb = it.table === settings.supabaseTable
            ? tombstones.entries[it.key]
            : tombstones.daily[it.key];
          const row = it.table === settings.supabaseTable
            ? { entry_key: it.key, user_id: settings.userId || null, deleted: true,
                client_version: (tomb && tomb.version) || Date.now(),
                client_device_id: syncMeta.deviceId,
                client_updated_at: (tomb && tomb.deleted_at) || new Date().toISOString() }
            : { date: it.key, user_id: settings.userId || null, deleted: true,
                client_version: (tomb && tomb.version) || Date.now(),
                client_device_id: syncMeta.deviceId,
                client_updated_at: (tomb && tomb.deleted_at) || new Date().toISOString() };
          byTable.get(it.table).push({ it, row });
        });
        for (const [table, items] of byTable) {
          try {
            const res = await sbFetch(sbUrl(table), {
              method: 'POST',
              headers: sbHeaders({
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates,return=minimal'
              }),
              body: JSON.stringify(items.map((x) => x.row))
            });
            if (!res.ok) {
              const txt = await res.text();
              throw new Error(`${table} tombstone ${res.status}: ${txt.slice(0,120)}`);
            }
            items.forEach((x) => succeededIds.add(x.it.id));
          } catch (e) {
            items.forEach((x) => failedItems.push({ it: x.it, err: e }));
          }
        }
      }

      // Update outbox: remove successes, bump attempts on failures
      const next = [];
      outbox.forEach((it) => {
        if (succeededIds.has(it.id)) return;
        const failed = failedItems.find((f) => f.it.id === it.id);
        if (failed) {
          it.attempts = (it.attempts || 0) + 1;
          it.last_error = String(failed.err && failed.err.message || failed.err);
          it.next_attempt = Date.now() + backoffMs(it.attempts);
        }
        next.push(it);
      });
      outbox = next;
      saveOutbox(outbox);

      if (outbox.length === 0) {
        setSyncStatus('ok', 'Synced');
      } else {
        const errs = outbox.filter((x) => x.last_error).length;
        if (errs) setSyncStatus('error', `${errs} failed · will retry`);
        else setSyncStatus('queued', `${outbox.length} queued`);
        // Schedule the next attempt at the earliest next_attempt
        const earliest = outbox.reduce((m, x) => Math.min(m, x.next_attempt || Date.now()), Infinity);
        scheduleDrain(Math.max(500, earliest - Date.now()));
      }
    } finally {
      draining = false;
    }
  }

  // ----- Public-ish helpers wired to UI/state -----
  function maybeSyncCloud(entry) {
    if (!cloudReady() || !settings.autoSync) return;
    enqueue({
      op: 'upsert',
      table: settings.supabaseTable,
      key: entry.key,
      payload: {
        entry_key: entry.key,
        user_id: settings.userId || null,
        date: entry.date,
        day_id: entry.dayId,
        exercise_code: entry.exerciseCode,
        week: entry.week,
        payload: entry,
        client_version: entry.updatedAt || Date.now()
      }
    });
  }
  function maybeSyncDaily(date, row) {
    if (!cloudReady() || !settings.autoSync) return;
    enqueue({
      op: 'upsert',
      table: settings.dailyTable,
      key: date,
      payload: {
        date,
        user_id: settings.userId || null,
        body_weight: row.bodyWeight === '' ? null : Number(row.bodyWeight) || null,
        energy: row.energy === '' ? null : parseInt(row.energy, 10) || null,
        pain_strain: row.painStrain === '' ? null : parseInt(row.painStrain, 10) || null,
        notes: row.notes || null,
        payload: Object.assign({ date }, row),
        client_version: row.updatedAt || Date.now()
      }
    });
  }

  // ----- Incremental pull with watermark -----
  // We page through results so a long offline gap can't time out a single request.
  async function pullTable(tableKey, watermarkKey, applyRow, applyTombstone) {
    const table = settings[tableKey];
    let watermark = syncMeta[watermarkKey] || '1970-01-01T00:00:00Z';
    let merged = 0, tomb = 0;
    let page = 0;
    while (true) {
      const uf = userFilter();
      const wmEnc = encodeURIComponent(watermark);
      const qs = `select=*&server_updated_at=gt.${wmEnc}&order=server_updated_at.asc&limit=500${uf ? '&' + uf : ''}`;
      const res = await sbFetch(sbUrl(table, qs), { headers: sbHeaders() }, 20000);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${table} pull ${res.status}: ${txt.slice(0,120)}`);
      }
      const rows = await res.json();
      if (!rows.length) break;
      rows.forEach((r) => {
        if (r.deleted) {
          if (applyTombstone(r)) tomb++;
        } else {
          if (applyRow(r)) merged++;
        }
        // Track the latest server time we've successfully consumed
        if (r.server_updated_at && r.server_updated_at > watermark) watermark = r.server_updated_at;
      });
      // Persist watermark progress after every page so a crash mid-pull doesn't redo work
      syncMeta[watermarkKey] = watermark;
      save(STORAGE.syncMeta, syncMeta);
      page++;
      if (rows.length < 500) break;
      if (page > 40) break; // 20k row safety cap per pull
    }
    return { merged, tomb };
  }

  async function syncCloudPull(opts) {
    opts = opts || {};
    if (!cloudReady()) {
      if (!opts.silent) toast('Add Supabase URL and key in App tab');
      return { ok: false, reason: 'not-configured' };
    }
    setSyncStatus('syncing', 'Pulling…');
    try {
      const eRes = await pullTable('supabaseTable', 'lastWatermarkEntries',
        (r) => {
          // Skip our own writes that are still in the outbox waiting for ack
          if (r.client_device_id === syncMeta.deviceId && outbox.some((o) => o.table === settings.supabaseTable && o.key === r.entry_key)) return false;
          // Honor local tombstone if it's newer than the remote
          const tomb = tombstones.entries[r.entry_key];
          if (tomb && new Date(tomb.deleted_at).getTime() > new Date(r.server_updated_at).getTime()) return false;
          const remote = r.payload || {};
          remote.key = r.entry_key;
          // Compare by client_version (server preserves it for tie-breaking)
          const local = entries.find((e) => e.key === r.entry_key);
          const lv = (local && local.updatedAt) || 0;
          const rv = r.client_version || 0;
          if (!local || rv > lv || (rv === lv && r.server_updated_at > (local._server_updated_at || ''))) {
            remote._server_updated_at = r.server_updated_at;
            const idx = entries.findIndex((e) => e.key === r.entry_key);
            if (idx >= 0) entries[idx] = remote; else entries.push(remote);
            return true;
          }
          return false;
        },
        (r) => {
          const idx = entries.findIndex((e) => e.key === r.entry_key);
          if (idx >= 0) { entries.splice(idx, 1); }
          tombstones.entries[r.entry_key] = { deleted_at: r.server_updated_at, version: r.client_version || Date.now() };
          return true;
        }
      );
      saveEntries(entries); saveTombstones();

      const dRes = await pullTable('dailyTable', 'lastWatermarkDaily',
        (r) => {
          if (r.client_device_id === syncMeta.deviceId && outbox.some((o) => o.table === settings.dailyTable && o.key === r.date)) return false;
          const tomb = tombstones.daily[r.date];
          if (tomb && new Date(tomb.deleted_at).getTime() > new Date(r.server_updated_at).getTime()) return false;
          const remote = r.payload || {
            bodyWeight: r.body_weight != null ? String(r.body_weight) : '',
            energy: r.energy != null ? String(r.energy) : '',
            painStrain: r.pain_strain != null ? String(r.pain_strain) : '',
            notes: r.notes || '',
            updatedAt: r.client_version || (r.server_updated_at ? new Date(r.server_updated_at).getTime() : 0)
          };
          const cur = daily[r.date];
          const cv = (cur && cur.updatedAt) || 0;
          const rv = r.client_version || 0;
          if (!cur || rv > cv || (rv === cv && r.server_updated_at > (cur._server_updated_at || ''))) {
            remote._server_updated_at = r.server_updated_at;
            daily[r.date] = remote;
            return true;
          }
          return false;
        },
        (r) => {
          if (daily[r.date]) delete daily[r.date];
          tombstones.daily[r.date] = { deleted_at: r.server_updated_at, version: r.client_version || Date.now() };
          return true;
        }
      );
      saveDaily(daily); saveTombstones();

      const total = eRes.merged + eRes.tomb + dRes.merged + dRes.tomb;
      if (outbox.length) setSyncStatus('queued', `${outbox.length} queued`);
      else setSyncStatus('ok', total ? `Pulled ${total}` : 'Up to date');
      if (!opts.silent) toast(total ? `Pulled ${total}` : 'Already up to date');
      render();
      return { ok: true, ...eRes, daily: dRes };
    } catch (e) {
      setSyncStatus('error', String(e && e.message || e));
      if (!opts.silent) toast('Pull failed · will retry');
      // Schedule another attempt
      setTimeout(() => { if (cloudReady() && settings.autoSync) syncCloudPull({ silent: true }); }, 5000);
      return { ok: false, reason: String(e && e.message || e) };
    }
  }

  async function syncCloudPushAll() {
    if (!cloudReady()) { toast('Add Supabase URL and key in App tab'); return; }
    // Re-enqueue everything (idempotent because outbox coalesces by key)
    entries.forEach((e) => maybeSyncCloud(e));
    Object.keys(daily).forEach((date) => maybeSyncDaily(date, daily[date]));
    // Also re-emit tombstones in case server lost them
    Object.keys(tombstones.entries).forEach((k) => {
      if (!entries.find((e) => e.key === k)) {
        enqueue({ op: 'delete', table: settings.supabaseTable, key: k, payload: { entry_key: k } });
      }
    });
    Object.keys(tombstones.daily).forEach((d) => {
      if (!daily[d]) enqueue({ op: 'delete', table: settings.dailyTable, key: d, payload: { date: d } });
    });
    setSyncStatus('syncing', `Pushing ${outbox.length}…`);
    await drainOutbox();
    if (outbox.length === 0) toast('All pushed');
    else toast(`${outbox.length} retrying`);
  }

  async function testCloudConnection() {
    if (!cloudReady()) { toast('Fill all required fields first'); return false; }
    setSyncStatus('syncing', 'Testing…');
    const checks = [];
    try {
      // Validate both tables and required columns exist
      const cols = 'entry_key,server_updated_at,client_version,client_device_id,deleted';
      const r1 = await sbFetch(sbUrl(settings.supabaseTable, `select=${cols}&limit=1`), { headers: sbHeaders() }, 8000);
      if (!r1.ok) {
        const t = await r1.text();
        throw new Error(`Entries table or schema issue: ${r1.status} — run the SQL migration in README. ${t.slice(0,100)}`);
      }
      checks.push('entries table OK');
      const cols2 = 'date,server_updated_at,client_version,client_device_id,deleted';
      const r2 = await sbFetch(sbUrl(settings.dailyTable, `select=${cols2}&limit=1`), { headers: sbHeaders() }, 8000);
      if (!r2.ok) {
        const t = await r2.text();
        throw new Error(`Daily table or schema issue: ${r2.status} — run the SQL migration in README. ${t.slice(0,100)}`);
      }
      checks.push('daily table OK');

      // Round-trip self-test: write a probe row, read it back, delete it, time it
      const probeKey = `__probe__::${syncMeta.deviceId}::${Date.now()}`;
      const t0 = performance.now();
      const wRes = await sbFetch(sbUrl(settings.supabaseTable), {
        method: 'POST',
        headers: sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify([{
          entry_key: probeKey,
          user_id: settings.userId || null,
          date: todayISO(), day_id: 'probe', exercise_code: 'P', week: 0,
          payload: { probe: true },
          client_version: Date.now(),
          client_device_id: syncMeta.deviceId
        }])
      }, 8000);
      if (!wRes.ok) throw new Error(`Write probe failed: ${wRes.status}`);
      const rRes = await sbFetch(sbUrl(settings.supabaseTable, `select=*&entry_key=eq.${encodeURIComponent(probeKey)}`), { headers: sbHeaders() }, 8000);
      if (!rRes.ok) throw new Error(`Read probe failed: ${rRes.status}`);
      const rows = await rRes.json();
      if (!rows.length) throw new Error('Probe row not visible after write — RLS may block reads');
      if (!rows[0].server_updated_at) throw new Error('server_updated_at is missing — install the trigger from README');
      const dRes = await sbFetch(sbUrl(settings.supabaseTable, `entry_key=eq.${encodeURIComponent(probeKey)}`), { method: 'DELETE', headers: sbHeaders() }, 8000);
      if (!dRes.ok) throw new Error(`Delete probe failed: ${dRes.status}`);
      const ms = Math.round(performance.now() - t0);
      checks.push(`round-trip ${ms}ms`);

      setSyncStatus('ok', `Diagnostics: ${checks.join(' · ')}`);
      toast(`All checks passed · ${ms}ms round-trip`);
      return true;
    } catch (e) {
      setSyncStatus('error', String(e && e.message || e));
      toast('Diagnostics failed — see status');
      return false;
    }
  }

  // ----- Realtime subscription (optional, falls back to polling) -----
  let rtSocket = null;
  let rtRetryTimer = null;
  let rtPollTimer = null;
  function rtConnect() {
    if (!cloudReady() || !settings.realtimeSync) return;
    rtDisconnect();
    try {
      const wsUrl = settings.supabaseUrl.replace(/^http/, 'ws') + `/realtime/v1/websocket?apikey=${encodeURIComponent(settings.supabaseAnonKey)}&vsn=1.0.0`;
      rtSocket = new WebSocket(wsUrl);
      let heartbeat = null;
      rtSocket.onopen = () => {
        // Subscribe to changes on both tables
        const sub = (topic) => rtSocket.send(JSON.stringify({
          topic, event: 'phx_join',
          payload: { config: { postgres_changes: [{ event: '*', schema: 'public', table: topic.split(':').pop() }] } },
          ref: String(Date.now())
        }));
        sub(`realtime:public:${settings.supabaseTable}`);
        sub(`realtime:public:${settings.dailyTable}`);
        heartbeat = setInterval(() => {
          try { rtSocket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(Date.now()) })); } catch(_) {}
        }, 25000);
      };
      rtSocket.onmessage = (msg) => {
        // Any change message → trigger a fast incremental pull
        try {
          const data = JSON.parse(msg.data);
          if (data.event === 'postgres_changes' || (data.payload && data.payload.data)) {
            // Debounce so a burst of changes only causes one pull
            if (rtPollTimer) clearTimeout(rtPollTimer);
            rtPollTimer = setTimeout(() => syncCloudPull({ silent: true }), 250);
          }
        } catch (_) {}
      };
      rtSocket.onclose = () => {
        if (heartbeat) clearInterval(heartbeat);
        // Auto-reconnect with backoff
        if (rtRetryTimer) clearTimeout(rtRetryTimer);
        rtRetryTimer = setTimeout(rtConnect, 5000);
      };
      rtSocket.onerror = () => { /* let onclose handle reconnect */ };
    } catch (_) {
      // If realtime can't connect at all, polling fallback below still keeps us in sync
    }
  }
  function rtDisconnect() {
    if (rtSocket) { try { rtSocket.close(); } catch(_) {} rtSocket = null; }
    if (rtRetryTimer) { clearTimeout(rtRetryTimer); rtRetryTimer = null; }
  }

  // Always-on polling fallback: every 30s pull silently. Cheap because of watermark.
  let pollTimer = null;
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (cloudReady() && settings.autoSync && !document.hidden && navigator.onLine) {
        syncCloudPull({ silent: true });
      }
    }, 30000);
  }

  // ---------- Export / Import ----------
  function downloadBlob(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }
  function exportJSON() {
    downloadBlob(`workout-log-${todayISO()}.json`, 'application/json',
      JSON.stringify({ exportedAt: new Date().toISOString(), program: PLAN.program, entries, daily }, null, 2));
  }
  function exportCSV() {
    const rows = [['date','day','exercise_code','exercise_name','week','set','weight','reps','rpe','done','body_weight','energy','pain_strain','exercise_notes','daily_notes']];
    entries.forEach((e) => {
      const day = findDay(e.dayId);
      const ex = findExercise(day, e.exerciseCode);
      const exName = ex ? ex.name : e.exerciseCode;
      const d = getDaily(e.date);
      const sets = e.sets || [];
      if (sets.length === 0) {
        rows.push([e.date, e.dayId, e.exerciseCode, exName, e.week, '', '', '', '', '', d.bodyWeight || '', d.energy || '', d.painStrain || '', (e.notes || '').replace(/\n/g, ' '), (d.notes || '').replace(/\n/g, ' ')]);
      } else {
        sets.forEach((s, i) => {
          rows.push([e.date, e.dayId, e.exerciseCode, exName, e.week, i + 1, s.weight ?? '', s.reps ?? '', s.rpe ?? '', s.done ? 1 : 0, d.bodyWeight || '', d.energy || '', d.painStrain || '', (e.notes || '').replace(/\n/g, ' '), (d.notes || '').replace(/\n/g, ' ')]);
        });
      }
    });
    const csv = rows.map((r) => r.map((v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    downloadBlob(`workout-log-${todayISO()}.csv`, 'text/csv', csv);
  }
  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.entries)) throw new Error('bad format');
        // merge entries, keep newest
        const map = new Map();
        entries.concat(data.entries).forEach((e) => {
          const cur = map.get(e.key);
          if (!cur || (e.updatedAt || 0) > (cur.updatedAt || 0)) map.set(e.key, e);
        });
        entries = Array.from(map.values());
        saveEntries(entries);
        // merge daily, newest updatedAt wins
        if (data.daily && typeof data.daily === 'object') {
          Object.keys(data.daily).forEach((date) => {
            const incoming = data.daily[date];
            const cur = daily[date];
            if (!cur || (incoming.updatedAt || 0) > (cur.updatedAt || 0)) {
              daily[date] = incoming;
            }
          });
          saveDaily(daily);
        }
        toast(`Imported ${data.entries.length}`);
        render();
      } catch (_) { toast('Import failed'); }
    };
    reader.readAsText(file);
  }

  // ---------- Renderers ----------
  function renderTopSub() {
    const sub = $('#topSub');
    const d = findDay(state.dayId);
    const map = { plan: 'Plan', log: 'Log', history: 'History', app: 'App' };
    let txt = map[state.tab] || '';
    if ((state.tab === 'plan' || state.tab === 'log') && d) {
      txt = `${map[state.tab]} · ${d.name.split('—')[0].trim()} · W${state.week}`;
    }
    sub.textContent = txt;
  }

  function renderWeekSelect() {
    const sel = $('#weekSelect');
    sel.innerHTML = '';
    for (let i = 1; i <= PLAN.weeks; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `Week ${i}`;
      if (i === state.week) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = () => setState({ week: parseInt(sel.value, 10) });
  }

  function renderTabs() {
    $$('.tabbar .tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === state.tab);
      b.onclick = () => setState({ tab: b.dataset.tab, exerciseCode: null });
    });
  }

  function renderDaySegmented(scope) {
    const wrap = el('div', { class: 'segmented', role: 'tablist' });
    PLAN.days.forEach((d) => {
      const btn = el('button', {
        class: 'seg' + (d.id === state.dayId ? ' active' : ''),
        onclick: () => setState({ dayId: d.id, exerciseCode: null })
      }, [d.id.toUpperCase().replace('DAY', 'D')]);
      wrap.appendChild(btn);
    });
    scope.appendChild(wrap);
  }

  function rxCells(rx) {
    if (!rx) return el('div', { class: 'muted', style: 'font-size:13px' }, ['No prescription for this week.']);
    const grid = el('div', { class: 'rx' });
    grid.appendChild(el('div', { class: 'rx-cell' }, [el('div', { class: 'rx-k' }, ['Sets']), el('div', { class: 'rx-v' }, [String(rx.sets)])]));
    grid.appendChild(el('div', { class: 'rx-cell' }, [el('div', { class: 'rx-k' }, ['Tempo']), el('div', { class: 'rx-v' }, [rx.tempo])]));
    grid.appendChild(el('div', { class: 'rx-cell' }, [el('div', { class: 'rx-k' }, ['Reps']), el('div', { class: 'rx-v' }, [rx.reps])]));
    grid.appendChild(el('div', { class: 'rx-cell' }, [el('div', { class: 'rx-k' }, ['Rest']), el('div', { class: 'rx-v' }, [`${rx.rest}s`])]));
    return grid;
  }

  function isExerciseDone(date, dayId, code, week) {
    const e = findEntry(date, dayId, code, week);
    if (!e) return false;
    return !!e.completed;
  }

  function buildVideoCard(ex) {
    if (!ex.wistiaId && !ex.videoSlug) return null;
    const card = el('div', { class: 'card video-card' });
    if (ex.wistiaId) {
      // Lazy-load: show poster + tap-to-play, then swap in the iframe.
      const frame = el('div', { class: 'video-frame', role: 'button', 'aria-label': `Play ${ex.name} demo` });
      const thumb = el('img', {
        class: 'vthumb',
        loading: 'lazy',
        alt: '',
        src: `https://embed-ssl.wistia.com/deliveries/${ex.wistiaId}.jpg?image_crop_resized=640x360`
      });
      // If the named-deliveries thumb 404s, swap to the embed/medias thumbnail endpoint.
      thumb.onerror = () => { thumb.src = `https://fast.wistia.com/embed/medias/${ex.wistiaId}/swatch`; };
      const play = el('button', { class: 'vplay', 'aria-label': 'Play video' }, ['▶']);
      frame.appendChild(thumb);
      frame.appendChild(play);
      const activate = () => {
        const iframe = el('iframe', {
          src: `https://fast.wistia.net/embed/iframe/${ex.wistiaId}?playerColor=f5b400&autoPlay=true&playsinline=true`,
          allow: 'autoplay; fullscreen; picture-in-picture',
          allowfullscreen: '',
          title: `${ex.name} demo`
        });
        frame.innerHTML = '';
        frame.appendChild(iframe);
      };
      frame.addEventListener('click', activate);
      play.addEventListener('click', (e) => { e.stopPropagation(); activate(); });
      card.appendChild(frame);
    } else {
      // Slug exists but no Wistia ID found — fall back to a link to the page.
      card.appendChild(el('div', { class: 'video-fallback' }, [
        el('span', null, ['Watch on Infinity Fitness → ']),
        el('a', {
          href: `https://www.infinityfitness.com/video/${ex.videoSlug}/`,
          target: '_blank',
          rel: 'noopener'
        }, [ex.videoSlug.replace(/-/g, ' ')])
      ]));
    }
    if (ex.videoSlug) {
      card.appendChild(el('div', { class: 'video-meta' }, [
        el('span', null, ['Demo · Infinity Fitness']),
        el('a', {
          href: `https://www.infinityfitness.com/video/${ex.videoSlug}/`,
          target: '_blank',
          rel: 'noopener'
        }, ['Open page ↗'])
      ]));
    }
    return card;
  }

  function buildDailyCard(date) {
    const d = getDaily(date);
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title' }, [
      el('span', null, ['Today']),
      el('span', { class: 'muted', style: 'font-size:12px;font-weight:600' }, [date])
    ]));
    const grid = el('div', { class: 'meta-grid' });

    const bw = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: 'lb', value: d.bodyWeight || '' });
    bw.oninput = () => { setDaily(date, { bodyWeight: bw.value }); };
    grid.appendChild(el('div', null, [el('span', { class: 'label' }, ['Body weight']), bw]));

    const energy = el('input', { type: 'number', inputmode: 'numeric', min: '1', max: '10', placeholder: '1–10', value: d.energy || '' });
    energy.oninput = () => { setDaily(date, { energy: energy.value }); };
    grid.appendChild(el('div', null, [el('span', { class: 'label' }, ['Energy 1–10']), energy]));

    const pain = el('input', { type: 'number', inputmode: 'numeric', min: '0', max: '10', placeholder: '0–10', value: d.painStrain || '' });
    pain.oninput = () => { setDaily(date, { painStrain: pain.value }); };
    grid.appendChild(el('div', null, [el('span', { class: 'label' }, ['Pain / strain']), pain]));

    const notes = el('input', { type: 'text', placeholder: 'How you feel today (optional)', value: d.notes || '' });
    notes.oninput = () => { setDaily(date, { notes: notes.value }); };
    const notesWrap = el('div', { class: 'full' }, [el('span', { class: 'label' }, ['Daily note']), notes]);
    grid.appendChild(notesWrap);

    card.appendChild(grid);
    return card;
  }

  // ----- PLAN -----
  function viewPlan() {
    const view = $('#view');
    view.innerHTML = '';

    const segWrap = el('div', { class: 'card', style: 'padding:8px' });
    renderDaySegmented(segWrap);
    view.appendChild(segWrap);

    const day = findDay(state.dayId);
    const date = todayISO();

    view.appendChild(buildDailyCard(date));
    const total = day.exercises.length;
    const doneCount = day.exercises.filter((ex) => isExerciseDone(date, day.id, ex.code, state.week)).length;
    const pct = total ? Math.round((doneCount / total) * 100) : 0;

    const headCard = el('div', { class: 'card' }, [
      el('div', { class: 'h-section' }, [
        el('h2', null, [day.name]),
        el('div', { class: 'h-right' }, [`${doneCount}/${total} done · today`])
      ]),
      el('div', { class: 'progress' }, [el('span', { style: `width:${pct}%` })])
    ]);
    view.appendChild(headCard);

    const list = el('div', null);
    day.exercises.forEach((ex) => {
      const rx = findRx(ex, state.week);
      const done = isExerciseDone(date, day.id, ex.code, state.week);
      const nameRow = el('div', { class: 'ex-name' });
      nameRow.appendChild(document.createTextNode(ex.name));
      if (ex.wistiaId) nameRow.appendChild(el('span', { class: 'ex-vbadge', 'aria-label': 'Has video' }, ['▶']));
      const row = el('button', {
        class: 'exercise-row' + (done ? ' done' : ''),
        onclick: () => setState({ tab: 'log', exerciseCode: ex.code })
      }, [
        el('div', { class: 'ex-left' }, [
          el('div', { class: 'ex-code' }, [ex.code]),
          el('div', null, [
            nameRow,
            ex.notes ? el('div', { class: 'ex-notes' }, [ex.notes]) : null
          ])
        ]),
        el('div', { class: 'ex-meta' }, [rx ? `${rx.sets}×${rx.reps} · ${rx.rest}s` : '—'])
      ]);
      list.appendChild(row);
    });
    view.appendChild(list);
  }

  // ----- LOG -----
  function viewLog() {
    const view = $('#view');
    view.innerHTML = '';

    const day = findDay(state.dayId);

    // Day segmented at top
    const segCard = el('div', { class: 'card', style: 'padding:8px' });
    renderDaySegmented(segCard);
    view.appendChild(segCard);

    // If no exercise picked, show exercise picker
    if (!state.exerciseCode) {
      const head = el('div', { class: 'card' }, [
        el('div', { class: 'h-section' }, [
          el('h2', null, ['Choose exercise']),
          el('div', { class: 'h-right' }, [`Week ${state.week}`])
        ]),
        el('div', { class: 'muted', style: 'font-size:13px' }, ['Pick the exercise to log. Prescription auto-loads.'])
      ]);
      view.appendChild(head);

      const list = el('div', null);
      day.exercises.forEach((ex) => {
        const rx = findRx(ex, state.week);
        const date = todayISO();
        const done = isExerciseDone(date, day.id, ex.code, state.week);
        const row = el('button', {
          class: 'exercise-row' + (done ? ' done' : ''),
          onclick: () => setState({ exerciseCode: ex.code })
        }, [
          el('div', { class: 'ex-left' }, [
            el('div', { class: 'ex-code' }, [ex.code]),
            el('div', null, [
              el('div', { class: 'ex-name' }, [ex.name]),
              ex.notes ? el('div', { class: 'ex-notes' }, [ex.notes]) : null
            ])
          ]),
          el('div', { class: 'ex-meta' }, [rx ? `${rx.sets}×${rx.reps}` : '—'])
        ]);
        list.appendChild(row);
      });
      view.appendChild(list);
      return;
    }

    // Exercise log form
    const ex = findExercise(day, state.exerciseCode);
    const rx = findRx(ex, state.week);

    const back = el('div', { class: 'back-row' }, [
      el('button', { class: 'back-btn ghost', onclick: () => setState({ exerciseCode: null }) }, ['‹ Exercises'])
    ]);
    view.appendChild(back);

    // Read or seed entry for today
    const date = todayISO();
    let entry = findEntry(date, day.id, ex.code, state.week);
    if (!entry) {
      entry = {
        date,
        dayId: day.id,
        exerciseCode: ex.code,
        week: state.week,
        notes: '',
        completed: false,
        sets: Array.from({ length: rx ? rx.sets : 3 }, () => ({ weight: '', reps: '', rpe: '', done: false }))
      };
    } else {
      // adjust set count to match rx if changed
      const target = rx ? rx.sets : entry.sets.length;
      while (entry.sets.length < target) entry.sets.push({ weight: '', reps: '', rpe: '', done: false });
      if (entry.sets.length > target) entry.sets = entry.sets.slice(0, target);
    }

    function persist() {
      entry.completed = entry.sets.every((s) => s.done);
      upsertEntry(entry);
      // Re-render header progress lightly
      renderTopSub();
    }

    // Header card with exercise + rx
    const titleRow = el('div', { class: 'card-title' }, [
      el('span', null, [`${ex.code} · ${ex.name}`]),
      el('span', { class: 'muted', style: 'font-size:12px;font-weight:600' }, [`W${state.week}`])
    ]);
    const headCard = el('div', { class: 'card' }, [
      titleRow,
      ex.notes ? el('div', { class: 'muted', style: 'font-size:13px;margin:-4px 0 8px 0' }, [ex.notes]) : null,
      rxCells(rx)
    ]);
    view.appendChild(headCard);

    // Video card (lazy-loaded)
    const videoCard = buildVideoCard(ex);
    if (videoCard) view.appendChild(videoCard);

    // Date is per-exercise; daily metrics (body weight, energy, pain/strain) are shared per date.
    const metaCard = el('div', { class: 'card' });
    metaCard.appendChild(el('div', { class: 'card-title' }, [
      el('span', null, ['Session date']),
      el('span', { class: 'muted', style: 'font-size:12px;font-weight:600' }, ['Daily metrics in Plan tab'])
    ]));
    const dateInput = el('input', { type: 'date', value: entry.date });
    dateInput.oninput = () => { entry.date = dateInput.value || todayISO(); persist(); };
    metaCard.appendChild(dateInput);
    view.appendChild(metaCard);

    // Sets table
    const setsCard = el('div', { class: 'card' });
    setsCard.appendChild(el('div', { class: 'card-title' }, [
      el('span', null, ['Sets']),
      el('span', { class: 'muted', style: 'font-size:12px;font-weight:600' }, [`${entry.sets.length} prescribed`])
    ]));

    const grid = el('div', { class: 'sets' });
    grid.appendChild(el('div', { class: 'h' }, ['#']));
    grid.appendChild(el('div', { class: 'h' }, ['Weight']));
    grid.appendChild(el('div', { class: 'h' }, ['Reps']));
    grid.appendChild(el('div', { class: 'h' }, ['RPE']));
    grid.appendChild(el('div', { class: 'h' }, ['✓']));

    entry.sets.forEach((s, i) => {
      const num = el('div', { class: 'setnum' }, [String(i + 1)]);
      const wInp = el('input', { type: 'number', inputmode: 'decimal', step: '0.5', placeholder: '—', value: s.weight ?? '' });
      const rInp = el('input', { type: 'number', inputmode: 'numeric', placeholder: '—', value: s.reps ?? '' });
      const rpeInp = el('input', { type: 'number', inputmode: 'decimal', step: '0.5', min: '1', max: '10', placeholder: '—', value: s.rpe ?? '' });
      const chk = el('button', { class: 'check' + (s.done ? ' on' : ''), 'aria-label': `Mark set ${i+1} done` }, [s.done ? '✓' : '○']);

      wInp.oninput = () => { s.weight = wInp.value; persist(); };
      rInp.oninput = () => { s.reps = rInp.value; persist(); };
      rpeInp.oninput = () => { s.rpe = rpeInp.value; persist(); };
      chk.onclick = () => {
        s.done = !s.done;
        chk.classList.toggle('on', s.done);
        chk.textContent = s.done ? '✓' : '○';
        persist();
        // also visually update progress on plan tab next render
      };

      grid.appendChild(num);
      grid.appendChild(wInp);
      grid.appendChild(rInp);
      grid.appendChild(rpeInp);
      grid.appendChild(chk);
    });
    setsCard.appendChild(grid);

    const setActions = el('div', { class: 'row', style: 'margin-top:10px' }, [
      el('button', { class: 'ghost', onclick: () => {
        entry.sets.push({ weight: '', reps: '', rpe: '', done: false });
        persist();
        render();
      }}, ['+ Add set']),
      el('button', { class: 'ghost', onclick: () => {
        if (entry.sets.length > 1) { entry.sets.pop(); persist(); render(); }
      }}, ['– Remove set'])
    ]);
    setsCard.appendChild(setActions);

    view.appendChild(setsCard);

    // Notes
    const notesCard = el('div', { class: 'card' });
    notesCard.appendChild(el('div', { class: 'card-title' }, ['Notes']));
    const notes = el('textarea', { rows: '3', placeholder: 'How it felt, technique cues, pain notes…' });
    notes.value = entry.notes || '';
    notes.oninput = () => { entry.notes = notes.value; persist(); };
    notesCard.appendChild(notes);
    view.appendChild(notesCard);

    // Action: complete + saved indicator
    const allDone = entry.sets.every((s) => s.done);
    const completeBtn = el('button', {
      class: 'primary',
      style: 'width:100%;margin-top:4px',
      onclick: () => {
        const target = !allDone;
        entry.sets.forEach((s) => s.done = target);
        persist();
        toast(target ? 'Exercise complete' : 'Marked incomplete');
        render();
      }
    }, [allDone ? 'Mark all incomplete' : 'Mark all sets complete']);
    view.appendChild(completeBtn);

    // Persist initial seed if new
    persist();
  }

  // ----- HISTORY -----
  function viewHistory() {
    const view = $('#view');
    view.innerHTML = '';

    const head = el('div', { class: 'card' }, [
      el('div', { class: 'h-section' }, [
        el('h2', null, ['History']),
        el('div', { class: 'h-right' }, [`${entries.length} entries`])
      ]),
      el('div', { class: 'row' }, [
        el('button', { class: 'ghost', onclick: exportJSON }, ['Export JSON']),
        el('button', { class: 'ghost', onclick: exportCSV }, ['Export CSV'])
      ])
    ]);
    view.appendChild(head);

    if (entries.length === 0) {
      view.appendChild(el('div', { class: 'card muted', style: 'text-align:center;font-size:14px' }, ['No logged sessions yet. Tap Log to start.']));
      return;
    }

    const sorted = entries.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || 0) - (a.updatedAt || 0));
    const list = el('div', { class: 'hist' });
    sorted.forEach((e) => {
      const day = findDay(e.dayId);
      const ex = findExercise(day, e.exerciseCode);
      const item = el('div', { class: 'hist-item' });
      item.appendChild(el('header', null, [
        el('div', { class: 'h-title' }, [`${e.exerciseCode} · ${ex ? ex.name : ''}`]),
        el('div', { class: 'h-date' }, [`${e.date} · W${e.week}`])
      ]));
      item.appendChild(el('div', { class: 'h-ex' }, [`${day ? day.name.split('—')[0].trim() : e.dayId}${e.completed ? ' · ✓ complete' : ''}`]));

      const setsWrap = el('div', { class: 'h-sets' });
      (e.sets || []).forEach((s, i) => {
        const parts = [];
        if (s.weight) parts.push(`${s.weight}`);
        if (s.reps) parts.push(`×${s.reps}`);
        if (s.rpe) parts.push(`@${s.rpe}`);
        const text = parts.length ? parts.join(' ') : '—';
        setsWrap.appendChild(el('span', { class: 'chip' }, [`#${i+1} ${text}`]));
      });
      item.appendChild(setsWrap);

      if (e.notes) {
        item.appendChild(el('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, [e.notes]));
      }

      item.appendChild(el('div', { class: 'row', style: 'margin-top:10px' }, [
        el('button', { class: 'ghost', onclick: () => setState({ tab: 'log', dayId: e.dayId, week: e.week, exerciseCode: e.exerciseCode }) }, ['Open']),
        el('button', { class: 'danger', onclick: () => {
          if (confirm('Delete this entry?')) { deleteEntry(e.key); render(); toast('Deleted'); }
        }}, ['Delete'])
      ]));

      list.appendChild(item);
    });
    view.appendChild(list);
  }

  // ----- APP -----
  function viewApp() {
    const view = $('#view');
    view.innerHTML = '';

    // Stats
    const sessions = new Set(entries.map((e) => e.date)).size;
    const totalSets = entries.reduce((n, e) => n + (e.sets ? e.sets.filter((s) => s.done).length : 0), 0);
    const completedExercises = entries.filter((e) => e.completed).length;

    const stats = el('div', { class: 'card' }, [
      el('div', { class: 'card-title' }, ['Stats']),
      el('div', { class: 'kv' }, [el('span', { class: 'k' }, ['Program']), el('span', { class: 'v' }, [PLAN.program])]),
      el('div', { class: 'kv' }, [el('span', { class: 'k' }, ['Sessions logged']), el('span', { class: 'v' }, [String(sessions)])]),
      el('div', { class: 'kv' }, [el('span', { class: 'k' }, ['Sets completed']), el('span', { class: 'v' }, [String(totalSets)])]),
      el('div', { class: 'kv' }, [el('span', { class: 'k' }, ['Exercises complete']), el('span', { class: 'v' }, [String(completedExercises)])])
    ]);
    view.appendChild(stats);

    // Data
    const data = el('div', { class: 'card' }, [
      el('div', { class: 'card-title' }, ['Data']),
      el('div', { class: 'row' }, [
        el('button', { class: 'ghost', onclick: exportJSON }, ['Export JSON']),
        el('button', { class: 'ghost', onclick: exportCSV }, ['Export CSV'])
      ]),
      el('div', { class: 'row', style: 'margin-top:8px' }, [
        (function() {
          const wrap = el('label', { class: 'ghost', style: 'display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:12px;padding:12px 16px;font-size:15px;min-height:44px;cursor:pointer' }, ['Import JSON']);
          const inp = el('input', { type: 'file', accept: 'application/json', style: 'display:none' });
          inp.onchange = () => { if (inp.files && inp.files[0]) importJSON(inp.files[0]); };
          wrap.appendChild(inp);
          return wrap;
        })(),
        el('button', { class: 'danger', onclick: () => {
          if (confirm('Erase ALL local logs? This cannot be undone.')) {
            entries = []; saveEntries(entries); toast('Cleared'); render();
          }
        }}, ['Clear all'])
      ])
    ]);
    view.appendChild(data);

    // Cloud — sync across devices
    const cloud = el('div', { class: 'card' });
    const cloudHead = el('div', { class: 'card-title' }, [
      el('span', null, ['Sync across devices']),
      (function() {
        const badge = el('span', { class: `sync-badge sync-${syncStatus}` }, [syncStatusLabel()]);
        onSyncChange(() => {
          badge.className = `sync-badge sync-${syncStatus}`;
          badge.textContent = syncStatusLabel();
        });
        return badge;
      })()
    ]);
    cloud.appendChild(cloudHead);
    cloud.appendChild(el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:10px' }, [
      'Free Supabase keeps your iPhone, MacBook, and Mac Studio in sync. Local storage stays the source of truth — cloud is the backup.'
    ]));

    const stack = el('div', { class: 'stack' });
    const fields = [
      { k: 'supabaseUrl', label: 'Project URL', placeholder: 'https://xxxx.supabase.co', required: true },
      { k: 'supabaseAnonKey', label: 'Anon (public) key', placeholder: 'eyJhbGc…', required: true, type: 'password' },
      { k: 'supabaseTable', label: 'Entries table', placeholder: 'workout_entries' },
      { k: 'dailyTable', label: 'Daily metrics table', placeholder: 'workout_daily' },
      { k: 'userId', label: 'User id (optional, multi-user only)', placeholder: 'melvin' }
    ];
    fields.forEach((f) => {
      const inp = el('input', { type: f.type || 'text', placeholder: f.placeholder, value: settings[f.k] || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
      inp.oninput = () => { settings[f.k] = inp.value.trim(); save(STORAGE.settings, settings); };
      const labelText = f.required ? `${f.label} *` : f.label;
      stack.appendChild(el('div', null, [el('span', { class: 'label' }, [labelText]), inp]));
    });

    // Auto-sync toggle
    const autoRow = el('label', { class: 'switch-row' });
    const autoCb = el('input', { type: 'checkbox' });
    autoCb.checked = !!settings.autoSync;
    autoCb.onchange = () => { settings.autoSync = autoCb.checked; save(STORAGE.settings, settings); if (autoCb.checked) startSync(); };
    autoRow.appendChild(autoCb);
    autoRow.appendChild(el('span', null, ['Auto-sync changes (recommended)']));
    stack.appendChild(autoRow);

    // Realtime toggle
    const rtRow = el('label', { class: 'switch-row' });
    const rtCb = el('input', { type: 'checkbox' });
    rtCb.checked = !!settings.realtimeSync;
    rtCb.onchange = () => {
      settings.realtimeSync = rtCb.checked;
      save(STORAGE.settings, settings);
      if (rtCb.checked) rtConnect(); else rtDisconnect();
    };
    rtRow.appendChild(rtCb);
    rtRow.appendChild(el('span', null, ['Live sync via Realtime (push notifications between devices)']));
    stack.appendChild(rtRow);

    cloud.appendChild(stack);

    // Live status row: queue size + device id
    const queueLine = el('div', { class: 'muted', style: 'font-size:12px;margin-top:10px;display:flex;justify-content:space-between;gap:8px' }, [
      el('span', null, [`Queue: ${outbox.length} pending`]),
      el('span', null, [`Device: ${syncMeta.deviceId.slice(0, 8)}…`])
    ]);
    onSyncChange(() => {
      const qSpan = queueLine.firstChild;
      if (qSpan) qSpan.textContent = `Queue: ${outbox.length} pending`;
    });
    cloud.appendChild(queueLine);

    cloud.appendChild(el('div', { class: 'row', style: 'margin-top:10px' }, [
      el('button', { class: 'ghost', onclick: testCloudConnection }, ['Run diagnostics']),
      el('button', { class: 'ghost', onclick: () => syncCloudPull() }, ['Pull now']),
      el('button', { class: 'primary', onclick: syncCloudPushAll }, ['Push all'])
    ]));

    // Status detail (full message, multi-line OK)
    const statusLine = el('div', { class: 'muted', style: 'font-size:12px;margin-top:8px;word-break:break-word' }, [syncMessage || '—']);
    onSyncChange(() => { statusLine.textContent = syncMessage || '—'; });
    cloud.appendChild(statusLine);

    cloud.appendChild(el('div', { class: 'muted', style: 'font-size:12px;margin-top:10px;line-height:1.5' }, [
      el('strong', null, ['Setup: ']),
      'In Supabase → SQL Editor, run the schema in README.md once. Paste your Project URL and anon key above. Tap Run diagnostics. Done — every change syncs in the background.'
    ]));
    view.appendChild(cloud);

    // Install
    const inst = el('div', { class: 'card' }, [
      el('div', { class: 'card-title' }, ['Install on iPhone']),
      el('ol', { style: 'padding-left:18px;margin:0;line-height:1.5;font-size:14px' }, [
        el('li', null, ['Open this page in Safari.']),
        el('li', null, ['Tap the Share button.']),
        el('li', null, ['Choose "Add to Home Screen".']),
        el('li', null, ['Open from your home screen for the full app feel.'])
      ])
    ]);
    view.appendChild(inst);

    // Version
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'kv' }, [el('span', { class: 'k' }, ['App version']), el('span', { class: 'v' }, [APP_VERSION])]),
      el('div', { class: 'kv' }, [el('span', { class: 'k' }, ['Source']), el('span', { class: 'v' }, ['Infinity Fitness — M Tucker A'])])
    ]));
  }

  function syncStatusLabel() {
    if (!cloudReady()) return 'Off';
    if (syncStatus === 'syncing') return syncMessage || 'Syncing…';
    if (syncStatus === 'queued') return syncMessage || 'Queued';
    if (syncStatus === 'ok') return syncMessage || 'Synced';
    if (syncStatus === 'error') return 'Error';
    return 'Ready';
  }

  // ---------- Router ----------
  function render() {
    renderWeekSelect();
    renderTabs();
    renderTopSub();
    if (state.tab === 'plan') return viewPlan();
    if (state.tab === 'log') return viewLog();
    if (state.tab === 'history') return viewHistory();
    if (state.tab === 'app') return viewApp();
    viewPlan();
  }

  // initial render
  render();

  // ---- Sync lifecycle ----
  function startSync() {
    if (!cloudReady()) { setSyncStatus('off', ''); return; }
    setSyncStatus(outbox.length ? 'queued' : 'idle', outbox.length ? `${outbox.length} queued` : 'Ready');
    // Drain any queued writes from a previous session
    if (outbox.length && settings.autoSync) scheduleDrain(0);
    // Initial pull
    if (settings.autoSync) syncCloudPull({ silent: true });
    // Realtime push
    if (settings.realtimeSync) rtConnect();
    // Polling backup
    startPolling();
  }
  startSync();

  // Foreground: pull, then drain queue
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      render();
      if (cloudReady() && settings.autoSync) {
        syncCloudPull({ silent: true });
        if (outbox.length) scheduleDrain(0);
        if (settings.realtimeSync && (!rtSocket || rtSocket.readyState !== 1)) rtConnect();
      }
    }
  });

  // Best-effort flush on backgrounding (sendBeacon would be nicer but keeps the API simple)
  window.addEventListener('pagehide', () => { if (outbox.length && cloudReady()) drainOutbox(); });

  // Network recovery: drain queue + pull
  window.addEventListener('online', () => {
    if (cloudReady() && settings.autoSync) {
      scheduleDrain(0);
      syncCloudPull({ silent: true });
      if (settings.realtimeSync) rtConnect();
    }
  });
  window.addEventListener('offline', () => {
    setSyncStatus('queued', `Offline · ${outbox.length} queued`);
  });

  // Cross-tab: if another tab on the same browser writes, react
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE.entries) entries = loadEntries();
    else if (e.key === STORAGE.daily) daily = loadDaily();
    else if (e.key === STORAGE.outbox) outbox = loadOutbox();
    else return;
    render();
  });
})();
