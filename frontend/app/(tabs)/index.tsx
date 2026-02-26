import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator, Dimensions, Alert, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Globe, User, Key, ChevronLeft, Settings, FileText,
  Headphones, PhoneCall, Users, Check, Zap, Activity, MicOff,
  Volume2, Play, LogOut, Wifi, Mic, Cpu, VolumeX, Circle
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useSpeechRecognition, isWebSpeechSupported } from '@/hooks/useSpeechRecognition';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { Audio } from 'expo-av';
import { historyApi } from '@/api/history';
import { useRouter } from 'expo-router';

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

const LOCALE_MAP: Record<string, string> = {
  UR: 'ur-PK',
  EN: 'en-US',
  AR: 'ar-SA',
};

// Speak translated text using browser's built-in Speech Synthesis (web fallback)
function speakText(text: string, locale: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel(); // stop any ongoing speech
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = locale;
  window.speechSynthesis.speak(utterance);
}

// Play base64 MP3 audio from Google Cloud TTS
// Web: native HTMLAudioElement; Native: expo-av Sound
async function playAudio(audioBase64: string) {
  if (!audioBase64) return;
  console.log('[TTS] playAudio called, bytes:', audioBase64.length);

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    try {
      const audio = new window.Audio('data:audio/mp3;base64,' + audioBase64);
      await audio.play();
    } catch (e: any) {
      console.error('[TTS] web audio play error:', e);
    }
  } else {
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'data:audio/mp3;base64,' + audioBase64 },
        { shouldPlay: true }
      );
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch (e) {
      console.error('[TTS] native audio play error:', e);
    }
  }
}

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
const HomeScreen = ({ user, setScreen, router }: any) => (
  <View style={styles.homePage}>
    <LinearGradient colors={[THEME.surface, THEME.background]} style={styles.headerBg} />
    <SafeAreaView>
      <View style={styles.headerRow}>
        <View><Text style={styles.headerLabel}>AUTHENTICATED AS</Text><Text style={styles.headerName}>{user?.name}</Text><Text style={styles.headerId}>ID: {user?.userId}</Text></View>
        <TouchableOpacity onPress={() => setScreen('bt')} style={styles.btButton}><Wifi size={26} color={THEME.primary} /></TouchableOpacity>
      </View>
      <View style={styles.headerIcons}>
        <TouchableOpacity style={styles.headerIconBox} onPress={() => router.push('/history')}><FileText size={18} color={THEME.primary} /><Text style={styles.headerIconLabel}>History</Text></TouchableOpacity>
        <TouchableOpacity style={styles.headerIconBox} onPress={() => setScreen('settings')}><Settings size={18} color={THEME.secondary} /><Text style={styles.headerIconLabel}>Settings</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <TouchableOpacity style={styles.featureCard} onPress={() => setScreen('as-setup')}>
        <View style={styles.featureIcon}><Headphones size={26} color={THEME.primary} /></View>
        <Text style={styles.featureTitle}>Voice Assistant</Text>
        <Text style={styles.featureDesc}>Real-time background translation for your conversations.</Text>
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
  const router = useRouter();
  const [screen, setScreen] = useState('home');
  const [speakLang, setSpeakLang] = useState('UR');
  const [hearLang, setHearLang] = useState('EN');

  // Refs so translated-text handler always reads the latest values without stale closures
  const isSpeakerRef = React.useRef(true);
  const hearLangRef = React.useRef('EN');
  const [participants, setParticipants] = useState(3);
  const [cloningEnabled, setCloningEnabled] = useState(false);
  const [participantIds, setParticipantIds] = useState('');
  const [activeConfig, setActiveConfig] = useState<any>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [callState, setCallState] = useState<'idle' | 'calling' | 'in-call'>('idle');

  const [discoverableUsers, setDiscoverableUsers] = useState<{ userId: string; name: string }[]>([]);

  const { socket } = useSocket(user?.userId ?? null, user?._id ?? null);
  const { startListening, stopListening } = useSpeechRecognition();
  const { startRecording, stopRecording } = useAudioRecorder();
  
  // Track which STT mode is being used: 'browser' | 'audio-recorder' | null
  const [sttMode, setSttMode] = useState<'browser' | 'audio-recorder' | null>(null);

  // Keep roomId in a ref so the audio-chunk callback always has the latest
  // value without causing the STT effect to restart on every roomId change
  const roomIdRef = React.useRef<string | null>(null);
  roomIdRef.current = roomId;

  // ── Meeting mode state + refs ─────────────────────────────────────────────
  const [isMeetingMode, setIsMeetingMode] = useState(false);
  const isMeetingModeRef = React.useRef(false);
  isMeetingModeRef.current = isMeetingMode;

  const [meetingId, setMeetingId] = useState<string | null>(null);
  const meetingIdRef = React.useRef<string | null>(null);
  meetingIdRef.current = meetingId;

  const [incomingMeeting, setIncomingMeeting] = useState<{
    meetingId: string;
    hostUserId: string;
    hostName: string;
    totalParticipants: number;
  } | null>(null);

  const activeConfigRef = React.useRef<any>(null);
  // Keep activeConfigRef in sync (set below after activeConfig declaration)

  // Call start time for duration tracking
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const callStartTimeRef = React.useRef<number | null>(null);
  callStartTimeRef.current = callStartTime;

  // Inline lang pickers for the incoming call popup
  const [callInviteSpeakLang, setCallInviteSpeakLang] = useState('UR');
  const [callInviteHearLang, setCallInviteHearLang] = useState('EN');

  // Inline lang pickers for the meeting invite popup
  const [meetingInviteSpeakLang, setMeetingInviteSpeakLang] = useState('UR');
  const [meetingInviteHearLang, setMeetingInviteHearLang] = useState('EN');

  // Sync activeConfigRef so meeting-translated handler can read it without stale closure
  activeConfigRef.current = activeConfig;

  // --- NEW STATES FOR CALL FUNCTIONALITY ---
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(true);

  // Keep refs in sync so socket handlers always have latest values
  isSpeakerRef.current = isSpeaker;
  hearLangRef.current = hearLang;
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState<Record<number, string>>({});
  // State for Incoming Call Popup
 const [incomingCall, setIncomingCall] = useState<{callerName: string, callerId: string} | null>(null);

  useEffect(() => {
    let interval: any;
    if (screen.includes('active')) {
      interval = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
      setLiveTranscript({});
      setIsMuted(false);
      setIsSpeaker(true);
    }
    return () => clearInterval(interval);
  }, [screen]);

  // ── Socket event listeners ────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onIncomingCall = ({ callerId, callerName }: { callerId: string; callerName: string }) => {
      setIncomingCall({ callerId, callerName });
      setCallInviteSpeakLang(speakLang);
      setCallInviteHearLang(hearLang);
    };

    const onCallAccepted = ({
      roomId: rid,
      peerOdId,
      peerUserId,
      peerSpeakLang,
      peerHearLang,
    }: {
      roomId: string;
      peerOdId?: string;
      peerUserId: string;
      peerSpeakLang: string;
      peerHearLang: string;
    }) => {
      setRoomId(rid);
      
      // If we just accepted a call (incomingCall exists), use the popup-selected values
      // Otherwise (we are the caller), use the main state values
      const mySpeakLang = incomingCall ? callInviteSpeakLang : speakLang;
      const myHearLang = incomingCall ? callInviteHearLang : hearLang;
      
      setActiveConfig([
        { visitorId: user?._id, visitorUserId: user?.userId, userId: user?.userId, speak: mySpeakLang, hear: myHearLang },
        { visitorId: peerOdId || null, visitorUserId: peerUserId, userId: peerUserId, speak: peerSpeakLang, hear: peerHearLang },
      ]);
      setCallStartTime(Date.now());
      setCallState('in-call');
      setScreen('active');
      setIncomingCall(null);
    };

    const onCallDeclined = () => {
      setCallState('idle');
      showAlert('Call Declined', 'The user declined your call.');
    };

    const onCallEnded = ({ roomId: endedRoomId }: { roomId?: string } = {}) => {
      // Stop recording immediately to prevent sending audio to deleted room
      stopRecording();
      stopListening();
      
      // History is saved by the user who initiates end-call, not here
      setCallStartTime(null);
      setRoomId(null);
      setCallState('idle');
      setScreen('home');
    };
    
    const onTranslationError = ({ text, error }: { text: string; error: string }) => {
      console.warn('[Translation] Error:', error, 'Text:', text);
      // Show a brief notification but don't interrupt the call
      // The text will be shown in the transcript area
      setLiveTranscript(prev => ({ ...prev, 0: `[Translation failed] ${text}` }));
    };

    const onPeerDisconnected = () => {
      // History is saved by the user who initiates end-call
      setCallStartTime(null);
      setRoomId(null);
      setCallState('idle');
      setScreen('home');
      showAlert('Call Ended', 'The other participant disconnected.');
    };

    const onCallError = ({ message }: { message: string }) => {
      setCallState('idle');
      showAlert('Call Error', message);
    };

    const onDiscoverableUsers = (users: { userId: string; name: string }[]) => {
      setDiscoverableUsers(users);
    };

    // ── Meeting socket listeners ──────────────────────────────────────────────
    const onMeetingCreated = ({ meetingId: mid, config }: { meetingId: string; config: any[] }) => {
      setMeetingId(mid);
      setRoomId(mid);
      setActiveConfig(config.map(e => ({ userId: e.userId, speak: e.speak, hear: e.hear, status: e.status })));
      setIsMeetingMode(true);
      setCallState('in-call');
      setScreen('active');
    };

    const onIncomingMeetingInvite = (data: {
      meetingId: string; hostUserId: string; hostName: string; totalParticipants: number;
    }) => {
      setIncomingMeeting(data);
    };

    const onMeetingJoinedAck = ({ meetingId: mid, config }: { meetingId: string; config: any[] }) => {
      setMeetingId(mid);
      setRoomId(mid);
      setActiveConfig(config.map(e => ({ userId: e.userId, speak: e.speak, hear: e.hear, status: e.status })));
      setIsMeetingMode(true);
      setCallState('in-call');
      setScreen('active');
      setIncomingMeeting(null);
    };

    const onMeetingParticipantJoined = ({ updatedConfig }: { meetingId: string; userId: string; speakLang: string; hearLang: string; updatedConfig: any[] }) => {
      setActiveConfig(updatedConfig.map(e => ({ userId: e.userId, speak: e.speak, hear: e.hear, status: e.status })));
      setLiveTranscript({});
    };

    const onMeetingParticipantDeclined = ({ userId }: { meetingId: string; userId: string }) => {
      showAlert('Meeting Update', `${userId} declined the invitation.`);
      setActiveConfig((prev: any) => prev ? prev.filter((p: any) => p.userId !== userId) : prev);
    };

    const onMeetingParticipantLeft = ({ userId }: { meetingId: string; userId: string }) => {
      showAlert('Meeting Update', `${userId} has left the meeting.`);
      setActiveConfig((prev: any) => prev ? prev.filter((p: any) => p.userId !== userId) : prev);
    };

    const onMeetingEnded = ({ reason }: { meetingId: string; reason: string }) => {
      setMeetingId(null);
      setRoomId(null);
      setIsMeetingMode(false);
      setCallState('idle');
      setScreen('home');
      setActiveConfig(null);
      const msg = reason === 'host-disconnected' ? 'The host disconnected.' : 'The host ended the meeting.';
      showAlert('Meeting Ended', msg);
    };

    const onMeetingError = ({ message }: { message: string }) => {
      showAlert('Meeting Error', message);
    };

    socket.on('meeting-created', onMeetingCreated);
    socket.on('incoming-meeting-invite', onIncomingMeetingInvite);
    socket.on('meeting-joined-ack', onMeetingJoinedAck);
    socket.on('meeting-participant-joined', onMeetingParticipantJoined);
    socket.on('meeting-participant-declined', onMeetingParticipantDeclined);
    socket.on('meeting-participant-left', onMeetingParticipantLeft);
    socket.on('meeting-ended', onMeetingEnded);
    socket.on('meeting-error', onMeetingError);

    socket.on('incoming-call', onIncomingCall);
    socket.on('call-accepted', onCallAccepted);
    socket.on('call-declined', onCallDeclined);
    socket.on('call-ended', onCallEnded);
    socket.on('peer-disconnected', onPeerDisconnected);
    socket.on('call-error', onCallError);
    socket.on('discoverable-users', onDiscoverableUsers);
    socket.on('translation-error', onTranslationError);

    // When the socket reconnects the backend has already deleted the room
    // (via the disconnect handler). The reconnecting client never receives
    // peer-disconnected, so without this it would keep sending stale audio
    // chunks and see endless "room not found" errors.
    const onReconnect = () => {
      if (roomIdRef.current) {
        setRoomId(null);
        setMeetingId(null);
        setIsMeetingMode(false);
        setCallState('idle');
        setScreen('home');
        setActiveConfig(null);
        showAlert('Call Ended', 'Connection was lost.');
      }
    };
    socket.on('connect', onReconnect);

    return () => {
      socket.off('connect', onReconnect);
      socket.off('meeting-created', onMeetingCreated);
      socket.off('incoming-meeting-invite', onIncomingMeetingInvite);
      socket.off('meeting-joined-ack', onMeetingJoinedAck);
      socket.off('meeting-participant-joined', onMeetingParticipantJoined);
      socket.off('meeting-participant-declined', onMeetingParticipantDeclined);
      socket.off('meeting-participant-left', onMeetingParticipantLeft);
      socket.off('meeting-ended', onMeetingEnded);
      socket.off('meeting-error', onMeetingError);
      socket.off('incoming-call', onIncomingCall);
      socket.off('call-accepted', onCallAccepted);
      socket.off('call-declined', onCallDeclined);
      socket.off('call-ended', onCallEnded);
      socket.off('peer-disconnected', onPeerDisconnected);
      socket.off('call-error', onCallError);
      socket.off('discoverable-users', onDiscoverableUsers);
      socket.off('translation-error', onTranslationError);
    };
  }, [socket, user, speakLang, hearLang, stopRecording, stopListening]);

  // ── Discoverable mode: emit start/stop based on screen ───────────────────
  useEffect(() => {
    if (!socket || !user) return;
    if (screen === 'bt') {
      socket.emit('start-discoverable', { userId: user.userId, name: user.name || user.userId });
    } else {
      socket.emit('stop-discoverable', { userId: user.userId });
      setDiscoverableUsers([]);
    }
  }, [screen, socket, user]);

  // ── translated-text — always reads latest isSpeaker/hearLang via refs ────
  useEffect(() => {
    if (!socket) return;

    const onTranslatedText = ({ text, audioBase64 }: { text: string; audioBase64?: string }) => {
      console.log('[pipeline] translated-text received:', text, 'isSpeaker:', isSpeakerRef.current);
      if (isSpeakerRef.current) {
        if (audioBase64) {
          playAudio(audioBase64);
        } else if (Platform.OS === 'web') {
          speakText(text, LOCALE_MAP[hearLangRef.current]);
        }
      }
      setLiveTranscript(prev => ({ ...prev, 1: text }));
    };

    socket.on('translated-text', onTranslatedText);

    // Show the raw Google STT transcript on your own tile (tile 0)
    const onSpeechTranscript = ({ text }: { text: string }) => {
      setLiveTranscript(prev => ({ ...prev, 0: `🎤 ${text}` }));
    };
    socket.on('speech-transcript', onSpeechTranscript);

    // ── Meeting translated text ────────────────────────────────────────────────
    const onMeetingTranslated = ({ text, audioBase64, fromUserId }: { text: string; audioBase64?: string; fromUserId: string; meetingId: string }) => {
      const cfg = activeConfigRef.current;
      if (!cfg) return;
      const idx = cfg.findIndex((p: any) => p.userId === fromUserId);
      if (idx === -1) return;
      if (isSpeakerRef.current) {
        if (audioBase64) {
          playAudio(audioBase64);
        } else if (Platform.OS === 'web') {
          speakText(text, LOCALE_MAP[hearLangRef.current]);
        }
      }
      setLiveTranscript(prev => ({ ...prev, [idx]: text }));
    };
    socket.on('meeting-translated', onMeetingTranslated);

    const onMeetingSpeechTranscript = ({ text }: { text: string }) => {
      setLiveTranscript(prev => ({ ...prev, 0: `🎤 ${text}` }));
    };
    socket.on('meeting-speech-transcript', onMeetingSpeechTranscript);

    return () => {
      socket.off('translated-text', onTranslatedText);
      socket.off('speech-transcript', onSpeechTranscript);
      socket.off('meeting-translated', onMeetingTranslated);
      socket.off('meeting-speech-transcript', onMeetingSpeechTranscript);
    };
  }, [socket]); // refs keep values fresh — no stale closure risk

  // ── Hybrid Audio Capture ────────────────────────────────────────────────────
  // For languages supported by Web Speech API (EN, AR): use browser STT
  // For unsupported languages (UR): use audio recorder → Google Cloud STT
  useEffect(() => {
    const isActive = screen.includes('active');
    if (!isActive || isMuted) {
      stopListening();
      stopRecording();
      setSttMode(null);
      return;
    }

    const locale = LOCALE_MAP[speakLang];
    const useWebSpeech = isWebSpeechSupported(locale);
    
    console.log(`[pipeline] STT starting for ${speakLang} (${locale}), useWebSpeech: ${useWebSpeech}`);

    if (useWebSpeech) {
      // Use Web Speech API for supported languages (English, Arabic)
      setSttMode('browser');
      const started = startListening(
        locale,
        (text: string) => {
          if (isMeetingModeRef.current) {
            socket?.emit('meeting-speech-text', { meetingId: meetingIdRef.current, text });
          } else {
            socket?.emit('speech-text', { roomId: roomIdRef.current, text });
          }
          setLiveTranscript(prev => ({ ...prev, 0: `🎤 ${text}` }));
        },
        () => showAlert(
          'Microphone Blocked',
          'Allow microphone access:\n1. Click the lock icon\n2. Set Microphone → Allow\n3. Refresh the page',
        ),
        (interim: string) => {
          setLiveTranscript(prev => ({ ...prev, 0: `🎤 ${interim}...` }));
        },
        () => {
          // Fallback to audio recorder if Web Speech fails
          console.log('[pipeline] Web Speech failed, falling back to audio recorder');
          startAudioRecorderMode();
        }
      );
      if (!started) {
        startAudioRecorderMode();
      }
    } else {
      // Use Audio Recorder for unsupported languages (Urdu)
      startAudioRecorderMode();
    }

    function startAudioRecorderMode() {
      setSttMode('audio-recorder');
      console.log('[pipeline] Using audio recorder for', locale);
      setLiveTranscript(prev => ({ ...prev, 0: '🎙️ Recording...' }));
      
      startRecording(
        (audioBase64: string, mimeType: string) => {
          console.log('[pipeline] Sending audio chunk to backend for STT');
          if (isMeetingModeRef.current) {
            socket?.emit('meeting-audio-chunk', {
              meetingId: meetingIdRef.current,
              audioBase64,
              mimeType,
            });
          } else {
            socket?.emit('audio-chunk', {
              roomId: roomIdRef.current,
              audioBase64,
              mimeType,
            });
          }
        },
        () => showAlert(
          'Microphone Blocked',
          'Allow microphone access:\n1. Click the lock icon\n2. Set Microphone → Allow\n3. Refresh the page',
        ),
      );
    }

    return () => { 
      stopListening(); 
      stopRecording();
      setSttMode(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, isMuted, socket, speakLang, startListening, stopListening, startRecording, stopRecording]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const Header = ({ title }: any) => (
    <View style={styles.navHeader}>
      <TouchableOpacity style={styles.backBtn} onPress={() => setScreen('home')}><ChevronLeft size={26} color={THEME.textMain} /></TouchableOpacity>
      <Text style={styles.navTitle}>{title}</Text>
      <View style={{ width: 40 }} />
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
          {!isMuted && sttMode && (
            <Text style={{ color: THEME.success, fontSize: 10, fontWeight: '800', marginTop: 2 }}>
              {sttMode === 'browser' ? '🎤 LISTENING' : '🎙️ RECORDING'}
            </Text>
          )}
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
          onPress={() => setIsMuted(prev => !prev)}
        >
          {isMuted ? <MicOff size={24} color={THEME.danger} /> : <Mic size={24} color={THEME.textMain} />}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={async () => {
            // Save call history before ending
            if (!isMeetingMode && user?._id && activeConfig && callStartTime) {
              const duration = Math.floor((Date.now() - callStartTime) / 1000);
              try {
                const participants = activeConfig.map((p: any) => ({
                  user: p.visitorId || user._id,
                  languageSpoken: p.speak,
                  languageHeard: p.hear,
                }));
                
                await historyApi.create({
                  initiatedBy: user._id,
                  participants,
                  callType: 'One to One Call',
                  duration,
                });
                console.log('[History] Call saved (end button), duration:', duration);
              } catch (err: any) {
                console.error('[History] Save error:', err.message);
              }
            }
            
            if (isMeetingMode) {
              if (meetingId) socket?.emit('leave-meeting', { meetingId });
              setMeetingId(null);
              setRoomId(null);
              setIsMeetingMode(false);
            } else {
              if (roomId) socket?.emit('end-call', { roomId });
              setRoomId(null);
            }
            setCallStartTime(null);
            setCallState('idle');
            setScreen('home');
            setActiveConfig(null);
          }}
          style={[styles.roundControl, styles.endCall]}>
          {isMeetingMode
            ? <LogOut size={26} color="#fff" />
            : <PhoneCall size={26} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />}
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

            {/* Language pickers so receiver can choose before accepting */}
            <View style={{ width: '100%', marginBottom: 24 }}>
              <Text style={[styles.labelDark, { marginBottom: 6 }]}>I WILL SPEAK</Text>
              <View style={styles.langRow}>
                {LANGUAGES.map(l => (
                  <TouchableOpacity
                    key={'cs' + l.code}
                    onPress={() => setCallInviteSpeakLang(l.code)}
                    style={[styles.langSelect, callInviteSpeakLang === l.code && styles.langSelectActive]}
                  >
                    <Text style={styles.flag}>{l.flag}</Text>
                    <Text style={[styles.langName, callInviteSpeakLang === l.code && styles.langNameActive]}>{l.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.labelDark, { marginTop: 14, marginBottom: 6 }]}>I WANT TO HEAR</Text>
              <View style={styles.langRow}>
                {LANGUAGES.map(l => (
                  <TouchableOpacity
                    key={'ch' + l.code}
                    onPress={() => setCallInviteHearLang(l.code)}
                    style={[styles.langSelect, callInviteHearLang === l.code && styles.langSelectActive]}
                  >
                    <Text style={styles.flag}>{l.flag}</Text>
                    <Text style={[styles.langName, callInviteHearLang === l.code && styles.langNameActive]}>{l.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.popupActions}>
              <TouchableOpacity
                style={[styles.actionCircle, { backgroundColor: THEME.danger }]}
                onPress={() => {
                  socket?.emit('decline-call', { callerId: incomingCall.callerId });
                  setIncomingCall(null);
                }}
              >
                <MicOff size={24} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionCircle, { backgroundColor: THEME.success }]}
                onPress={() => {
                  // Update global state with selected languages before accepting
                  setSpeakLang(callInviteSpeakLang);
                  setHearLang(callInviteHearLang);
                  
                  socket?.emit('accept-call', {
                    callerId: incomingCall.callerId,
                    speakLang: callInviteSpeakLang,
                    hearLang: callInviteHearLang,
                  });
                }}
              >
                <PhoneCall size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>
      )}

      {/* --- INCOMING MEETING INVITE POPUP --- */}
      {incomingMeeting && !incomingCall && (
        <View style={styles.incomingPopupOverlay}>
          <LinearGradient colors={[THEME.surface, '#1E293B']} style={styles.incomingCard}>
            <View style={styles.popupHeader}>
              <View style={styles.pulseContainer}>
                <View style={styles.avatarLarge}>
                  <Users size={32} color={THEME.secondary} />
                </View>
              </View>
              <Text style={[styles.incomingLabel, { color: THEME.secondary }]}>MEETING TABLE INVITE</Text>
              <Text style={styles.callerName}>{incomingMeeting.hostName}</Text>
              <Text style={styles.callerId}>Host ID: {incomingMeeting.hostUserId}</Text>
              <Text style={[styles.callerId, { marginTop: 4 }]}>{incomingMeeting.totalParticipants} participants</Text>
            </View>

            {/* Language pickers so invitee can choose before joining */}
            <View style={{ width: '100%', marginBottom: 24 }}>
              <Text style={[styles.labelDark, { marginBottom: 6 }]}>I WILL SPEAK</Text>
              <View style={styles.langRow}>
                {LANGUAGES.map(l => (
                  <TouchableOpacity
                    key={'ms' + l.code}
                    onPress={() => setMeetingInviteSpeakLang(l.code)}
                    style={[styles.langSelect, meetingInviteSpeakLang === l.code && styles.langSelectActive]}
                  >
                    <Text style={styles.flag}>{l.flag}</Text>
                    <Text style={[styles.langName, meetingInviteSpeakLang === l.code && styles.langNameActive]}>{l.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.labelDark, { marginTop: 14, marginBottom: 6 }]}>I WANT TO HEAR</Text>
              <View style={styles.langRow}>
                {LANGUAGES.map(l => (
                  <TouchableOpacity
                    key={'mh' + l.code}
                    onPress={() => setMeetingInviteHearLang(l.code)}
                    style={[styles.langSelect, meetingInviteHearLang === l.code && styles.langSelectActive]}
                  >
                    <Text style={styles.flag}>{l.flag}</Text>
                    <Text style={[styles.langName, meetingInviteHearLang === l.code && styles.langNameActive]}>{l.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.popupActions}>
              <TouchableOpacity
                style={[styles.actionCircle, { backgroundColor: THEME.danger }]}
                onPress={() => {
                  socket?.emit('decline-meeting', {
                    meetingId: incomingMeeting.meetingId,
                    hostUserId: incomingMeeting.hostUserId,
                  });
                  setIncomingMeeting(null);
                }}
              >
                <MicOff size={24} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionCircle, { backgroundColor: THEME.success }]}
                onPress={() => {
                  socket?.emit('join-meeting', {
                    meetingId: incomingMeeting.meetingId,
                    speakLang: meetingInviteSpeakLang,
                    hearLang: meetingInviteHearLang,
                  });
                }}
              >
                <Users size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>
      )}

      {screen === 'home' && <HomeScreen user={user} setScreen={setScreen} router={router} />}

      {screen.includes('setup') && (
        <SafeAreaView style={styles.darkPage}>
          <Header title="Configuration" />
          <ScrollView style={{ padding: 20 }}>
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
                    if (screen === 'dc-setup') {
                      const targetId = participantIds.trim();
                      if (!targetId) {
                        showAlert('Error', 'Please enter the target user ID.');
                        return;
                      }
                      setCallState('calling');
                      socket?.emit('call-user', {
                        targetUserId: targetId,
                        callerName: user?.userId,
                        speakLang,
                        hearLang,
                      });
                      return;
                    }

                    if (screen === 'mt-setup') {
                      const ids = participantIds.split(',').map((id: string) => id.trim()).filter((id: string) => id !== '');
                      if (ids.length < participants - 1) {
                        showAlert('Error', `Please enter ${participants - 1} participant ID(s).`);
                        return;
                      }
                      const generatedMeetingId = `mt_${user?.userId}_${Date.now()}`;
                      const invitees = ids.slice(0, participants - 1).map(uid => ({
                        userId: uid,
                        speakLang: hearLang,
                        hearLang: speakLang,
                      }));
                      socket?.emit('create-meeting', {
                        meetingId: generatedMeetingId,
                        hostSpeakLang: speakLang,
                        hostHearLang: hearLang,
                        invitees,
                      });
                      return; // Screen nav happens in 'meeting-created' socket handler
                    }

                    // Original behavior for as-setup
                    let config: any[] = [];
                    config.push({ userId: user.userId || 'You', speak: speakLang, hear: hearLang });
                    if (screen === 'as-setup') {
                      config.push({ userId: 'user', speak: hearLang, hear: speakLang });
                    }
                    setActiveConfig(config);
                    setScreen('active');
                  }}
                >
                  <Zap size={20} color="#fff" /><Text style={styles.launchText}>Initialize Secure Bridge</Text>
                </TouchableOpacity>
            </>
          </ScrollView>
        </SafeAreaView>
      )}

      {screen === 'bt' && (
        <SafeAreaView style={styles.darkPage}>
          <Header title="Nearby Users" />

          {/* Icon */}
          <View style={btStyles.radarWrap}>
            <Wifi size={36} color={THEME.primary} />
          </View>

          {discoverableUsers.length === 0 ? (
            <Text style={btStyles.hint}>Looking for online Voice Bridge users...</Text>
          ) : (
            <ScrollView style={{ paddingHorizontal: 20 }}>
              <Text style={btStyles.sectionLabel}>ONLINE VOICE BRIDGE USERS</Text>
              {discoverableUsers.map((peer) => (
                <TouchableOpacity
                  key={peer.userId}
                  style={btStyles.peerCard}
                  onPress={() => {
                    setCallState('calling');
                    socket?.emit('call-user', {
                      targetUserId: peer.userId,
                      callerName: user?.userId,
                      speakLang,
                      hearLang,
                    });
                    setScreen('home');
                  }}
                >
                  <View style={btStyles.peerAvatar}>
                    <Text style={btStyles.peerLetter}>{peer.userId.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={btStyles.peerName}>{peer.name || peer.userId}</Text>
                    <Text style={btStyles.peerId}>ID: {peer.userId}</Text>
                  </View>
                  <View style={btStyles.connectBtn}>
                    <Wifi size={14} color="#fff" />
                    <Text style={btStyles.connectText}>Connect</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
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

const btStyles = StyleSheet.create({
  statusBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginTop: 12, padding: 14, backgroundColor: THEME.surface, borderRadius: 16, borderWidth: 1, borderColor: THEME.border },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: THEME.success },
  dotOff: { backgroundColor: THEME.danger },
  statusText: { color: THEME.textMain, fontSize: 13, fontWeight: '600', flex: 1 },
  radarWrap: { alignItems: 'center', justifyContent: 'center', padding: 30 },
  hint: { color: THEME.textMuted, textAlign: 'center', marginTop: 10, fontSize: 14, paddingHorizontal: 40, lineHeight: 22 },
  sectionLabel: { color: THEME.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 12 },
  peerCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: THEME.surface, padding: 16, borderRadius: 18, marginBottom: 12, borderWidth: 1, borderColor: THEME.border },
  peerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(6, 182, 212, 0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: THEME.primary },
  peerLetter: { color: THEME.primary, fontSize: 18, fontWeight: '800' },
  peerName: { color: THEME.textMain, fontWeight: '700', fontSize: 15 },
  peerId: { color: THEME.textMuted, fontSize: 11, marginTop: 2 },
  connectBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: THEME.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  connectText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});


// Concept: Room-Based 1-to-1 Bridge
// Caller creates a room:
// They generate a roomId (could be random or based on user IDs).
// They click Initialize Secure Bridge, registering their socket and room.
// Receiver joins the room:
// Frontend can listen for active rooms or poll backend.
// Backend can store the caller’s info in the room.
// Receiver only needs to select their output language and click Initialize.
// Backend now knows which two sockets are in the same room.
// Audio chunk flow:
// User A speaks → backend STT → translate → TTS → send to User B socket.
// User B speaks → backend STT → translate → TTS → send to User A socket.
// Advantage: Receiver doesn’t need to manually type caller ID — the backend knows which sockets are in the room
// Translation @vitalets/google-translate-api,  STT Google Speech-to-Text free tier, TTS google-tts-api,