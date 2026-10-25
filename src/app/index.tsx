import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import type { MealType, ScanResult, ScanStatus, StatusResponse } from '../types';

// CHANGE THIS to your computer's IP
const API = 'http://192.168.1.2:3000';

const RESULT_MS = 3500;     // how long the result screen stays
const SAME_CODE_MS = 4000;  // ignore the same QR within this time

const MEAL_LABEL: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner'
};

const RESULT_UI: Record<ScanStatus, { color: string; title: string; sub: string }> = {
  ALLOWED:      { color: '#16a34a', title: 'ALLOWED',       sub: 'Enjoy your meal' },
  ALREADY_USED: { color: '#dc2626', title: 'ALREADY USED',  sub: 'Already ate this meal today' },
  CLOSED:       { color: '#475569', title: 'CLOSED',        sub: 'No meal is open right now' },
  NOT_FOUND:    { color: '#dc2626', title: 'NOT FOUND',     sub: 'Student ID does not exist' },
  INACTIVE:     { color: '#dc2626', title: 'NOT ALLOWED',   sub: 'Student is not active' },
  BAD_REQUEST:  { color: '#dc2626', title: 'INVALID ID',    sub: 'Could not read the ID' },
  ERROR:        { color: '#dc2626', title: 'SERVER ERROR',  sub: 'Try again' },
  NETWORK:      { color: '#dc2626', title: 'NO CONNECTION', sub: 'Cannot reach the server' }
};

/* ---------- status bar ---------- */
function MealStatusBar({ status }: { status: StatusResponse | null }) {
  let text = 'Connecting...';
  let color = '#334155';

  if (status?.open && status.current) {
    color = '#166534';
    text = `${MEAL_LABEL[status.current.meal_type]} open`;
    if (status.current.menu_name) text += ` · ${status.current.menu_name}`;
  } else if (status) {
    text = 'Closed';
    if (status.next) {
      text += ` · next: ${MEAL_LABEL[status.next.meal_type]} ${status.next.start_time.slice(0, 5)}`;
    }
  }

  return (
    <View style={[styles.status, { backgroundColor: color }]}>
      <Text style={styles.statusText}>{text}</Text>
    </View>
  );
}

/* ---------- result screen ---------- */
type ResultScreenProps = { result: ScanResult; onClose: () => void };

function ResultScreen({ result, onClose }: ResultScreenProps) {
  const ui = RESULT_UI[result.status] ?? RESULT_UI.ERROR;
  const s = result.student;
  const firstTime = result.firstScan?.scanned_at?.slice(11, 16);

  return (
    <Pressable style={[styles.overlay, { backgroundColor: ui.color }]} onPress={onClose}>
      <Text style={styles.resultTitle}>{ui.title}</Text>

      {s && (
        <View style={styles.center}>
          {s.photo_url ? (
            <Image source={{ uri: s.photo_url }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.avatar]}>
              <Text style={styles.avatarText}>{s.full_name.charAt(0)}</Text>
            </View>
          )}
          <Text style={styles.name}>{s.full_name}</Text>
          <Text style={styles.small}>
            {s.id}{s.department ? ` · ${s.department}` : ''}
          </Text>
        </View>
      )}

      {result.meal && (
        <Text style={styles.meal}>
          {MEAL_LABEL[result.meal.meal_type]}
          {result.meal.menu_name ? ` · ${result.meal.menu_name}` : ''}
        </Text>
      )}

      <Text style={styles.sub}>
        {ui.sub}
        {result.status === 'ALREADY_USED' && firstTime ? ` (at ${firstTime})` : ''}
      </Text>

      <Text style={styles.tap}>Tap to dismiss</Text>
    </Pressable>
  );
}

/* ---------- main app ---------- */
export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [manualId, setManualId] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCode = useRef({ id: '', time: 0 });

  // track the keyboard so the camera can hide while typing
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // poll meal status every 20 seconds
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/status`);
        setStatus((await res.json()) as StatusResponse);
      } catch {
        setStatus(null);
      }
    }
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  function closeResult() {
    if (timer.current) clearTimeout(timer.current);
    setResult(null);
    busy.current = false;
  }

  async function submit(rawId: string, method: 'qr' | 'manual') {
    const id = rawId.trim();
    if (!id || busy.current) return;

    // the camera fires repeatedly, ignore the same code for a few seconds
    const now = Date.now();
    if (method === 'qr' && lastCode.current.id === id && now - lastCode.current.time < SAME_CODE_MS) return;
    lastCode.current = { id, time: now };

    busy.current = true;
    let data: ScanResult;
    try {
      const res = await fetch(`${API}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: id, method })
      });
      data = (await res.json()) as ScanResult;
    } catch {
      data = { status: 'NETWORK' };
    }

    setResult(data);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(closeResult, RESULT_MS);
  }

  function handleManual() {
    Keyboard.dismiss();
    submit(manualId, 'manual');
    setManualId('');
  }

  function handleBarcode({ data }: BarcodeScanningResult) {
    submit(data, 'qr');
  }

  if (!permission) return <View style={styles.container} />;

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <StatusBar barStyle="light-content" />
      <Text style={styles.header}>Meal Card Scanner</Text>

      <MealStatusBar status={status} />

      {!keyboardOpen &&
        (permission.granted ? (
          <View style={styles.cameraBox}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={result ? undefined : handleBarcode}
            />
          </View>
        ) : (
          <View style={[styles.cameraBox, styles.center]}>
            <Text style={styles.small}>Camera permission is needed to scan</Text>
            <TouchableOpacity style={styles.button} onPress={requestPermission}>
              <Text style={styles.buttonText}>Allow camera</Text>
            </TouchableOpacity>
          </View>
        ))}

      {/* spacer keeps the input at the bottom when the camera is hidden */}
      {keyboardOpen && <View style={{ flex: 1 }} />}

      <View style={styles.manual}>
        <TextInput
          style={styles.input}
          value={manualId}
          onChangeText={setManualId}
          placeholder="Type student ID"
          placeholderTextColor="#94a3b8"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleManual}
        />
        <TouchableOpacity style={styles.button} onPress={handleManual}>
          <Text style={styles.buttonText}>Check</Text>
        </TouchableOpacity>
      </View>

      {result && <ResultScreen result={result} onClose={closeResult} />}
    </KeyboardAvoidingView>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', paddingTop: 50, paddingHorizontal: 16 },
  header: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 12 },

  status: { padding: 12, borderRadius: 10, marginBottom: 12 },
  statusText: { color: '#fff', textAlign: 'center', fontSize: 15, fontWeight: '600' },

  cameraBox: { flex: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', marginBottom: 12 },

  manual: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  input: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 16 },
  button: { backgroundColor: '#2563eb', borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center', paddingVertical: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  center: { alignItems: 'center', justifyContent: 'center' },
  small: { color: '#fff', opacity: 0.9, fontSize: 15, marginBottom: 8 },

  overlay: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 10
  },
  resultTitle: { color: '#fff', fontSize: 40, fontWeight: '800', marginBottom: 20, textAlign: 'center' },
  photo: { width: 150, height: 150, borderRadius: 75, borderWidth: 4, borderColor: '#fff' },
  avatar: { backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 60, fontWeight: '700' },
  name: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  meal: { color: '#fff', fontSize: 20, marginTop: 16, textAlign: 'center' },
  sub: { color: '#fff', fontSize: 18, marginTop: 6, textAlign: 'center' },
  tap: { color: '#fff', opacity: 0.7, marginTop: 28 }
});