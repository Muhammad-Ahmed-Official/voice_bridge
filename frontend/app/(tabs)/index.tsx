import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Dimensions,
  Alert,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Globe,
  User,
  Key,
  ChevronLeft,
  Bluetooth,
  Settings,
  FileText,
  Headphones,
  PhoneCall,
  Users,
  Check,
  Zap,
  Activity,
  MicOff,
  Volume2,
  Play,
  LogOut,
  Wifi,
  Mic,
  Cpu
} from 'lucide-react-native';
import { useAuth } from "../../context/authContext.jsx"

const { width } = Dimensions.get('window');

const THEME = {
  background: '#0F1219',
  surface: '#1A1F2B',
  border: '#2D3548',
  primary: '#06B6D4',
  secondary: '#6366F1',
  success: '#10B981',
  danger: '#F43F5E',
  textMain: '#F8FAFC',
  textMuted: '#94A3B8',
};

const LANGUAGES = [
  { code: 'UR', label: 'Urdu', flag: '🇵🇰' },
  { code: 'EN', label: 'English', flag: '🇺🇸' },
  { code: 'AR', label: 'Arabic', flag: '🇸🇦' }
];

// Cross-platform alert: works on web (window.alert) and native (Alert.alert)
const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

// --- AUTH SCREEN ---
const AuthScreen = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [data, setData] = useState({ id: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const { login, register } = useAuth();

  const submit = async () => {
    if (!data.id?.trim() || !data.password?.trim()) {
      showAlert('Error', 'ID and Password required');
      return;
    }

    setSubmitting(true);
    const userId = data.id.trim();
    const password = data.password;

    if (isLogin) {
      const result = await login(userId, password);
      setSubmitting(false);
      if (result?.success) return;
      showAlert('Error', result?.message || 'Login failed');
      setData(prev => ({ ...prev, password: '' }));
    } else {
      const result = await register(userId, password);
      setSubmitting(false);
      if (result?.success) {
        showAlert('Success', 'Account created. Please sign in.');
        setIsLogin(true);
        // setData(prev => ({ ...prev, password: '' }));
        return;
      }
      showAlert('Error', result?.message || 'Registration failed');
      setData(prev => ({ ...prev, password: '' }));
    }
  };

  return (
    <View style={styles.darkPage}>
      <LinearGradient colors={[THEME.background, '#07090D']} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.authWrap}>
        <View style={styles.logoBox}>
          <LinearGradient colors={[THEME.primary, THEME.secondary]} style={styles.logoCircle}>
            <Globe size={42} color="#fff" />
          </LinearGradient>
          <Text style={styles.brand}>Voice Bridge</Text>
          <Text style={styles.tagline}>Breaking Barriers, Building Bridges</Text>
        </View>

        <View style={styles.authCard}>
          <View style={styles.field}>
            <User size={18} color={THEME.textMuted} />
            <TextInput
              placeholder="User ID"
              placeholderTextColor={THEME.textMuted}
              style={styles.fieldInput}
              onChangeText={v => setData({ ...data, id: v })}
            />
          </View>
          <View style={styles.field}>
            <Key size={18} color={THEME.textMuted} />
            <TextInput
              secureTextEntry
              placeholder="Password"
              placeholderTextColor={THEME.textMuted}
              style={styles.fieldInput}
              onChangeText={v => setData({ ...data, password: v })}
            />
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={submit}>
            <LinearGradient colors={[THEME.primary, THEME.secondary]} style={styles.primaryBtnInner}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{isLogin ? 'Sign In' : 'Register'}</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => setIsLogin(!isLogin)} style={styles.switchBox}>
          <Text style={styles.switchText}>{isLogin ? 'New user? Create account' : 'Already have an account? Sign in'}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
};

// --- HOME SCREEN --- (user from authContext)
const HomeScreen = ({ device, setScreen }: any) => {
  const { user } = useAuth();
  const displayName = user?.name || user?.userId || '';
  const displayId = user?.userId || user?.id || '';
  return (
  <View style={styles.homePage}>
    <LinearGradient colors={[THEME.surface, THEME.background]} style={styles.headerBg} />
    <SafeAreaView>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerLabel}>AUTHENTICATED AS</Text>
          <Text style={styles.headerName}>{displayName}</Text>
          <Text style={styles.headerId}>ID: {displayId}</Text>
        </View>
        <TouchableOpacity onPress={() => setScreen('bt')} style={[styles.btButton, device && styles.btButtonActive]}>
          <Bluetooth size={26} color={device ? THEME.primary : THEME.textMuted} />
        </TouchableOpacity>
      </View>
      <View style={styles.headerIcons}>
        <TouchableOpacity style={styles.headerIconBox} onPress={() => setScreen('history')}>
          <FileText size={18} color={THEME.primary} />
          <Text style={styles.headerIconLabel}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerIconBox} onPress={() => setScreen('settings')}>
          <Settings size={18} color={THEME.secondary} />
          <Text style={styles.headerIconLabel}>Settings</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <TouchableOpacity style={styles.featureCard} onPress={() => setScreen('as-setup')}>
        <View style={styles.featureIcon}><Headphones size={26} color={THEME.primary} /></View>
        {device && <View style={styles.statusTag}><Wifi size={10} color={THEME.success} /><Text style={styles.statusText}>CONNECTED</Text></View>}
        <Text style={styles.featureTitle}>Bluetooth Assistant</Text>
        <Text style={styles.featureDesc}>Real-time background translation. Works with external call apps.</Text>
      </TouchableOpacity>
      <View style={styles.gridRow}>
        <TouchableOpacity style={styles.gridCard} onPress={() => setScreen('dc-setup')}>
          <View style={[styles.gridIcon, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}><PhoneCall size={24} color={THEME.success} /></View>
          <Text style={styles.gridTitle}>Direct Call</Text>
          <Text style={styles.gridDesc}>1-on-1 ID Search</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.gridCard} onPress={() => setScreen('mt-setup')}>
          <View style={[styles.gridIcon, { backgroundColor: 'rgba(99, 102, 241, 0.1)' }]}><Users size={24} color={THEME.secondary} /></View>
          <Text style={styles.gridTitle}>Meeting Table</Text>
          <Text style={styles.gridDesc}>Group 3-5 Users</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  </View>
  );
};

// --- PROFILE SCREEN --- (credentials from authContext)
const ProfileScreen = ({ onBack, onLogout }: { onBack: () => void; onLogout: () => void }) => {
  const { user } = useAuth();
  const displayName = user?.name || user?.userId || '';
  const displayId = user?.userId || user?.id || '';
  const initial = (displayName || displayId || '?').charAt(0).toUpperCase();
  return (
    <SafeAreaView style={styles.darkPage}>
      <View style={styles.navHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}><ChevronLeft size={26} color={THEME.textMain} /></TouchableOpacity>
        <Text style={styles.navTitle}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={{ padding: 20 }}>
        <View style={styles.profileBox}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileLetter}>{initial}</Text>
          </View>
          <View>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profileId}>ID: {displayId}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
          <LogOut size={18} color={THEME.danger} /><Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default function App() {
  const { user, loading: authLoading, logout } = useAuth();
  const [screen, setScreen] = useState('home');
  const [device, setDevice] = useState(null);
  const [speakLang, setSpeakLang] = useState('UR');
  const [hearLang, setHearLang] = useState('EN');
  const [participants, setParticipants] = useState(3);
  const [cloningEnabled, setCloningEnabled] = useState(false);
  const [participantIds, setParticipantIds] = useState(''); // State for comma separated IDs
  const [activeConfig, setActiveConfig] = useState<any>(null);

  const Header = ({ title }: any) => (
    <View style={styles.navHeader}>
      <TouchableOpacity style={styles.backBtn} onPress={() => setScreen('home')}><ChevronLeft size={26} color={THEME.textMain} /></TouchableOpacity>
      <Text style={styles.navTitle}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  if (!user && !authLoading) return <AuthScreen />;
  if (authLoading) return <View style={[styles.darkPage, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator size="large" color={THEME.primary} /></View>;

  if (screen.includes('active')) return (
    <View style={styles.livePage}>
      <StatusBar hidden />
      <View style={styles.liveTop}>
        <View style={styles.timeBox}><Text style={styles.timeText}>12:45</Text></View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.liveLabel}>● LIVE BRIDGE</Text>
          {cloningEnabled && <Text style={styles.cloningStatusLabel}>AI CLONE ACTIVE</Text>}
        </View>
      </View>
      <View style={styles.participantsGrid}>
        {activeConfig?.map((p: any, i: number) => (
          <View key={i} style={[styles.participantTile, i === 0 && styles.tileActive]}>
            <View style={[styles.avatarBox, i === 0 && cloningEnabled && { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
              {i === 0 && cloningEnabled ? <Mic size={24} color={THEME.success} /> : <Text style={styles.avatarLetter}>{p.userId?.charAt(0) || 'U'}</Text>}
            </View>
            <View>
              <Text style={styles.tileName}>{p.userId}</Text>
              <Text style={styles.tileLang}>{p.speak} ➜ {p.hear}</Text>
            </View>
            <View style={styles.tileWave}><Activity size={16} color={i === 0 && cloningEnabled ? THEME.success : THEME.primary} /></View>
          </View>
        ))}
      </View>
      <View style={styles.bottomControls}>
        <TouchableOpacity style={styles.roundControl}><MicOff size={24} color={THEME.textMain} /></TouchableOpacity>
        <TouchableOpacity onPress={() => setScreen('home')} style={[styles.roundControl, styles.endCall]}><PhoneCall size={26} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} /></TouchableOpacity>
        <TouchableOpacity style={styles.roundControl}><Volume2 size={24} color={THEME.textMain} /></TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: THEME.background }}>
      <StatusBar barStyle="light-content" />
      {screen === 'home' && <HomeScreen device={device} setScreen={setScreen} />}

      {screen.includes('setup') && (
        <SafeAreaView style={styles.darkPage}>
          <Header title="Configuration" />
          <ScrollView style={{ padding: 20 }}>
            {screen === 'as-setup' && !device ? (
              <View style={styles.errorBox}><Bluetooth size={32} color={THEME.danger} /><Text style={styles.errorTitle}>Headset Required</Text><TouchableOpacity style={styles.errorBtn} onPress={() => setScreen('bt')}><Text style={styles.errorBtnText}>Pair Now</Text></TouchableOpacity></View>
            ) : (
              <>
                {screen === 'dc-setup' && <View style={{ marginBottom: 25 }}><Text style={styles.labelDark}>REMOTE USER ID</Text><TextInput placeholder="Target ID" style={styles.inputWhite} placeholderTextColor={THEME.textMuted} /></View>}
                
                {/* RESTORED MEETING TABLE IDS INPUT */}
                {screen === 'mt-setup' && (
                  <View style={{ marginBottom: 25 }}>
                    <Text style={styles.labelDark}>PARTICIPANTS COUNT</Text>
                    <View style={styles.langRow}>
                      {[3, 4, 5].map(n => (
                        <TouchableOpacity key={n} onPress={() => setParticipants(n)} style={[styles.langBtn, participants === n && styles.langBtnActive]}>
                          <Text style={[styles.langBtnText, participants === n && styles.langBtnTextActive]}>{n} Users</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={[styles.labelDark, {marginTop: 15}]}>PARTICIPANT IDs (COMMA SEPARATED)</Text>
                    <TextInput 
                      placeholder="e.g. user123, user456, user789" 
                      style={styles.inputWhite} 
                      placeholderTextColor={THEME.textMuted} 
                      onChangeText={setParticipantIds}
                    />
                  </View>
                )}

                <View style={styles.cloningCard}>
                  <View style={styles.cloningIconBox}><Cpu size={24} color={THEME.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cloningTitle}>Neural Voice Cloning</Text>
                    <Text style={styles.cloningDesc}>Use your natural voice for translations.</Text>
                  </View>
                  <TouchableOpacity onPress={() => setCloningEnabled(!cloningEnabled)} style={[styles.toggleTrack, cloningEnabled && styles.toggleTrackActive]}>
                    <View style={[styles.toggleThumb, cloningEnabled && styles.toggleThumbActive]} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.labelDark}>I WILL SPEAK</Text>
                <View style={styles.langRow}>{LANGUAGES.map(l => <TouchableOpacity key={'s' + l.code} onPress={() => setSpeakLang(l.code)} style={[styles.langSelect, speakLang === l.code && styles.langSelectActive]}><Text style={styles.flag}>{l.flag}</Text><Text style={[styles.langName, speakLang === l.code && styles.langNameActive]}>{l.label}</Text></TouchableOpacity>)}</View>

                <Text style={[styles.labelDark, { marginTop: 25 }]}>I WANT TO HEAR</Text>
                <View style={styles.langRow}>{LANGUAGES.map(l => <TouchableOpacity key={'h' + l.code} onPress={() => setHearLang(l.code)} style={[styles.langSelect, hearLang === l.code && styles.langSelectActive]}><Text style={styles.flag}>{l.flag}</Text><Text style={[styles.langName, hearLang === l.code && styles.langNameActive]}>{l.label}</Text></TouchableOpacity>)}</View>

                <TouchableOpacity 
                  style={styles.launchBtn} 
                  onPress={() => {
                    // Logic to split the IDs for the active screen
                    const ids = participantIds.split(',').map(id => id.trim()).filter(id => id !== '');
                    const config = [{ userId: 'You', speak: speakLang, hear: hearLang }];
                    ids.forEach(id => config.push({ userId: id, speak: hearLang, hear: speakLang }));
                    setActiveConfig(config);
                    setScreen('active');
                  }}
                >
                  <Zap size={20} color="#fff" /><Text style={styles.launchText}>Initialize Secure Bridge</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      )}

      {/* Rest of the screens (bt, history, settings) ... */}
      {screen === 'bt' && (
        <SafeAreaView style={styles.darkPage}>
          <Header title="Device Pairing" />
          <View style={styles.centerBox}><Bluetooth size={60} color={THEME.primary} /><Text style={styles.centerTitle}>Scanning...</Text><TouchableOpacity style={styles.scanOption} onPress={() => { setDevice('Galaxy Buds' as any); setScreen('home'); }}><Text style={styles.scanText}>Galaxy Buds Pro</Text><Check size={18} color={THEME.primary} /></TouchableOpacity></View>
        </SafeAreaView>
      )}
      {screen === 'history' && <SafeAreaView style={styles.darkPage}><Header title="Logs" /><ScrollView style={{ padding: 20 }}><View style={styles.historyItem}><View><Text style={styles.historyTitle}>Team Briefing</Text><Text style={styles.historyDate}>Feb 3, 2026</Text></View><TouchableOpacity style={styles.playBox}><Play size={16} color={THEME.primary} /></TouchableOpacity></View></ScrollView></SafeAreaView>}
      {screen === 'settings' && <ProfileScreen onBack={() => setScreen('home')} onLogout={() => { logout(); setScreen('home'); }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  darkPage: { flex: 1, backgroundColor: THEME.background },
  authWrap: { flex: 1, justifyContent: 'center', padding: 30 },
  logoBox: { alignItems: 'center', marginBottom: 50 },
  logoCircle: { width: 90, height: 90, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  brand: { color: THEME.textMain, fontSize: 32, fontWeight: '800', letterSpacing: -1 },
  tagline: { color: THEME.textMuted, fontSize: 13, marginTop: 6 },
  authCard: { gap: 18 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: THEME.surface, padding: 18, borderRadius: 16, borderWidth: 1, borderColor: THEME.border, gap: 12 },
  fieldInput: { flex: 1, color: THEME.textMain, fontSize: 16 },
  primaryBtn: { borderRadius: 16, overflow: 'hidden', marginTop: 12 },
  primaryBtnInner: { padding: 18, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchBox: { marginTop: 24, alignItems: 'center' },
  switchText: { color: THEME.textMuted, fontSize: 14 },
  homePage: { flex: 1, backgroundColor: THEME.background },
  headerBg: { height: 260, borderBottomLeftRadius: 40, borderBottomRightRadius: 40, position: 'absolute', top: 0, left: 0, right: 0 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 25, paddingTop: 70 },
  headerLabel: { color: THEME.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  headerName: { color: THEME.textMain, fontSize: 28, fontWeight: '800', marginTop: 4 },
  headerId: { color: THEME.primary, fontSize: 12, fontWeight: '600', marginTop: 2 },
  btButton: { padding: 14, borderRadius: 18, backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border },
  btButtonActive: { backgroundColor: 'rgba(6, 182, 212, 0.1)', borderColor: THEME.primary },
  headerIcons: { flexDirection: 'row', paddingHorizontal: 25, marginTop: 22, gap: 12 },
  headerIconBox: { flex: 1, backgroundColor: THEME.surface, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: THEME.border },
  headerIconLabel: { color: THEME.textMain, fontWeight: '700', fontSize: 13 },
  featureCard: { backgroundColor: THEME.surface, borderRadius: 24, padding: 25, marginBottom: 20, borderWidth: 1, borderColor: THEME.border },
  featureIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: THEME.background, justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: THEME.border },
  statusTag: { position: 'absolute', top: 25, right: 25, backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { color: THEME.success, fontSize: 10, fontWeight: '800' },
  featureTitle: { color: THEME.textMain, fontSize: 19, fontWeight: '800' },
  featureDesc: { color: THEME.textMuted, fontSize: 13, marginTop: 6, lineHeight: 18 },
  gridRow: { flexDirection: 'row', gap: 16 },
  gridCard: { flex: 1, backgroundColor: THEME.surface, padding: 20, borderRadius: 24, borderWidth: 1, borderColor: THEME.border },
  gridIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  gridTitle: { color: THEME.textMain, fontSize: 16, fontWeight: '800' },
  gridDesc: { color: THEME.textMuted, fontSize: 12, marginTop: 4 },
  navHeader: { padding: 20, paddingTop: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backBtn: { padding: 10, backgroundColor: THEME.surface, borderRadius: 14, borderWidth: 1, borderColor: THEME.border },
  navTitle: { color: THEME.textMain, fontSize: 18, fontWeight: '800' },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  centerTitle: { color: THEME.textMain, fontSize: 22, fontWeight: '800', marginVertical: 20 },
  scanOption: { width: '100%', padding: 18, borderRadius: 16, borderWidth: 1, borderColor: THEME.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: THEME.surface },
  scanText: { color: THEME.textMain, fontWeight: '700' },
  labelDark: { color: THEME.textMuted, fontSize: 10, fontWeight: '800', marginBottom: 8, letterSpacing: 0.5 },
  inputWhite: { padding: 18, borderRadius: 16, backgroundColor: THEME.surface, color: THEME.textMain, borderWidth: 1, borderColor: THEME.border },
  langRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10 },
  langBtn: { flex: 1, padding: 14, borderRadius: 14, backgroundColor: THEME.surface, marginHorizontal: 4, borderWidth: 1, borderColor: THEME.border },
  langBtnActive: { backgroundColor: THEME.primary, borderColor: THEME.primary },
  langBtnText: { color: THEME.textMuted, textAlign: 'center', fontWeight: '700' },
  langBtnTextActive: { color: '#fff' },
  langSelect: { flex: 1, backgroundColor: THEME.surface, marginHorizontal: 4, padding: 16, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: THEME.border },
  langSelectActive: { backgroundColor: 'rgba(6, 182, 212, 0.1)', borderColor: THEME.primary },
  flag: { fontSize: 22 },
  langName: { fontSize: 11, color: THEME.textMuted, marginTop: 6, fontWeight: '700' },
  langNameActive: { color: THEME.primary },
  launchBtn: { marginTop: 40, backgroundColor: THEME.primary, borderRadius: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, padding: 18 },
  launchText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  errorBox: { backgroundColor: 'rgba(244, 63, 94, 0.05)', padding: 30, borderRadius: 24, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(244, 63, 94, 0.2)' },
  errorTitle: { color: THEME.danger, fontWeight: '800', marginTop: 10 },
  errorBtn: { backgroundColor: THEME.danger, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 12 },
  errorBtnText: { color: '#fff', fontWeight: '700' },
  livePage: { flex: 1, backgroundColor: THEME.background },
  liveTop: { padding: 25, paddingTop: 60, flexDirection: 'row', justifyContent: 'space-between' },
  timeBox: { backgroundColor: THEME.surface, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: THEME.border },
  timeText: { color: THEME.textMain, fontWeight: '800' },
  liveLabel: { color: THEME.danger, fontWeight: '900', fontSize: 12 },
  cloningStatusLabel: { color: THEME.success, fontSize: 10, fontWeight: '900', marginTop: 4 },
  participantsGrid: { padding: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 15 },
  participantTile: { width: '47%', aspectRatio: 1, backgroundColor: THEME.surface, borderRadius: 24, padding: 16, justifyContent: 'space-between', borderWidth: 1, borderColor: THEME.border },
  tileActive: { borderColor: THEME.primary, borderWidth: 2 },
  avatarBox: { width: 52, height: 52, borderRadius: 26, backgroundColor: THEME.background, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: THEME.border },
  avatarLetter: { color: THEME.textMain, fontSize: 20, fontWeight: '800' },
  tileName: { color: THEME.textMain, fontWeight: '800', fontSize: 16, marginTop: 6 },
  tileLang: { color: THEME.textMuted, fontSize: 11, marginTop: 2, fontWeight: '600' },
  tileWave: { position: 'absolute', right: 16, top: 16 },
  bottomControls: { backgroundColor: THEME.surface, height: 140, borderTopLeftRadius: 40, borderTopRightRadius: 40, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', borderWidth: 1, borderColor: THEME.border },
  roundControl: { padding: 18, backgroundColor: THEME.background, borderRadius: 40, borderWidth: 1, borderColor: THEME.border },
  endCall: { backgroundColor: THEME.danger, borderColor: THEME.danger },
  historyItem: { backgroundColor: THEME.surface, padding: 20, borderRadius: 20, marginBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: THEME.border },
  historyTitle: { color: THEME.textMain, fontSize: 16, fontWeight: '800' },
  historyDate: { color: THEME.textMuted, fontSize: 12, marginTop: 6 },
  playBox: { padding: 12, backgroundColor: THEME.background, borderRadius: 14, borderWidth: 1, borderColor: THEME.border },
  profileBox: { backgroundColor: THEME.surface, padding: 20, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 16, borderWidth: 1, borderColor: THEME.border },
  profileAvatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: THEME.background, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: THEME.border },
  profileLetter: { color: THEME.primary, fontSize: 22, fontWeight: '800' },
  profileName: { color: THEME.textMain, fontSize: 18, fontWeight: '800' },
  profileId: { color: THEME.textMuted, fontSize: 12 },
  logoutBtn: { marginTop: 20, backgroundColor: 'rgba(244, 63, 94, 0.1)', padding: 20, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: 'rgba(244, 63, 94, 0.2)' },
  logoutText: { color: THEME.danger, fontWeight: '800', fontSize: 15 },
  cloningCard: { backgroundColor: THEME.surface, padding: 20, borderRadius: 24, flexDirection: 'row', alignItems: 'center', marginBottom: 25, borderWidth: 1, borderColor: THEME.border },
  cloningIconBox: { width: 48, height: 48, backgroundColor: THEME.background, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 16, borderWidth: 1, borderColor: THEME.border },
  cloningTitle: { color: THEME.textMain, fontWeight: '800', fontSize: 16 },
  cloningDesc: { color: THEME.textMuted, fontSize: 12, marginTop: 2 },
  toggleTrack: { width: 46, height: 24, borderRadius: 12, backgroundColor: THEME.background, padding: 3, borderWidth: 1, borderColor: THEME.border },
  toggleTrackActive: { backgroundColor: THEME.primary, borderColor: THEME.primary },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: THEME.textMuted },
  toggleThumbActive: { alignSelf: 'flex-end', backgroundColor: '#fff' }
});