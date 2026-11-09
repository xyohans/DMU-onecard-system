import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API } from '../config';
import { fetchT } from '../net';
import {
  applyLoginData,
  authenticateStaff,
  clearLocalSession,
  getGate,
  loadSession,
  logoutStaff,
  pendingCount,
  saveOnlineScan,
  saveSession,
  scanOffline,
  syncDownIfStale,
  syncUp,
  type StaffSession,
  type SyncData
} from '../offline';
import type { MealType, ScanResult, ScanStatus, StatusResponse } from '../types';

const RESULT_MS = 10000;                 // how long the result screen stays (4000-5000 suits a busy line)
const SAME_CODE_MS = 4000;               // ignore the same QR within this time
const REQUEST_TIMEOUT_MS = 3000;         // after this the phone decides offline
const STALE_MS = 24 * 60 * 60 * 1000;    // refresh the student list once a day (use 7 * 24 * 60 * 60 * 1000 for weekly)
const FRAME = 240;                       // size of the scan square
const ID_PREFIX = 'DMUUGR';              // added only to manually typed IDs, never to scanned QR codes

// replaces StyleSheet.absoluteFill / absoluteFillObject
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const C = {
  bg: '#0b1220',
  card: '#131c2e',
  border: '#1f2a40',
  text: '#f1f5f9',
  muted: '#94a3b8',
  primary: '#3b82f6',
  ok: '#16a34a',
  warn: '#d97706',
  bad: '#dc2626',
  idle: '#475569'
};

type IconName = keyof typeof Ionicons.glyphMap;

const MEAL_LABEL: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner'
};

const MEAL_ICON: Record<MealType, IconName> = {
  breakfast: 'sunny-outline',
  lunch: 'restaurant-outline',
  dinner: 'moon-outline'
};

const RESULT_UI: Record<ScanStatus, { color: string; icon: IconName; title: string; sub: string }> = {
  ALLOWED:      { color: C.ok,   icon: 'checkmark',       title: 'Approved',          sub: 'Enjoy your meal' },
  ALREADY_USED: { color: C.warn, icon: 'hand-left',       title: 'Already used',      sub: 'This meal was already taken today' },
  CLOSED:       { color: C.idle, icon: 'time',            title: 'Cafeteria closed',  sub: 'No meal is being served right now' },
  AUTH_REQUIRED:{ color: C.bad,  icon: 'lock-closed',     title: 'Sign in required',  sub: 'This staff session is no longer active' },
  NOT_FOUND:    { color: C.bad,  icon: 'close',           title: 'Not found',         sub: 'This student ID does not exist' },
  INACTIVE:     { color: C.bad,  icon: 'ban',             title: 'Not allowed',       sub: 'This student is not active' },
  WRONG_GATE:   { color: C.warn, icon: 'swap-horizontal', title: 'Wrong gate',        sub: 'This student is assigned to another gate' },
  BAD_REQUEST:  { color: C.warn, icon: 'alert',           title: 'Invalid ID',        sub: 'The ID could not be read' },
  ERROR:        { color: C.bad,  icon: 'warning',         title: 'Server error',      sub: 'Please try again' },
  NETWORK:      { color: C.bad,  icon: 'cloud-offline',   title: 'No connection',     sub: 'Cannot reach the server' }
};

type ScanView = { data: ScanResult; id: string };

/* ---------- status card ---------- */
function StatusCard({
  status,
  offline,
  onRetry
}: {
  status: StatusResponse | null;
  offline: boolean;
  onRetry: () => void;
}) {
  let icon: IconName = 'sync-outline';
  let color = C.idle;
  let title = 'Connecting…';
  let line = '';

  if (offline) {
    icon = 'cloud-offline-outline';
    color = C.warn;
    title = 'Offline mode';
    line = 'Scanning from this phone. Sent when the server is back';
  } else if (status?.open && status.current) {
    icon = MEAL_ICON[status.current.meal_type];
    color = C.ok;
    title = `${MEAL_LABEL[status.current.meal_type]} is open`;
    const time = `${status.current.start_time.slice(0, 5)} – ${status.current.end_time.slice(0, 5)}`;
    line = status.current.menu_name ? `${status.current.menu_name} · ${time}` : time;
  } else if (status) {
    icon = 'moon-outline';
    color = C.idle;
    title = 'Cafeteria closed';
    line = status.next
      ? `Next: ${MEAL_LABEL[status.next.meal_type]} at ${status.next.start_time.slice(0, 5)}`
      : 'No more meals today';
  }

  return (
    <View style={styles.statusCard}>
      <View style={[styles.statusIcon, { backgroundColor: color + '33' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.statusTitle}>{title}</Text>
        {!!line && <Text style={styles.statusLine} numberOfLines={1}>{line}</Text>}
      </View>
      {offline ? (
        <TouchableOpacity onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.dot, { backgroundColor: color }]} />
      )}
    </View>
  );
}

/* ---------- scan frame overlay ---------- */
function ScanFrame({ checking }: { checking: boolean }) {
  const [line] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(line, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(line, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [line]);

  const translateY = line.interpolate({ inputRange: [0, 1], outputRange: [0, FRAME - 4] });
  const corner = checking ? C.primary : '#ffffff';

  return (
    <View style={FILL} pointerEvents="none">
      <View style={styles.dim} />
      <View style={{ flexDirection: 'row', height: FRAME }}>
        <View style={styles.dim} />
        <View style={{ width: FRAME, height: FRAME }}>
          <View style={[styles.corner, styles.tl, { borderColor: corner }]} />
          <View style={[styles.corner, styles.tr, { borderColor: corner }]} />
          <View style={[styles.corner, styles.bl, { borderColor: corner }]} />
          <View style={[styles.corner, styles.br, { borderColor: corner }]} />
          {checking ? (
            <View style={styles.checking}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.checkingText}>Checking…</Text>
            </View>
          ) : (
            <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />
          )}
        </View>
        <View style={styles.dim} />
      </View>
      <View style={[styles.dim, { alignItems: 'center', paddingTop: 18 }]}>
        <Text style={styles.hint}>Align the student's QR code inside the frame</Text>
      </View>
    </View>
  );
}

/* ---------- result screen ---------- */
function ResultScreen({
  view,
  status,
  onClose
}: {
  view: ScanView;
  status: StatusResponse | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { data, id } = view;
  const ui = RESULT_UI[data.status] ?? RESULT_UI.ERROR;
  const s = data.student;
  const firstTime = data.firstScan?.scanned_at?.slice(11, 16);

  const [enter] = useState(() => new Animated.Value(0));
  const [progress] = useState(() => new Animated.Value(1));

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }).start();
    Animated.timing(progress, { toValue: 0, duration: RESULT_MS, easing: Easing.linear, useNativeDriver: false }).start();
  }, [enter, progress]);

  const rows: { icon: IconName; label: string; value: string }[] = [];
  if (data.meal) {
    rows.push({
      icon: MEAL_ICON[data.meal.meal_type],
      label: 'Meal',
      value: `${MEAL_LABEL[data.meal.meal_type]}${data.meal.menu_name ? ' · ' + data.meal.menu_name : ''}`
    });
  }
  if (data.status === 'ALREADY_USED' && firstTime) {
    rows.push({ icon: 'time-outline', label: 'First scanned at', value: firstTime });
  }
  if (data.status === 'WRONG_GATE' && data.assigned?.gate != null) {
    rows.push({
      icon: 'navigate-outline',
      label: 'Go to',
      value: `Cafeteria ${data.assigned.cafeteria_id} · Gate ${data.assigned.gate}`
    });
  }
  if (data.status === 'CLOSED' && status?.next) {
    rows.push({
      icon: 'calendar-outline',
      label: 'Next meal',
      value: `${MEAL_LABEL[status.next.meal_type]} at ${status.next.start_time.slice(0, 5)}`
    });
  }
  if (!s && id) {
    rows.push({ icon: 'finger-print-outline', label: 'Scanned ID', value: id });
  }

  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [30, 0] });
  const barWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Animated.View
      style={[
        styles.overlay,
        { backgroundColor: ui.color, opacity: enter, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20 }
      ]}
    >
      <Animated.View style={[styles.resultBody, { transform: [{ scale }, { translateY }] }]}>
        <View style={styles.resultIcon}>
          <Ionicons name={ui.icon} size={72} color="#fff" />
        </View>
        <Text style={styles.resultTitle}>{ui.title}</Text>
        <Text style={styles.resultSub}>{ui.sub}</Text>

        {(s || rows.length > 0) && (
          <View style={styles.infoCard}>
            {s && (
              <View style={styles.studentRow}>
                {s.photo_url ? (
                  <Image source={{ uri: s.photo_url }} style={styles.photo} />
                ) : (
                  <View style={[styles.photo, styles.avatar]}>
                    <Text style={styles.avatarText}>{s.full_name.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={2}>{s.full_name}</Text>
                  <Text style={styles.studentMeta}>{s.id}</Text>
                  {!!s.department && <Text style={styles.studentMeta} numberOfLines={1}>{s.department}</Text>}
                </View>
              </View>
            )}

            {rows.map((r, i) => (
              <View key={r.label} style={[styles.detailRow, (s || i > 0) && styles.detailBorder]}>
                <Ionicons name={r.icon} size={18} color="#64748b" />
                <Text style={styles.detailLabel}>{r.label}</Text>
                <Text style={styles.detailValue} numberOfLines={2}>{r.value}</Text>
              </View>
            ))}
          </View>
        )}
      </Animated.View>

      <View style={styles.resultFooter}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: barWidth }]} />
        </View>
        <TouchableOpacity style={styles.nextButton} onPress={onClose} activeOpacity={0.85}>
          <Ionicons name="scan-outline" size={20} color={ui.color} />
          <Text style={[styles.nextText, { color: ui.color }]}>Scan next</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

/* ---------- manual entry sheet (adds the prefix, QR scans are never changed) ---------- */
function ManualEntry({
  visible,
  onClose,
  onSubmit
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');

  function send() {
    const typed = value.trim().toUpperCase();
    if (!typed) return;

    // if the operator typed the prefix anyway, don't double it
    const fullId = typed.startsWith(ID_PREFIX) ? typed : ID_PREFIX + typed;

    setValue('');
    onSubmit(fullId);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Enter student ID</Text>
          <Text style={styles.sheetSub}>Type only the part after {ID_PREFIX}</Text>

          <View style={styles.inputRow}>
            <View style={styles.prefixBox}>
              <Text style={styles.prefixText}>{ID_PREFIX}</Text>
            </View>
            <TextInput
              style={styles.inputFlex}
              value={value}
              onChangeText={setValue}
              placeholder="e.g. 1234"
              placeholderTextColor="#64748b"
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={send}
            />
          </View>

          <View style={styles.sheetButtons}>
            <TouchableOpacity style={[styles.sheetBtn, styles.sheetCancel]} onPress={onClose}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetBtn, styles.sheetPrimary, !value.trim() && { opacity: 0.4 }]}
              onPress={send}
              disabled={!value.trim()}
            >
              <Text style={styles.sheetPrimaryText}>Check</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ---------- staff login ---------- */
function LoginScreen({
  onDone,
  initialError
}: {
  onDone: (session: StaffSession) => void;
  initialError?: string;
}) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? '');

  async function login() {
    if (Platform.OS === 'web') {
      setError('Staff sign-in is available in the Android and iOS app only.');
      return;
    }
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setBusy(true);
    setError('');
    let issuedToken: string | null = null;
    try {
      const result = await authenticateStaff(email.trim(), password);
      if (!result.ok) {
        const messages = {
          network: 'Could not connect. Staff login requires an internet connection to the server.',
          invalid: 'Email or password is incorrect.',
          inactive: 'This staff account is inactive. Contact an administrator.',
          occupied: 'This account is already signed in on another phone.',
          unassigned: 'This account has no valid cafeteria and gate assignment.',
          error: 'Could not sign in. Please try again.'
        };
        setError(messages[result.reason]);
        return;
      }

      issuedToken = result.session.accessToken;
      const [oldGate, unsent] = await Promise.all([getGate(), pendingCount()]);
      const sameStation = oldGate?.cafeteria === result.session.cafeteria_id &&
        oldGate?.gate === result.session.gate;
      if (unsent > 0 && !sameStation) {
        const released = await logoutStaff(result.session.accessToken);
        setError(
          released
            ? 'This phone has unsent scans from another gate. Sign in at the original gate to sync them first.'
            : 'This phone has unsent scans from another gate, and the new session could not be released. Contact an administrator.'
        );
        return;
      }

      await applyLoginData(result.session, result.data, unsent === 0);
      await saveSession(result.session);
      onDone(result.session);
    } catch (err) {
      const released = issuedToken ? await logoutStaff(issuedToken) : true;
      const message = err instanceof Error ? err.message : 'Could not save sign-in data. Please try again.';
      setError(
        released
          ? message
          : `${message} The server session could not be released; contact an administrator.`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <ScrollView
        contentContainerStyle={[styles.login, { paddingTop: insets.top + 50, paddingBottom: insets.bottom + 30 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.appName}>Meal Card</Text>
        <Text style={styles.loginSub}>Sign in to load your assigned cafeteria and gate.</Text>

        <Text style={styles.loginLabel}>Email</Text>
        <TextInput
          style={styles.loginInput}
          value={email}
          onChangeText={setEmail}
          placeholder="staff@example.edu"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          editable={!busy}
        />

        <Text style={styles.loginLabel}>Password</Text>
        <TextInput
          style={styles.loginInput}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="#64748b"
          secureTextEntry
          textContentType="password"
          returnKeyType="done"
          onSubmitEditing={login}
          editable={!busy}
        />

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity style={[styles.saveButton, busy && { opacity: 0.6 }]} onPress={login} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Sign in and download data</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ---------- main app ---------- */
export default function App() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [session, setSession] = useState<StaffSession | null>(null);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const [view, setView] = useState<ScanView | null>(null);
  const [checking, setChecking] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [torch, setTorch] = useState(false);
  const [served, setServed] = useState(0);
  const [pending, setPending] = useState(0);

  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCode = useRef({ id: '', time: 0 });

  const cfg = session
    ? { cafeteria: session.cafeteria_id, gate: session.gate }
    : null;

  // Restore a saved session, checking with the server when it is reachable.
  useEffect(() => {
    let alive = true;
    async function restore() {
      try {
        const saved = Platform.OS === 'web' ? null : await loadSession();
        const localGate = await getGate();
        if (saved && localGate?.cafeteria === saved.cafeteria_id && localGate.gate === saved.gate) {
          try {
            const res = await fetchT(
              `${API}/auth/session`,
              { headers: { Authorization: `Bearer ${saved.accessToken}` } },
              5000
            );
            if (res.ok) {
              const { staff } = await res.json();
              if (
                staff.cafeteria_id === saved.cafeteria_id &&
                staff.gate === saved.gate
              ) {
                if (alive) setSession(saved);
              } else if (alive) {
                setBootError('Your assigned station changed. Sign in again to download its student list.');
              }
            } else if (res.status === 401 || res.status === 403) {
              if (alive) setBootError('Your staff session is no longer active. Sign in again.');
            } else if (alive) {
              setSession(saved);
            }
          } catch {
            if (alive) setSession(saved);
          }
        }
        if (alive) setPending(await pendingCount());
      } catch (err) {
        if (alive) setBootError(err instanceof Error ? err.message : 'Could not load saved sign-in data.');
      } finally {
        if (alive) setReady(true);
      }
    }
    restore();
    return () => { alive = false; };
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetchT(`${API}/status`, undefined, 4000);
      setStatus((await res.json()) as StatusResponse);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  // meal status card, once a minute
  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 60000);
    return () => clearInterval(t);
  }, [loadStatus]);

  // every 2 minutes: send unsent scans (free when none), refresh the local copy only if it is older than STALE_MS
  useEffect(() => {
    if (!session) return;
    let alive = true;
    async function sync() {
      await syncUp();
      await syncDownIfStale(STALE_MS);
      if (alive) setPending(await pendingCount());
    }
    sync();
    const t = setInterval(sync, 120000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [session]);

  function closeResult() {
    if (timer.current) clearTimeout(timer.current);
    lastCode.current.time = Date.now(); // keep ignoring a card that is still held up
    setView(null);
    busy.current = false;
  }

  async function submit(rawId: string, method: 'qr' | 'manual') {
    const id = rawId.trim();
    if (!id || busy.current || !cfg || logoutBusy || !session) return;

    // the camera fires repeatedly, ignore the same code for a few seconds
    const now = Date.now();
    if (method === 'qr' && lastCode.current.id === id && now - lastCode.current.time < SAME_CODE_MS) return;
    lastCode.current = { id, time: now };

    busy.current = true;
    setChecking(true);

    let data: ScanResult;
    let viaServer = true;
    try {
      const res = await fetchT(
        `${API}/scan`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.accessToken}`
          },
          body: JSON.stringify({ studentId: id, method })
        },
        REQUEST_TIMEOUT_MS
      );
      const response = (await res.json()) as ScanResult;
      if (res.status === 401) {
        data = { status: 'AUTH_REQUIRED' };
        setSession(null);
      } else {
        data = response;
        if (data.status === 'ERROR') throw new Error('server error'); // server up but broken: use the phone's copy
      }
    } catch {
      viaServer = false;
      data = await scanOffline(id, method);
      setPending(await pendingCount());
    } finally {
      setChecking(false);
    }

    // remember what the server decided, so offline mode agrees with it
    if (viaServer && data.meal && data.student) {
      if (data.status === 'ALLOWED') {
        await saveOnlineScan(data.student.id, data.meal.meal_type, data.meal.date, method);
      } else if (data.status === 'ALREADY_USED') {
        await saveOnlineScan(
          data.student.id, data.meal.meal_type, data.meal.date, method, data.firstScan?.scanned_at
        );
      }
    }

    if (data.status === 'ALLOWED') {
      setServed((n) => n + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (data.status === 'ALREADY_USED' || data.status === 'BAD_REQUEST' || data.status === 'WRONG_GATE') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    setView({ data, id });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(closeResult, RESULT_MS);
  }

  // QR path: the scanned text goes to the server exactly as read
  function handleBarcode({ data }: BarcodeScanningResult) {
    submit(data, 'qr');
  }

  // manual path: ManualEntry has already added the prefix
  function handleManual(id: string) {
    setManualOpen(false);
    submit(id, 'manual');
  }

  if (!ready) return <View style={styles.container} />;

  if (!session || !cfg) {
    return (
      <LoginScreen
        initialError={bootError}
        onDone={(signedIn) => {
          setBootError('');
          setLogoutError('');
          setSession(signedIn);
          pendingCount().then(setPending);
        }}
      />
    );
  }
  if (!permission) return <View style={styles.container} />;

  async function signOut() {
    if (logoutBusy || !session) return;
    if (busy.current || checking || manualOpen || view) {
      setLogoutError('Finish or close the current scan before logging out.');
      return;
    }
    setLogoutBusy(true);
    setLogoutError('');
    try {
      const synced = await syncUp();
      const remaining = await pendingCount();
      if (!synced || remaining > 0) {
        setLogoutError(`${remaining} scan${remaining === 1 ? '' : 's'} still need to sync. Stay signed in and try again online.`);
        return;
      }
      if (!(await logoutStaff(session.accessToken))) {
        setLogoutError('Could not reach the server to log out. You are still signed in.');
        return;
      }
      setSession(null);
      await clearLocalSession();
      setPending(0);
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : 'Could not complete logout.');
    } finally {
      setLogoutBusy(false);
    }
  }

  const paused = !!view || checking || manualOpen || logoutBusy;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <StatusBar barStyle="light-content" />

      {/* header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>Meal Card</Text>
          <Text style={styles.appSub}>Cafeteria {cfg.cafeteria} · Gate {cfg.gate}</Text>
        </View>
        <View style={styles.headerActions}>
          <View style={styles.counter}>
            <Ionicons name="people-outline" size={16} color={C.muted} />
            <Text style={styles.counterText}>
              {served} served{pending > 0 ? ` · ${pending} unsent` : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={signOut}
            disabled={logoutBusy || checking || manualOpen || !!view}
            style={styles.logoutButton}
          >
            {logoutBusy
              ? <ActivityIndicator size="small" color={C.text} />
              : <Text style={styles.logoutText}>Log out</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {!!logoutError && <Text style={styles.errorText}>{logoutError}</Text>}
      <StatusCard status={status} offline={offline} onRetry={loadStatus} />

      {/* camera */}
      <View style={styles.cameraBox}>
        {permission.granted ? (
          <>
            <CameraView
              style={FILL}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={paused ? undefined : handleBarcode}
            />
            <ScanFrame checking={checking} />
            <TouchableOpacity
              style={[styles.torch, torch && { backgroundColor: '#facc15' }]}
              onPress={() => setTorch((t) => !t)}
            >
              <Ionicons name={torch ? 'flash' : 'flash-off'} size={20} color={torch ? '#111' : '#fff'} />
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.permission}>
            <Ionicons name="camera-outline" size={48} color={C.muted} />
            <Text style={styles.permTitle}>Camera access needed</Text>
            <Text style={styles.permSub}>Allow the camera to scan student QR codes</Text>
            <TouchableOpacity style={styles.permButton} onPress={requestPermission}>
              <Text style={styles.permButtonText}>Allow camera</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* manual entry */}
      <TouchableOpacity style={styles.manualButton} onPress={() => setManualOpen(true)} activeOpacity={0.8}>
        <Ionicons name="keypad-outline" size={20} color={C.text} />
        <Text style={styles.manualText}>Enter ID manually</Text>
      </TouchableOpacity>

      <ManualEntry visible={manualOpen} onClose={() => setManualOpen(false)} onSubmit={handleManual} />

      {view && <ResultScreen view={view} status={status} onClose={closeResult} />}
    </View>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 16 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  appName: { color: C.text, fontSize: 22, fontWeight: '800' },
  appSub: { color: C.muted, fontSize: 13, marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  counter: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20
  },
  counterText: { color: C.text, fontSize: 13, fontWeight: '600' },
  logoutButton: {
    minWidth: 58, height: 38, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.border, borderRadius: 12, paddingHorizontal: 10
  },
  logoutText: { color: C.text, fontSize: 13, fontWeight: '700' },

  statusCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 12, marginBottom: 14
  },
  statusIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  statusLine: { color: C.muted, fontSize: 13, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  retry: { backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  cameraBox: {
    flex: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: '#000',
    borderWidth: 1, borderColor: C.border, marginBottom: 14
  },
  dim: { flex: 1, backgroundColor: 'rgba(11,18,32,0.65)' },
  corner: { position: 'absolute', width: 34, height: 34 },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 14 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 14 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 14 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 14 },
  scanLine: {
    position: 'absolute', left: 12, right: 12, height: 3, borderRadius: 2, backgroundColor: C.primary,
    shadowColor: C.primary, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 6
  },
  checking: {
    ...FILL,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(11,18,32,0.6)', gap: 10
  },
  checkingText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  hint: { color: '#e2e8f0', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  torch: {
    position: 'absolute', top: 14, right: 14, width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center'
  },

  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  permTitle: { color: C.text, fontSize: 18, fontWeight: '700', marginTop: 6 },
  permSub: { color: C.muted, fontSize: 14, textAlign: 'center' },
  permButton: { marginTop: 10, backgroundColor: C.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12 },
  permButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  manualButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingVertical: 16
  },
  manualText: { color: C.text, fontSize: 16, fontWeight: '600' },

  /* manual sheet */
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: C.border, marginBottom: 16 },
  sheetTitle: { color: C.text, fontSize: 20, fontWeight: '800' },
  sheetSub: { color: C.muted, fontSize: 14, marginTop: 4, marginBottom: 16 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg,
    borderWidth: 1, borderColor: C.border, borderRadius: 14, overflow: 'hidden'
  },
  prefixBox: { paddingHorizontal: 14, paddingVertical: 14, backgroundColor: C.border },
  prefixText: { color: C.muted, fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  inputFlex: {
    flex: 1, color: C.text, fontSize: 20, fontWeight: '600',
    paddingHorizontal: 14, paddingVertical: 14, letterSpacing: 1
  },
  sheetButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  sheetBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 14 },
  sheetCancel: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  sheetCancelText: { color: C.text, fontSize: 16, fontWeight: '600' },
  sheetPrimary: { backgroundColor: C.primary },
  sheetPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  /* login */
  login: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20 },
  loginSub: { color: C.muted, fontSize: 14, marginTop: 6, marginBottom: 20 },
  loginLabel: { color: C.text, fontSize: 15, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  loginInput: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14,
    color: C.text, fontSize: 17, paddingHorizontal: 16, paddingVertical: 14
  },
  errorText: { color: '#fca5a5', fontSize: 14, marginTop: 16 },
  saveButton: {
    marginTop: 28, backgroundColor: C.primary, borderRadius: 16, paddingVertical: 17,
    alignItems: 'center', justifyContent: 'center'
  },
  saveText: { color: '#fff', fontSize: 17, fontWeight: '800' },

  /* result */
  overlay: {
    ...FILL,
    zIndex: 10,
    paddingHorizontal: 20, justifyContent: 'space-between'
  },
  resultBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  resultIcon: {
    width: 132, height: 132, borderRadius: 66, backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 18
  },
  resultTitle: { color: '#fff', fontSize: 34, fontWeight: '800', textAlign: 'center' },
  resultSub: { color: 'rgba(255,255,255,0.9)', fontSize: 16, marginTop: 6, marginBottom: 22, textAlign: 'center' },

  infoCard: {
    width: '100%', backgroundColor: '#fff', borderRadius: 22, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8
  },
  studentRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 4 },
  photo: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#e2e8f0' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#475569', fontSize: 32, fontWeight: '700' },
  name: { color: '#0f172a', fontSize: 20, fontWeight: '800' },
  studentMeta: { color: '#64748b', fontSize: 14, marginTop: 2 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  detailBorder: { borderTopWidth: 1, borderTopColor: '#e2e8f0', marginTop: 8 },
  detailLabel: { color: '#64748b', fontSize: 14 },
  detailValue: { flex: 1, color: '#0f172a', fontSize: 15, fontWeight: '700', textAlign: 'right' },

  resultFooter: { gap: 14 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  progressFill: { height: 5, backgroundColor: '#fff' },
  nextButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 16, paddingVertical: 17
  },
  nextText: { fontSize: 17, fontWeight: '800' }
});
