import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator, Dimensions, Alert, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Globe, User, Key, ChevronLeft, Bluetooth, Settings, FileText,
  Headphones, PhoneCall, Users, Check, Zap, Activity, MicOff,
  Volume2, Play, LogOut, Wifi, Mic, Cpu, VolumeX, Circle
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';

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

const DUMMY_TRANSCRIPTS = [
  "Hello, I am joining the bridge.",
  "Translation is processing in real-time.",
  "Assalam-o-Alaikum, kaise hain aap?",
  "The voice cloning quality is impressive.",
  "System is now connected to the meeting table."
];

function showAlert(title: string, message: string, onOk?: () => void) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
    onOk?.();
  } else {
    Alert.alert(title, message, onOk ? [{ text: 'OK', onPress: onOk }] : undefined);
  }
}

// --- AUTH SCREEN ---
const AuthScreen = ({ onSuccess }: { onSuccess: () => void }) => {
  const { signIn, signUp, isLoading } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [data, setData] = useState({ userId: '', password: '' });

  const submit = async () => {
    if (!data.userId.trim() || !data.password) {
      showAlert('Error', 'User ID and Password required');
      return;
    }
    const result = isLogin
      ? await signIn(data.userId.trim(), data.password)
      : await signUp(data.userId.trim(), data.password);
    if (result.success) {
      if (isLogin) onSuccess();
      else showAlert('Success', 'Account created successfully.', () => setIsLogin(true));
    } else {
      showAlert('Error', result.message || 'Action failed');
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
          <View style={styles.field}><User size={18} color={THEME.textMuted} /><TextInput placeholder="User ID" placeholderTextColor={THEME.textMuted} style={styles.fieldInput} value={data.userId} onChangeText={v => setData({ ...data, userId: v })} /></View>
          <View style={styles.field}><Key size={18} color={THEME.textMuted} /><TextInput secureTextEntry placeholder="Password" placeholderTextColor={THEME.textMuted} style={styles.fieldInput} onChangeText={v => setData({ ...data, password: v })} /></View>
          <TouchableOpacity style={styles.primaryBtn} onPress={submit} disabled={isLoading}>
            <LinearGradient colors={[THEME.primary, THEME.secondary]} style={styles.primaryBtnInner}>
              {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{isLogin ? 'Sign In' : 'Sign Up'}</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => setIsLogin(!isLogin)} style={styles.switchBox}><Text style={styles.switchText}>{isLogin ? 'New user? Create account' : 'Already have an account? Sign in'}</Text></TouchableOpacity>
      </SafeAreaView>
    </View>
  );
};

// --- HOME SCREEN ---
const HomeScreen = ({ user, device, setScreen }: any) => (
  <View style={styles.homePage}>
    <LinearGradient colors={[THEME.surface, THEME.background]} style={styles.headerBg} />
    <SafeAreaView>
      <View style={styles.headerRow}>
        <View><Text style={styles.headerLabel}>AUTHENTICATED AS</Text><Text style={styles.headerName}>{user?.name}</Text><Text style={styles.headerId}>ID: {user?.userId}</Text></View>
        <TouchableOpacity onPress={() => setScreen('bt')} style={[styles.btButton, device && styles.btButtonActive]}><Bluetooth size={26} color={device ? THEME.primary : THEME.textMuted} /></TouchableOpacity>
      </View>
      <View style={styles.headerIcons}>
        <TouchableOpacity style={styles.headerIconBox} onPress={() => setScreen('history')}><FileText size={18} color={THEME.primary} /><Text style={styles.headerIconLabel}>History</Text></TouchableOpacity>
        <TouchableOpacity style={styles.headerIconBox} onPress={() => setScreen('settings')}><Settings size={18} color={THEME.secondary} /><Text style={styles.headerIconLabel}>Settings</Text></TouchableOpacity>
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
        <TouchableOpacity style={styles.gridCard} onPress={() => setScreen('dc-setup')}><View style={[styles.gridIcon, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}><PhoneCall size={24} color={THEME.success} /></View><Text style={styles.gridTitle}>Direct Call</Text><Text style={styles.gridDesc}>1-on-1 ID Search</Text></TouchableOpacity>
        <TouchableOpacity style={styles.gridCard} onPress={() => setScreen('mt-setup')}><View style={[styles.gridIcon, { backgroundColor: 'rgba(99, 102, 241, 0.1)' }]}><Users size={24} color={THEME.secondary} /></View><Text style={styles.gridTitle}>Meeting Table</Text><Text style={styles.gridDesc}>Group 3-5 Users</Text></TouchableOpacity>
      </View>
    </ScrollView>
  </View>
);

export default function App() {
  const { user, logout, isInitialized } = useAuth();
  const [screen, setScreen] = useState('home');
  const [device, setDevice] = useState(null);
  const [speakLang, setSpeakLang] = useState('UR');
  const [hearLang, setHearLang] = useState('EN');
  const [participants, setParticipants] = useState(3);
  const [cloningEnabled, setCloningEnabled] = useState(false);
  const [participantIds, setParticipantIds] = useState('');
  const [activeConfig, setActiveConfig] = useState<any>(null);

  // --- NEW STATES FOR CALL FUNCTIONALITY ---
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(true);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState<Record<number, string>>({});
  
  // State for Incoming Call Popup
 const [incomingCall, setIncomingCall] = useState<{callerName: string, callerId: string} | null>(null);

  useEffect(() => {
    let interval: any;
    if (screen.includes('active')) {
      interval = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
        const randomIdx = Math.floor(Math.random() * (activeConfig?.length || 1));
        const randomText = DUMMY_TRANSCRIPTS[Math.floor(Math.random() * DUMMY_TRANSCRIPTS.length)];
        setLiveTranscript(prev => ({ ...prev, [randomIdx]: randomText }));
      }, 3000);
    } else {
      setRecordingSeconds(0);
      setLiveTranscript({});
      setIsMuted(false);
      setIsSpeaker(true);
    }
    return () => clearInterval(interval);
  }, [screen]);

  // Test effect to show popup after 5 seconds (Only for demo)
  useEffect(() => {
    if (user && screen === 'home') {
      const timer = setTimeout(() => {
        setIncomingCall({ callerName: 'Abdullah', callerId: 'abdullah_test' });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [user, screen]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const Header = ({ title }: any) => (
    <View style={styles.navHeader}>
      <TouchableOpacity style={styles.backBtn} onPress={() => setScreen('home')}><ChevronLeft size={26} color={THEME.textMain} /></TouchableOpacity>
      <Text style={styles.navTitle}>{title}</Text>
      <div style={{ width: 40 }} />
    </View>
  );

  if (!isInitialized) {
    return (
      <View style={[styles.darkPage, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={THEME.primary} />
      </View>
    );
  }
  if (!user) return <AuthScreen onSuccess={() => setScreen('home')} />;

  if (screen.includes('active')) return (
    <View style={styles.livePage}>
      <StatusBar hidden />
      <View style={styles.liveTop}>
        <View style={styles.recordingIndicator}>
          <Circle size={10} color={THEME.danger} fill={THEME.danger} />
          <Text style={styles.recText}>REC {formatTime(recordingSeconds)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.liveLabel}>● LIVE BRIDGE</Text>
          {cloningEnabled && <Text style={styles.cloningStatusLabel}>AI CLONE ACTIVE</Text>}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.participantsGrid}>
        {activeConfig?.map((p: any, i: number) => (
          <View key={i} style={[styles.participantTile, i === 0 && styles.tileActive]}>
            <View style={styles.tileTopRow}>
               <View style={[styles.avatarBox, i === 0 && cloningEnabled && { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                {i === 0 && cloningEnabled ? <Mic size={24} color={THEME.success} /> : <Text style={styles.avatarLetter}>{p.userId?.charAt(0) || 'U'}</Text>}
              </View>
              {i === 0 && isMuted && <MicOff size={16} color={THEME.danger} />}
            </View>
           
            <View style={styles.infoBox}>
              <Text style={styles.tileName}>{i === 0 ? "You" : p.userId}</Text>
              <Text style={styles.tileLang}>{p.speak} ➜ {p.hear}</Text>
            </View>

            <View style={styles.transcriptContainer}>
              <Text style={styles.transcriptText} numberOfLines={2}>
                {liveTranscript[i] || "Waiting for audio..."}
              </Text>
            </View>

            <View style={styles.tileWave}><Activity size={16} color={i === 0 && cloningEnabled ? THEME.success : THEME.primary} /></View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.bottomControls}>
        <TouchableOpacity 
          style={[styles.roundControl, isMuted && { backgroundColor: 'rgba(244, 63, 94, 0.2)', borderColor: THEME.danger }]} 
          onPress={() => setIsMuted(!isMuted)}
        >
          {isMuted ? <MicOff size={24} color={THEME.danger} /> : <Mic size={24} color={THEME.textMain} />}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setScreen('home')} style={[styles.roundControl, styles.endCall]}>
          <PhoneCall size={26} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.roundControl, !isSpeaker && { opacity: 0.5 }]} 
          onPress={() => setIsSpeaker(!isSpeaker)}
        >
          {isSpeaker ? <Volume2 size={24} color={THEME.primary} /> : <VolumeX size={24} color={THEME.textMuted} />}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: THEME.background }}>
      <StatusBar barStyle="light-content" />

      {/* --- INCOMING CALL POPUP --- */}
      {incomingCall && (
        <View style={styles.incomingPopupOverlay}>
          <LinearGradient colors={[THEME.surface, '#1E293B']} style={styles.incomingCard}>
            <View style={styles.popupHeader}>
              <View style={styles.pulseContainer}>
                <View style={styles.avatarLarge}>
                  <User size={32} color={THEME.primary} />
                </View>
              </View>
              <Text style={styles.incomingLabel}>INCOMING BRIDGE CALL</Text>
              <Text style={styles.callerName}>{incomingCall.callerName}</Text>
              <Text style={styles.callerId}>ID: {incomingCall.callerId}</Text>
            </View>

            <View style={styles.popupActions}>
              <TouchableOpacity 
                style={[styles.actionCircle, { backgroundColor: THEME.danger }]} 
                onPress={() => setIncomingCall(null)}
              >
                <MicOff size={24} color="#fff" />
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.actionCircle, { backgroundColor: THEME.success }]} 
                onPress={() => {
                  setActiveConfig([
                    { userId: user?.userId, speak: speakLang, hear: hearLang },
                    { userId: incomingCall.callerId, speak: hearLang, hear: speakLang }
                  ]);
                  setScreen('active');
                  setIncomingCall(null);
                }}
              >
                <PhoneCall size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>
      )}

      {screen === 'home' && <HomeScreen user={user} device={device} setScreen={setScreen} />}

      {screen.includes('setup') && (
        <SafeAreaView style={styles.darkPage}>
          <Header title="Configuration" />
          <ScrollView style={{ padding: 20 }}>
            {screen === 'as-setup' && !device ? (
              <View style={styles.errorBox}><Bluetooth size={32} color={THEME.danger} /><Text style={styles.errorTitle}>Headset Required</Text><TouchableOpacity style={styles.errorBtn} onPress={() => setScreen('bt')}><Text style={styles.errorBtnText}>Pair Now</Text></TouchableOpacity></View>
            ) : (
              <>
                {screen === 'dc-setup' && <View style={{ marginBottom: 25 }}><Text style={styles.labelDark}>REMOTE USER ID</Text><TextInput placeholder="Target ID" style={styles.inputWhite} placeholderTextColor={THEME.textMuted} onChangeText={setParticipantIds} /></View>}
                
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
                    let config = [];
                    config.push({ userId: user.userId || 'You', speak: speakLang, hear: hearLang });

                    if (screen === 'as-setup') {
                      config.push({ userId: 'user', speak: hearLang, hear: speakLang });
                    } 
                    else if (screen === 'dc-setup') {
                      const targetId = participantIds.trim() || 'Remote User';
                      config.push({ userId: targetId, speak: hearLang, hear: speakLang });
                    } 
                    else if (screen === 'mt-setup') {
                      const ids = participantIds.split(',').map(id => id.trim()).filter(id => id !== '');
                      for (let i = 1; i < participants; i++) {
                        config.push({ 
                          userId: ids[i-1] || `User ${i + 1}`, 
                          speak: hearLang, 
                          hear: speakLang 
                        });
                      }
                    }
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

      {screen === 'bt' && (
        <SafeAreaView style={styles.darkPage}>
          <Header title="Device Pairing" />
          <View style={styles.centerBox}><Bluetooth size={60} color={THEME.primary} /><Text style={styles.centerTitle}>Scanning...</Text><TouchableOpacity style={styles.scanOption} onPress={() => { setDevice('Galaxy Buds' as any); setScreen('home'); }}><Text style={styles.scanText}>Galaxy Buds Pro</Text><Check size={18} color={THEME.primary} /></TouchableOpacity></View>
        </SafeAreaView>
      )}

      {screen === 'history' && (
        <SafeAreaView style={styles.darkPage}>
          <Header title="Call Logs & History" />
          <ScrollView style={{ padding: 20 }}>
            <View style={styles.historyItem}>
              <View style={styles.historyHeader}>
                <View>
                  <Text style={styles.historyTitle}>Team Strategy Session</Text>
                  <Text style={styles.historyDate}>Feb 21, 2026 • 12:45 PM</Text>
                </View>
                <Activity size={20} color={THEME.primary} />
              </View>
              <View style={styles.transcriptPreview}>
                <Text style={styles.transcriptPreviewText} numberOfLines={2}>
                  "The speech-to-speech bridge is working perfectly. Testing Urdu to English cloning..."
                </Text>
              </View>
              <View style={styles.historyActions}>
                <TouchableOpacity style={[styles.actionBtn, styles.playBtn]} onPress={() => showAlert('Audio Player', 'Playing the recorded conversation...')}>
                  <Play size={16} color={THEME.primary} />
                  <Text style={styles.actionBtnText}>Play Audio</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.pdfBtn]} onPress={() => showAlert('Export PDF', 'Transcript has been saved to your documents as PDF.')}>
                  <FileText size={16} color={THEME.secondary} />
                  <Text style={styles.actionBtnText}>Save PDF</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={{ color: THEME.textMuted, textAlign: 'center', marginTop: 20, fontSize: 12 }}>
              Only recent 50 calls are stored locally.
            </Text>
          </ScrollView>
        </SafeAreaView>
      )}

      {screen === 'settings' && <SafeAreaView style={styles.darkPage}><Header title="Profile" /><View style={{ padding: 20 }}><View style={styles.profileBox}><View style={styles.profileAvatar}><Text style={styles.profileLetter}>{user?.name?.charAt(0) ?? '?'}</Text></View><View><Text style={styles.profileName}>{user?.name}</Text><Text style={styles.profileId}>ID: {user?.userId}</Text></View></View><TouchableOpacity style={styles.logoutBtn} onPress={() => { logout(); setScreen('auth'); }}><LogOut size={18} color={THEME.danger} /><Text style={styles.logoutText}>Sign Out</Text></TouchableOpacity></View></SafeAreaView>}
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
  playBox: { padding: 12, backgroundColor: THEME.background, borderRadius: 14, borderWidth: 1, borderColor: THEME.border },
  profileBox: { backgroundColor: THEME.surface, padding: 20, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 16, borderWidth: 1, borderColor: THEME.border },
  profileAvatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: THEME.background, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: THEME.border },
  profileLetter: { color: THEME.primary, fontSize: 22, fontWeight: '800' },
  profileName: { color: THEME.textMain, fontSize: 18, fontWeight: '800' },
  profileId: { color: THEME.textMuted, fontSize: 12 },
  logoutBtn: { marginTop: 20, backgroundColor: 'rgba(244, 63, 94, 0.1)', padding: 15, borderRadius: 15, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  logoutText: { color: THEME.danger, fontWeight: '800' },
  cloningCard: { backgroundColor: THEME.surface, padding: 20, borderRadius: 24, flexDirection: 'row', alignItems: 'center', marginBottom: 25, borderWidth: 1, borderColor: THEME.border },
  cloningIconBox: { width: 48, height: 48, backgroundColor: THEME.background, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 16, borderWidth: 1, borderColor: THEME.border },
  cloningTitle: { color: THEME.textMain, fontWeight: '800', fontSize: 16 },
  cloningDesc: { color: THEME.textMuted, fontSize: 12, marginTop: 2 },
  toggleTrack: { width: 46, height: 24, borderRadius: 12, backgroundColor: THEME.background, padding: 3, borderWidth: 1, borderColor: THEME.border },
  toggleTrackActive: { backgroundColor: THEME.primary, borderColor: THEME.primary },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: THEME.textMuted },
  toggleThumbActive: { alignSelf: 'flex-end', backgroundColor: '#fff' },
  recordingIndicator: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.3)', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20 },
  recText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  transcriptContainer: { backgroundColor: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 10, marginTop: 8, height: 45, justifyContent: 'center' },
  transcriptText: { color: THEME.primary, fontSize: 10, fontStyle: 'italic' },
  tileTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  infoBox: { marginTop: 4 },
  historyItem: { backgroundColor: THEME.surface, padding: 18, borderRadius: 24, marginBottom: 16, borderWidth: 1, borderColor: THEME.border },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  historyTitle: { color: THEME.textMain, fontSize: 17, fontWeight: '800' },
  historyDate: { color: THEME.textMuted, fontSize: 12, marginTop: 2 },
  transcriptPreview: { backgroundColor: THEME.background, padding: 12, borderRadius: 14, marginBottom: 15, borderWidth: 1, borderColor: THEME.border },
  transcriptPreviewText: { color: THEME.textMuted, fontSize: 12, fontStyle: 'italic', lineHeight: 18 },
  historyActions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  playBtn: { backgroundColor: 'rgba(6, 182, 212, 0.1)', borderColor: THEME.primary },
  pdfBtn: { backgroundColor: 'rgba(99, 102, 241, 0.1)', borderColor: THEME.secondary },
  actionBtnText: { color: THEME.textMain, fontSize: 12, fontWeight: '700' },
  // --- INCOMING CALL STYLES ---
  incomingPopupOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 18, 25, 0.95)', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: 30 },
  incomingCard: { width: '100%', borderRadius: 40, padding: 30, alignItems: 'center', borderWidth: 1, borderColor: THEME.border, elevation: 20 },
  popupHeader: { alignItems: 'center', marginBottom: 40 },
  incomingLabel: { color: THEME.primary, fontSize: 12, fontWeight: '900', letterSpacing: 2, marginBottom: 10 },
  callerName: { color: THEME.textMain, fontSize: 28, fontWeight: '800' },
  callerId: { color: THEME.textMuted, fontSize: 14, marginTop: 4 },
  avatarLarge: { width: 80, height: 80, borderRadius: 40, backgroundColor: THEME.background, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: THEME.primary },
  popupActions: { flexDirection: 'row', gap: 40 },
  actionCircle: { width: 65, height: 65, borderRadius: 33, justifyContent: 'center', alignItems: 'center', elevation: 10 },
  pulseContainer: { marginBottom: 20, padding: 10, borderRadius: 100, backgroundColor: 'rgba(6, 182, 212, 0.1)' }
});