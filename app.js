// Workout Log — app.js
// Persistence: localStorage. Optional cloud sync via Supabase if configured in App tab.

(function () {
  'use strict';

  const STORAGE = {
    state: 'wlog.state.v1',
    entries: 'wlog.entries.v1',
    settings: 'wlog.settings.v1',
    daily: 'wlog.daily.v1'
  };

  const APP_VERSION = '1.3.0';

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
    autoSync: true
  };

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

  // ---------- Cloud sync (optional) ----------
  // Status: 'idle' | 'syncing' | 'ok' | 'error' | 'off'
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
    return !!(settings.supabaseUrl && settings.supabaseAnonKey && settings.supabaseTable);
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
    // user_id is nullable. If user provided one, scope reads/writes to it.
    return settings.userId ? `user_id=eq.${encodeURIComponent(settings.userId)}` : '';
  }

  // Debounced auto-push, batches multiple quick edits into a single round-trip
  const pendingEntries = new Map(); // key -> entry
  const pendingDaily = new Map();   // date -> daily row
  let pushTimer = null;
  function scheduleAutoPush() {
    if (!settings.autoSync || !cloudReady()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(flushPending, 800);
  }
  async function flushPending() {
    if (!cloudReady()) return;
    const eBatch = Array.from(pendingEntries.values());
    const dBatch = Array.from(pendingDaily.values());
    pendingEntries.clear();
    pendingDaily.clear();
    if (eBatch.length === 0 && dBatch.length === 0) return;
    setSyncStatus('syncing', 'Saving to cloud…');
    try {
      if (eBatch.length) {
        const body = eBatch.map((e) => ({
          entry_key: e.key,
          user_id: settings.userId || null,
          date: e.date,
          day_id: e.dayId,
          exercise_code: e.exerciseCode,
          week: e.week,
          payload: e,
          updated_at: new Date(e.updatedAt || Date.now()).toISOString()
        }));
        const res = await fetch(sbUrl(settings.supabaseTable), {
          method: 'POST',
          headers: sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`entries ${res.status}`);
      }
      if (dBatch.length) {
        const body = dBatch.map((d) => ({
          date: d.date,
          user_id: settings.userId || null,
          body_weight: d.bodyWeight || null,
          energy: d.energy || null,
          pain_strain: d.painStrain || null,
          notes: d.notes || null,
          payload: d,
          updated_at: new Date(d.updatedAt || Date.now()).toISOString()
        }));
        const res = await fetch(sbUrl(settings.dailyTable), {
          method: 'POST',
          headers: sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`daily ${res.status}`);
      }
      setSyncStatus('ok', `Synced ${eBatch.length + dBatch.length}`);
    } catch (e) {
      // Re-queue so we retry on next change
      eBatch.forEach((x) => pendingEntries.set(x.key, x));
      dBatch.forEach((x) => pendingDaily.set(x.date, x));
      setSyncStatus('error', String(e && e.message || e));
    }
  }

  function maybeSyncCloud(entry) {
    if (!settings.autoSync || !cloudReady()) return;
    pendingEntries.set(entry.key, entry);
    scheduleAutoPush();
  }
  function maybeSyncDaily(date, row) {
    if (!settings.autoSync || !cloudReady()) return;
    pendingDaily.set(date, Object.assign({ date }, row));
    scheduleAutoPush();
  }

  async function syncCloudPull(opts) {
    opts = opts || {};
    if (!cloudReady()) {
      if (!opts.silent) toast('Add Supabase URL and key in App tab');
      return { ok: false, reason: 'not-configured' };
    }
    setSyncStatus('syncing', 'Pulling from cloud…');
    try {
      const uf = userFilter();
      const eRes = await fetch(sbUrl(settings.supabaseTable, `select=*${uf ? '&' + uf : ''}`), { headers: sbHeaders() });
      if (!eRes.ok) throw new Error(`entries ${eRes.status}`);
      const eRows = await eRes.json();
      let mergedE = 0;
      eRows.forEach((r) => {
        const remote = r.payload;
        if (!remote) return;
        const local = entries.find((e) => e.key === r.entry_key);
        if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) {
          remote.key = r.entry_key;
          const idx = entries.findIndex((e) => e.key === remote.key);
          if (idx >= 0) entries[idx] = remote; else entries.push(remote);
          mergedE++;
        }
      });
      saveEntries(entries);

      const dRes = await fetch(sbUrl(settings.dailyTable, `select=*${uf ? '&' + uf : ''}`), { headers: sbHeaders() });
      if (!dRes.ok) throw new Error(`daily ${dRes.status}`);
      const dRows = await dRes.json();
      let mergedD = 0;
      dRows.forEach((r) => {
        const remote = r.payload || {
          bodyWeight: r.body_weight || '', energy: r.energy || '',
          painStrain: r.pain_strain || '', notes: r.notes || '',
          updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0
        };
        const cur = daily[r.date];
        if (!cur || (remote.updatedAt || 0) > (cur.updatedAt || 0)) {
          daily[r.date] = remote;
          mergedD++;
        }
      });
      saveDaily(daily);

      const total = mergedE + mergedD;
      setSyncStatus('ok', total ? `Pulled ${total} updates` : 'Up to date');
      if (!opts.silent) toast(total ? `Pulled ${total}` : 'Already up to date');
      render();
      return { ok: true, mergedE, mergedD };
    } catch (e) {
      setSyncStatus('error', String(e && e.message || e));
      if (!opts.silent) toast('Cloud pull failed');
      return { ok: false, reason: String(e && e.message || e) };
    }
  }

  async function syncCloudPushAll() {
    if (!cloudReady()) { toast('Add Supabase URL and key in App tab'); return; }
    setSyncStatus('syncing', 'Pushing all…');
    try {
      if (entries.length) {
        const body = entries.map((e) => ({
          entry_key: e.key,
          user_id: settings.userId || null,
          date: e.date,
          day_id: e.dayId,
          exercise_code: e.exerciseCode,
          week: e.week,
          payload: e,
          updated_at: new Date(e.updatedAt || Date.now()).toISOString()
        }));
        const res = await fetch(sbUrl(settings.supabaseTable), {
          method: 'POST',
          headers: sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`entries ${res.status}`);
      }
      const dailyRows = Object.keys(daily).map((date) => {
        const d = daily[date];
        return {
          date,
          user_id: settings.userId || null,
          body_weight: d.bodyWeight || null,
          energy: d.energy || null,
          pain_strain: d.painStrain || null,
          notes: d.notes || null,
          payload: Object.assign({ date }, d),
          updated_at: new Date(d.updatedAt || Date.now()).toISOString()
        };
      });
      if (dailyRows.length) {
        const res = await fetch(sbUrl(settings.dailyTable), {
          method: 'POST',
          headers: sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(dailyRows)
        });
        if (!res.ok) throw new Error(`daily ${res.status}`);
      }
      setSyncStatus('ok', `Pushed ${entries.length + dailyRows.length}`);
      toast(`Pushed ${entries.length + dailyRows.length}`);
    } catch (e) {
      setSyncStatus('error', String(e && e.message || e));
      toast('Cloud push failed');
    }
  }

  async function testCloudConnection() {
    if (!cloudReady()) { toast('Fill all 3 required fields first'); return false; }
    setSyncStatus('syncing', 'Testing…');
    try {
      // HEAD request returns row count via Content-Range header — also validates RLS+key+table
      const res = await fetch(sbUrl(settings.supabaseTable, 'select=entry_key&limit=1'), {
        headers: sbHeaders({ 'Range-Unit': 'items', 'Range': '0-0' })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${res.status} ${txt.slice(0, 120)}`);
      }
      const res2 = await fetch(sbUrl(settings.dailyTable, 'select=date&limit=1'), {
        headers: sbHeaders({ 'Range-Unit': 'items', 'Range': '0-0' })
      });
      if (!res2.ok) {
        const txt = await res2.text();
        throw new Error(`daily: ${res2.status} ${txt.slice(0, 120)}`);
      }
      setSyncStatus('ok', 'Connection OK');
      toast('Connected ✓');
      return true;
    } catch (e) {
      setSyncStatus('error', String(e && e.message || e));
      toast('Connection failed');
      return false;
    }
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
    autoCb.onchange = () => { settings.autoSync = autoCb.checked; save(STORAGE.settings, settings); };
    autoRow.appendChild(autoCb);
    autoRow.appendChild(el('span', null, ['Auto-sync changes (recommended)']));
    stack.appendChild(autoRow);

    cloud.appendChild(stack);

    cloud.appendChild(el('div', { class: 'row', style: 'margin-top:10px' }, [
      el('button', { class: 'ghost', onclick: testCloudConnection }, ['Test connection']),
      el('button', { class: 'ghost', onclick: () => syncCloudPull() }, ['Pull now']),
      el('button', { class: 'primary', onclick: syncCloudPushAll }, ['Push all'])
    ]));

    cloud.appendChild(el('div', { class: 'muted', style: 'font-size:12px;margin-top:10px;line-height:1.5' }, [
      el('strong', null, ['Setup: ']),
      'In Supabase → SQL Editor, run the schema in README.md once. Paste your Project URL and anon key above. Tap Test connection. Done — every change syncs in the background.'
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
    if (syncStatus === 'syncing') return 'Syncing…';
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

  // Initial cloud pull on load (silent) so devices receive newer data
  if (cloudReady() && settings.autoSync) {
    syncCloudPull({ silent: true });
  }

  // refresh date-based UI when app comes back to foreground; also pull cloud changes
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      render();
      if (cloudReady() && settings.autoSync) syncCloudPull({ silent: true });
    }
  });

  // Flush any pending writes when tab is hidden / app backgrounded
  window.addEventListener('pagehide', () => { if (pendingEntries.size || pendingDaily.size) flushPending(); });
  window.addEventListener('online', () => { if (cloudReady()) { flushPending(); syncCloudPull({ silent: true }); } });
})();
