import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { API } from './config';
import { fetchT } from './net';
import type { MealType, ScanResult } from './types';

export type GateConfig = { cafeteria: number; gate: number };
export type StaffSession = {
  accessToken: string;
  id: number;
  email: string;
  full_name: string;
  cafeteria_id: number;
  gate: number;
};

export type SyncData = {
  students: { id: string; full_name: string; department: string | null; is_active: number }[];
  windows: { meal_type: string; start_time: string; end_time: string }[];
  menu: { day_of_week: number; meal_type: string; menu_name: string }[];
  logs: { student_id: string; meal_type: string; meal_date: string; scanned_at: string }[];
};

type LoginResponse = {
  token: string;
  staff: Omit<StaffSession, 'accessToken'>;
  data: SyncData;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('meal_card.db');
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS students (
          id TEXT PRIMARY KEY, full_name TEXT NOT NULL, department TEXT, is_active INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meal_windows (
          meal_type TEXT PRIMARY KEY, start_time TEXT NOT NULL, end_time TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS weekly_menu (
          day_of_week INTEGER NOT NULL, meal_type TEXT NOT NULL, menu_name TEXT NOT NULL,
          PRIMARY KEY (day_of_week, meal_type)
        );
        CREATE TABLE IF NOT EXISTS local_logs (
          student_id TEXT NOT NULL, meal_type TEXT NOT NULL, meal_date TEXT NOT NULL,
          scanned_at TEXT NOT NULL, method TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (student_id, meal_type, meal_date)
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

// Ethiopia is UTC+3 with no daylight saving, so a fixed offset is enough
function ethiopiaNow() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  const iso = d.toISOString(); // shifted time, read as UTC
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 19),
    day: d.getUTCDay() === 0 ? 7 : d.getUTCDay(),
    dateTime: `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
  };
}

/* ---------- this phone's gate ---------- */
export async function getGate(): Promise<GateConfig | null> {
  const db = await getDb();
  const c = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'cafeteria'");
  const g = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'gate'");
  if (!c || !g) return null;
  return { cafeteria: Number(c.value), gate: Number(g.value) };
}

export async function loadSession(): Promise<StaffSession | null> {
  const raw = await SecureStore.getItemAsync('staff_session');
  if (!raw) return null;
  const session = JSON.parse(raw) as StaffSession;
  if (
    typeof session.accessToken !== 'string' ||
    !Number.isInteger(session.cafeteria_id) ||
    !Number.isInteger(session.gate)
  ) {
    throw new Error('Saved sign-in data is invalid. Sign in again.');
  }
  return session;
}

export async function saveSession(session: StaffSession): Promise<void> {
  await SecureStore.setItemAsync('staff_session', JSON.stringify(session));
}

export async function authenticateStaff(
  email: string,
  password: string
): Promise<
  | { ok: true; session: StaffSession; data: SyncData }
  | { ok: false; reason: 'network' | 'invalid' | 'inactive' | 'occupied' | 'unassigned' | 'error' }
> {
  try {
    const res = await fetchT(
      `${API}/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      },
      15000
    );
    if (res.status === 401) return { ok: false, reason: 'invalid' };
    if (res.status === 409) return { ok: false, reason: 'occupied' };
    if (res.status === 403) {
      const body = await res.json();
      return { ok: false, reason: body.status === 'ACCOUNT_INACTIVE' ? 'inactive' : 'unassigned' };
    }
    if (!res.ok) return { ok: false, reason: 'error' };

    const body = (await res.json()) as LoginResponse;
    return {
      ok: true,
      session: { ...body.staff, accessToken: body.token },
      data: body.data
    };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export async function applyLoginData(
  session: StaffSession,
  data: SyncData,
  resetLogs: boolean
): Promise<void> {
  await apply({ cafeteria: session.cafeteria_id, gate: session.gate }, data, resetLogs);
}

export async function logoutStaff(accessToken: string): Promise<boolean> {
  try {
    const res = await fetchT(
      `${API}/auth/logout`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
      15000
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearLocalSession(): Promise<void> {
  if ((await pendingCount()) > 0) throw new Error('Cannot clear local data while scans are unsynced.');
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM local_logs');
    await db.runAsync('DELETE FROM students');
    await db.runAsync('DELETE FROM meal_windows');
    await db.runAsync('DELETE FROM weekly_menu');
    await db.runAsync('DELETE FROM settings');
  });
  await SecureStore.deleteItemAsync('staff_session');
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM local_logs WHERE synced = 0');
  return r?.n ?? 0;
}

/* ---------- download ---------- */
async function download(accessToken: string): Promise<SyncData | null> {
  try {
    const res = await fetchT(
      `${API}/sync/data`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      15000
    );
    if (!res.ok) return null;
    return (await res.json()) as SyncData;
  } catch {
    return null;
  }
}

async function apply(cfg: GateConfig, d: SyncData, resetLogs: boolean) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    if (resetLogs) await db.runAsync('DELETE FROM local_logs');

    await db.runAsync('DELETE FROM students');
    for (const s of d.students) {
      await db.runAsync(
        'INSERT INTO students (id, full_name, department, is_active) VALUES (?, ?, ?, ?)',
        [s.id, s.full_name, s.department, s.is_active]
      );
    }

    await db.runAsync('DELETE FROM meal_windows');
    for (const w of d.windows) {
      await db.runAsync('INSERT INTO meal_windows VALUES (?, ?, ?)', [w.meal_type, w.start_time, w.end_time]);
    }

    await db.runAsync('DELETE FROM weekly_menu');
    for (const m of d.menu) {
      await db.runAsync('INSERT INTO weekly_menu VALUES (?, ?, ?)', [m.day_of_week, m.meal_type, m.menu_name]);
    }

    // scans the server already has for today (unsent local scans stay untouched)
    for (const l of d.logs) {
      await db.runAsync('INSERT OR IGNORE INTO local_logs VALUES (?, ?, ?, ?, ?, 1)', [
        l.student_id, l.meal_type, l.meal_date, l.scanned_at, 'qr'
      ]);
    }
    // keep the table small
    await db.runAsync("DELETE FROM local_logs WHERE synced = 1 AND meal_date < date('now', '-2 days')");

    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('cafeteria', ?)", [String(cfg.cafeteria)]);
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('gate', ?)", [String(cfg.gate)]);
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_sync', ?)", [String(Date.now())]);
  });
}

/** Refresh the local copy for the gate that is already set. */
export async function syncDown(): Promise<boolean> {
  const [session, cfg] = await Promise.all([loadSession(), getGate()]);
  if (!session || !cfg) return false;
  const data = await download(session.accessToken);
  if (!data) return false;
  await apply(cfg, data, false);
  return true;
}

/** Download only if the local copy is older than maxAgeMs. */
export async function syncDownIfStale(maxAgeMs: number): Promise<boolean> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'last_sync'");
  const age = r ? Date.now() - Number(r.value) : Infinity;
  if (age < maxAgeMs) return true;
  return syncDown();
}

/* ---------- upload offline scans ---------- */
export async function syncUp(): Promise<boolean> {
  try {
    const session = await loadSession();
    if (!session) return false;

    const db = await getDb();
    const rows = await db.getAllAsync<{
      student_id: string; meal_type: string; meal_date: string; scanned_at: string; method: string;
    }>('SELECT * FROM local_logs WHERE synced = 0');
    if (rows.length === 0) return true; // nothing to send, no network call

    const res = await fetchT(
      `${API}/sync/scans`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({
          scans: rows.map((r: { student_id: any; meal_type: any; meal_date: any; scanned_at: any; method: any; }) => ({
            studentId: r.student_id, mealType: r.meal_type, mealDate: r.meal_date,
            scannedAt: r.scanned_at, method: r.method
          }))
        })
      },
      15000
    );
    if (!res.ok) return false;
    const result = await res.json() as { accepted?: number; skipped?: number };
    if (result.accepted !== rows.length || result.skipped !== 0) return false;

    // mark only the rows that were sent
    await db.withTransactionAsync(async () => {
      for (const r of rows) {
        await db.runAsync(
          'UPDATE local_logs SET synced = 1 WHERE student_id = ? AND meal_type = ? AND meal_date = ?',
          [r.student_id, r.meal_type, r.meal_date]
        );
      }
    });
    return true;
  } catch {
    return false;
  }
}

/* ---------- remember what the server decided, so offline mode agrees with it ---------- */
export async function saveOnlineScan(
  studentId: string,
  mealType: MealType,
  mealDate: string,
  method: string,
  scannedAt?: string
) {
  const db = await getDb();
  await db.runAsync('INSERT OR IGNORE INTO local_logs VALUES (?, ?, ?, ?, ?, 1)', [
    studentId, mealType, mealDate, scannedAt ?? ethiopiaNow().dateTime, method
  ]);
}

/* ---------- decide a scan with no server ---------- */
export async function scanOffline(studentId: string, method: 'qr' | 'manual'): Promise<ScanResult> {
  const db = await getDb();
  const { date, time, day, dateTime } = ethiopiaNow();

  const win = await db.getFirstAsync<{ meal_type: MealType }>(
    'SELECT meal_type FROM meal_windows WHERE start_time <= ? AND ? <= end_time',
    [time, time]
  );
  if (!win) return { status: 'CLOSED' };

  const menu = await db.getFirstAsync<{ menu_name: string }>(
    'SELECT menu_name FROM weekly_menu WHERE day_of_week = ? AND meal_type = ?',
    [day, win.meal_type]
  );
  const meal = { meal_type: win.meal_type, date, menu_name: menu?.menu_name ?? null };

  const s = await db.getFirstAsync<{ id: string; full_name: string; department: string | null; is_active: number }>(
    'SELECT * FROM students WHERE id = ?',
    [studentId]
  );
  // not on this gate's list: wrong gate, or an unknown ID (the phone cannot tell which)
  if (!s) return { status: 'WRONG_GATE', meal };

  const student = { ...s, photo_url: null };
  if (!s.is_active) return { status: 'INACTIVE', student, meal };

  const used = await db.getFirstAsync<{ scanned_at: string }>(
    'SELECT scanned_at FROM local_logs WHERE student_id = ? AND meal_type = ? AND meal_date = ?',
    [studentId, win.meal_type, date]
  );
  if (used) return { status: 'ALREADY_USED', student, meal, firstScan: { scanned_at: used.scanned_at } };

  await db.runAsync('INSERT INTO local_logs VALUES (?, ?, ?, ?, ?, 0)', [
    studentId, win.meal_type, date, dateTime, method
  ]);
  return { status: 'ALLOWED', student, meal };
}
