import React, { useState, useEffect, useRef } from 'react';
import {
 MessageSquare, Plus,
  Send, MoreVertical, Edit2, Trash2, Reply
} from 'lucide-react-native';
import { useChatSocket } from '@/hooks/useChatSocket';
import { chatApi } from '@/api/chat';
import type { Conversation } from '@/types/chat';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator, Dimensions, Alert, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Globe, User, Key, ChevronLeft, Settings, FileText,
  Headphones, PhoneCall, Users, Check, Zap, Activity, MicOff,
  Volume2, Play, LogOut, Bluetooth, BluetoothSearching, Mic, Cpu, VolumeX, Circle
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { useSpeechRecognition, isWebSpeechSupported } from '@/hooks/useSpeechRecognition';
import { useVADAudioRecorder } from '@/hooks/useVADAudioRecorder';
import { useBluetooth } from '@/hooks/useBluetooth';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { historyApi } from '@/api/history';
import { updatePreferences } from '@/api/user';
import { useRouter } from 'expo-router';
import { translateChatText, type ChatLang } from '@/services/chatTranslation';

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
interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  timestamp: Date;
  isEdited?: boolean;
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
// Web: native HTMLAudioElement; Native: expo-audio player
// onStart: called just before playback begins (use to mute mic)
// onEnd:   called when playback finishes or errors (use to unmute mic)
async function playAudio(
  audioBase64: string,
  onStart?: () => void,
  onEnd?: () => void,
) {
  if (!audioBase64) return;
  console.log('[TTS] playAudio called, bytes:', audioBase64.length);

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    try {
      const audio = new window.Audio('data:audio/mp3;base64,' + audioBase64);
      audio.addEventListener('ended', () => onEnd?.(), { once: true });
      audio.addEventListener('error', () => onEnd?.(), { once: true });
      onStart?.();
      await audio.play();
    } catch (e: any) {
      console.error('[TTS] web audio play error:', e);
      onEnd?.();
    }
  } else {
    try {
      // FIX #6: removed invalid `shouldDuckAndroid` (not a valid AudioMode field
      // in expo-audio; was silently ignored but is cleaner without it)
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        interruptionMode: 'doNotMix',
      });

      const player = createAudioPlayer({
        uri: 'data:audio/mp3;base64,' + audioBase64,
      });

      onStart?.();
      player.play();

      // Detect playback completion via status updates; fall back to a long timeout
      let ended = false;
      const markEnded = () => {
        if (ended) return;
        ended = true;
        onEnd?.();
        try { player.remove?.(); } catch {}
      };

      // expo-audio AudioPlayer emits 'playbackStatusUpdate' with { didJustFinish }
      const sub = player.addListener('playbackStatusUpdate', (status) => {
        if (status?.didJustFinish) {
          sub.remove();
          markEnded();
        }
      });

      // Safety net: release after 60 s regardless
      setTimeout(markEnded, 60_000);
    } catch (e) {
      console.error('[TTS] native audio play error:', e);
      onEnd?.();
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
        <TouchableOpacity onPress={() => setScreen('bt')} style={styles.btButton}><Bluetooth size={26} color={THEME.primary} /></TouchableOpacity>
      </View>
      <View style={styles.headerIcons}>
        <TouchableOpacity style={styles.headerIconBox} onPress={() => router.push('/history')}><FileText size={18} color={THEME.primary} /><Text style={styles.headerIconLabel}>History</Text></TouchableOpacity>
        <TouchableOpacity style={styles.headerIconBox} onPress={() => setScreen('settings')}><Settings size={18} color={THEME.secondary} /><Text style={styles.headerIconLabel}>Settings</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <TouchableOpacity style={styles.featureCard} onPress={() => setScreen('chat-active')}>
  <View style={styles.featureIcon}><MessageSquare size={26} color={THEME.primary} /></View>
  <Text style={styles.featureTitle}>Bridge Messenger</Text>
  <Text style={styles.featureDesc}>Real-time translated chat with Edit and Delete options.</Text>
</TouchableOpacity>
      <View style={styles.gridRow}>
        <TouchableOpacity style={styles.gridCard} onPress={() => setScreen('dc-setup')}><View style={[styles.gridIcon, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}><PhoneCall size={24} color={THEME.success} /></View><Text style={styles.gridTitle}>Direct Call</Text><Text style={styles.gridDesc}>1-on-1 ID Search</Text></TouchableOpacity>
        <TouchableOpacity style={styles.gridCard} onPress={() => setScreen('mt-setup')}><View style={[styles.gridIcon, { backgroundColor: 'rgba(99, 102, 241, 0.1)' }]}><Users size={24} color={THEME.secondary} /></View><Text style={styles.gridTitle}>Meeting Table</Text><Text style={styles.gridDesc}>Group 3-5 Users</Text></TouchableOpacity>
      </View>
    </ScrollView>
  </View>
);
const ChatScreen = ({ user, onBack, socket, THEME, styles }: any) => {
  const [inbox, setInbox] = useState<Conversation[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [selectedChat, setSelectedChat] = useState<Conversation | null>(null);
  const [inputText, setInputText] = useState('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [showInputTranslate, setShowInputTranslate] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newBridgeLoading, setNewBridgeLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedSendLang, setSelectedSendLang] = useState<ChatLang | null>(null);
  const [isTranslatingBeforeSend, setIsTranslatingBeforeSend] = useState(false);
  const [translatingMessageId, setTranslatingMessageId] = useState<string | null>(null);
  const [messageOriginalText, setMessageOriginalText] = useState<Map<string, string>>(new Map());

  const translationCacheRef = useRef<Map<string, string>>(new Map());

  const scrollRef = useRef<any>(null);
  const selectedChatRef = useRef<Conversation | null>(null);
  selectedChatRef.current = selectedChat;

  const {
    messages,
    setMessages,
    onlineUsers,
    isPartnerTyping,
    sendMessage: socketSend,
    deleteMessage,
    editMessage,
    sendTypingSignal,
    joinRoom,
    leaveRoom,
  } = useChatSocket({
    socket,
    currentUserId: user?._id ?? '',
    activePartnerId: selectedChat?.partnerId ?? null,
  });

  // Load inbox conversations on mount
  useEffect(() => {
    if (!user?._id) return;
    chatApi.getConversations(user._id)
      .then((convs) => setInbox(convs))
      .catch(() => {})
      .finally(() => setInboxLoading(false));
  }, [user?._id]);

  // Update inbox last message when a new message arrives
  useEffect(() => {
    if (messages.size === 0) return;
    const all = Array.from(messages.values());
    const latest = all[all.length - 1];
    if (!latest) return;
    const partnerId =
      latest.sender === user?._id ? latest.receiver : latest.sender;
    setInbox((prev) =>
      prev.map((c) =>
        c.partnerId === partnerId
          ? { ...c, lastMessage: latest.message, lastTimestamp: new Date().toISOString() }
          : c,
      ),
    );
  }, [messages.size]);

  const sortedInbox = [...inbox].sort(
    (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime(),
  );

  const updateMessageText = (messageId: string, text: string) => {
    setMessages((prev) => {
      if (!prev.has(messageId)) return prev;
      const updated = new Map(prev);
      updated.set(messageId, { ...updated.get(messageId)!, message: text });
      return updated;
    });
  };

  const translateExistingMessage = async (messageId: string, currentText: string, lang: ChatLang) => {
    const sourceText = (messageOriginalText.get(messageId) ?? currentText).trim();
    if (!sourceText) return;
    const cacheKey = `msg:${sourceText}:${lang}`;
    const cached = translationCacheRef.current.get(cacheKey);
    if (cached) {
      updateMessageText(messageId, cached);
      setActiveMenuId(null);
      return;
    }

    setTranslatingMessageId(messageId);
    try {
      const translated = await translateChatText(socket, sourceText, lang, 'auto');
      if (!translated.success) {
        showAlert('Translation Error', 'Message translation failed. Please try again.');
        return;
      }
      translationCacheRef.current.set(cacheKey, translated.text);
      setMessageOriginalText((prev) => {
        if (prev.has(messageId)) return prev;
        const updated = new Map(prev);
        updated.set(messageId, sourceText);
        return updated;
      });
      updateMessageText(messageId, translated.text);
      setActiveMenuId(null);
    } finally {
      setTranslatingMessageId(null);
    }
  };

  const restoreOriginalMessage = (messageId: string) => {
    const original = messageOriginalText.get(messageId);
    if (!original) return;
    updateMessageText(messageId, original);
    setActiveMenuId(null);
  };

  const chooseSendLanguage = (lang: ChatLang) => {
    setSelectedSendLang(lang);
    setShowInputTranslate(false);
  };

  const openChat = async (chat: Conversation) => {
    // Mark unread as cleared locally
    setInbox((prev) =>
      prev.map((item) =>
        item.partnerId === chat.partnerId ? { ...item, unreadCount: 0 } : item,
      ),
    );
    setSelectedChat(chat);
    // Fetch history and seed messages Map
    try {
      const history = await chatApi.getMessages(user._id, chat.partnerId);
      const map = new Map(history.map((m) => [m.customId, m]));
      setMessages(map);
    } catch {
      setMessages(new Map());
    }
    // Realtime events backend `message/delete/edit/userMsg` ke liye `receiver` ko room name ki tarah emit karta hai,
    // jahan `receiver` Mongo `_id` hota hai. Isliye har client ko apne current `_id` room me join hona chahiye.
    if (user?._id) joinRoom(user._id);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 150);
  };

  const closeChat = () => {
    if (user?._id) leaveRoom(user._id);
    setSelectedChat(null);
    setMessages(new Map());
    setEditingId(null);
    setInputText('');
  };

  const startNewBridge = async () => {
    const trimmed = newUserId.trim();
    if (!trimmed) return;
    setNewBridgeLoading(true);
    try {
      const found = await chatApi.searchUser(trimmed);
      if (!found) {
        showAlert('Not Found', `No user with ID "${trimmed}" exists.`);
        return;
      }
      // Check if conversation already in inbox
      const existing = inbox.find((c) => c.partnerId === found._id);
      if (existing) {
        setShowNewChatModal(false);
        setNewUserId('');
        openChat(existing);
        return;
      }
      const newEntry: Conversation = {
        partnerId: found._id,
        partnerName: found.userId,
        lastMessage: '',
        lastTimestamp: new Date().toISOString(),
        unreadCount: 0,
        online: onlineUsers.includes(found.userId),
      };
      setInbox((prev) => [newEntry, ...prev]);
      setShowNewChatModal(false);
      setNewUserId('');
      openChat(newEntry);
    } catch {
      showAlert('Not Found', `No user with ID "${trimmed}" exists.`);
    } finally {
      setNewBridgeLoading(false);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() || !selectedChat) return;
    if (editingId) {
      editMessage(editingId, selectedChat.partnerId, inputText);
      setEditingId(null);
    } else {
      let finalOutgoingText = inputText.trim();
      if (selectedSendLang) {
        const cacheKey = `send:${finalOutgoingText}:${selectedSendLang}`;
        const cached = translationCacheRef.current.get(cacheKey);
        if (cached) {
          finalOutgoingText = cached;
        } else {
          setIsTranslatingBeforeSend(true);
          try {
            const translated = await translateChatText(socket, finalOutgoingText, selectedSendLang, 'auto');
            if (translated.success) {
              finalOutgoingText = translated.text;
              translationCacheRef.current.set(cacheKey, translated.text);
            } else {
              showAlert('Translation Error', 'Sending original message because translation failed.');
            }
          } finally {
            setIsTranslatingBeforeSend(false);
          }
        }
      }

      socketSend(finalOutgoingText, selectedChat.partnerId, user?.userId ?? '');
      setInbox((prev) =>
        prev.map((item) =>
          item.partnerId === selectedChat.partnerId
            ? { ...item, lastMessage: finalOutgoingText, lastTimestamp: new Date().toISOString() }
            : item,
        ),
      );
    }
    setInputText('');
    setShowInputTranslate(false);
    setSelectedSendLang(null);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const sortedMessages = Array.from(messages.values()).sort(
    (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
  );

  // Always keep latest messages visible at the bottom while chat is open.
  useEffect(() => {
    if (!selectedChat) return;
    // RN ScrollView ko content change hone par end tak scroll karna zaroori hota hai.
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [sortedMessages.length, selectedChat?.partnerId]);

  // --- RENDERING LOGIC ---
  return (
    <SafeAreaView style={styles.darkPage}>
      <StatusBar barStyle="light-content" />

      {/* 1. INBOX LIST VIEW */}
      {!selectedChat ? (
        <View style={{ flex: 1 }}>
          <View style={[styles.navHeader, { borderBottomWidth: 1, borderBottomColor: THEME.border, paddingBottom: 15 }]}>
            <TouchableOpacity style={styles.backBtn} onPress={onBack}><ChevronLeft size={24} color="#fff" /></TouchableOpacity>
            <Text style={styles.navTitle}>Bridge Messenger</Text>
            <TouchableOpacity
              style={[styles.backBtn, { backgroundColor: THEME.primary, borderColor: THEME.primary }]}
              onPress={() => setShowNewChatModal(true)}
            >
              <Plus size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ paddingHorizontal: 16 }}>
            <Text style={{ marginTop: 15, marginBottom: 10, color: THEME.textMuted, fontSize: 11, fontWeight: '800' }}>ACTIVE BRIDGES</Text>
            {inboxLoading ? (
              <ActivityIndicator color={THEME.primary} style={{ marginTop: 30 }} />
            ) : sortedInbox.length === 0 ? (
              <Text style={{ color: THEME.textMuted, textAlign: 'center', marginTop: 40 }}>No conversations yet. Tap + to start a bridge.</Text>
            ) : (
              sortedInbox.map((chat) => {
                const hasUnread = chat.unreadCount > 0;
                // Backend online ids `register` ke `userId` format me hotay hain (custom login id),
                // jabke `partnerId` Mongo `_id` hota hai. Isliye online check `partnerName` par karein.
                const isOnline = onlineUsers.includes(chat.partnerName);
                return (
                  <TouchableOpacity key={chat.partnerId} style={[styles.chatItem, hasUnread && { backgroundColor: 'rgba(6, 182, 212, 0.1)', borderColor: THEME.primary, borderWidth: 1.5 }]} onPress={() => openChat(chat)}>
                    <View>
                      <View style={styles.avatarCircle}><Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>{chat.partnerName[0]?.toUpperCase()}</Text></View>
                      {isOnline ? <View style={styles.onlineDot} /> : <View style={styles.offlineDot} />}
                    </View>
                    <View style={{ flex: 1, marginLeft: 15 }}>
                      <Text style={{ fontWeight: '700', color: hasUnread ? THEME.primary : '#fff', fontSize: 16 }}>{chat.partnerName}</Text>
                      <Text style={{ color: hasUnread ? '#fff' : THEME.textMuted, fontSize: 13 }} numberOfLines={1}>{chat.lastMessage}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: THEME.textMuted, fontSize: 10 }}>
                        {chat.lastTimestamp ? new Date(chat.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </Text>
                      {hasUnread && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: THEME.primary, marginTop: 8 }} />}
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : (
        /* 2. CHAT DETAIL VIEW */
        <View style={{ flex: 1 }}>
          <View style={[styles.navHeader, { borderBottomWidth: 1, borderBottomColor: THEME.border, paddingBottom: 15 }]}>
            <TouchableOpacity style={styles.backBtn} onPress={closeChat}><ChevronLeft size={24} color="#fff" /></TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.navTitle}>{selectedChat.partnerName}</Text>
              {isPartnerTyping
                ? <Text style={{ color: THEME.primary, fontSize: 10, fontWeight: '700' }}>● typing...</Text>
                : onlineUsers.includes(selectedChat.partnerName)
                  ? <Text style={{ color: THEME.success, fontSize: 10, fontWeight: '700' }}>● ONLINE</Text>
                  : <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: '700' }}>● OFFLINE</Text>
              }
            </View>
            <TouchableOpacity style={styles.backBtn}><MoreVertical size={20} color="#fff" /></TouchableOpacity>
          </View>

          <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 20 }}>
            {sortedMessages.map((m) => {
              const isMe = m.sender === user?._id;
              const isMenuOpen = activeMenuId === m.customId;
              return (
                <View key={m.customId} style={{ marginBottom: 15, width: '100%', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                  <TouchableOpacity activeOpacity={0.8} onPress={() => setActiveMenuId(isMenuOpen ? null : m.customId)} style={[styles.chatBubble, isMe ? styles.bubbleMe : styles.bubbleThem, isMenuOpen && { borderColor: THEME.primary, borderWidth: 1 }]}>
                    <Text style={{ color: '#fff', fontSize: 16 }}>{m.message}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                      <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>
                        {m.isEdited && 'Edited • '}
                        {m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </Text>
                      {isMe && (
                        <View style={{ flexDirection: 'row', gap: 10, marginLeft: 10 }}>
                          <TouchableOpacity onPress={() => { setInputText(m.message); setEditingId(m.customId); setActiveMenuId(null); }}>
                            <Text style={{ color: '#fff', fontSize: 10, opacity: 0.6 }}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => deleteMessage(m.customId, selectedChat.partnerId)}>
                            <Text style={{ color: THEME.danger, fontSize: 10, fontWeight: '700' }}>Del</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                  {isMenuOpen && (
                    <View style={{ backgroundColor: '#1E293B', borderRadius: 12, padding: 10, marginTop: 5, width: 220, borderWidth: 1, borderColor: THEME.primary, zIndex: 50 }}>
                      <Text style={{ color: '#94A3B8', fontSize: 10, marginBottom: 8, fontWeight: '700' }}>READ INTO:</Text>
                      {translatingMessageId === m.customId && (
                        <ActivityIndicator color={THEME.primary} style={{ marginBottom: 8 }} />
                      )}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 5 }}>
                        {['UR', 'EN', 'AR'].map((l) => (
                          <TouchableOpacity
                            key={l}
                            onPress={() => translateExistingMessage(m.customId, m.message, l as ChatLang)}
                            disabled={translatingMessageId === m.customId}
                            style={{ flex: 1, backgroundColor: '#0F172A', padding: 8, borderRadius: 8, alignItems: 'center', opacity: translatingMessageId === m.customId ? 0.6 : 1 }}
                          >
                            <Text style={{ color: '#fff', fontSize: 11 }}>{l}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {messageOriginalText.has(m.customId) && (
                        <TouchableOpacity onPress={() => restoreOriginalMessage(m.customId)} style={{ marginTop: 8, alignSelf: 'center' }}>
                          <Text style={{ color: THEME.primary, fontSize: 11, fontWeight: '700' }}>Show Original</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          {showInputTranslate && (
            <View style={{ position: 'absolute', bottom: 85, left: 20, backgroundColor: THEME.surface, padding: 12, borderRadius: 15, flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: THEME.primary, zIndex: 1000 }}>
              {['UR', 'EN', 'AR'].map((l) => (
                <TouchableOpacity
                  key={l}
                  onPress={() => chooseSendLanguage(l as ChatLang)}
                  style={{
                    padding: 10,
                    backgroundColor: selectedSendLang === l ? THEME.primary : THEME.background,
                    borderRadius: 10,
                    minWidth: 45,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{l}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: THEME.background, gap: 10 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: THEME.surface, borderRadius: 25, paddingHorizontal: 15, borderWidth: 1, borderColor: editingId ? THEME.success : THEME.border }}>
              <TextInput
                placeholder={editingId ? 'Edit message...' : 'Type here...'}
                placeholderTextColor={THEME.textMuted}
                style={{ flex: 1, color: '#fff', paddingVertical: 10 }}
                value={inputText}
                onChangeText={(v) => {
                  setInputText(v);
                  if (selectedChat) sendTypingSignal(selectedChat.partnerId);
                }}
              />
              {inputText.length > 0 && !editingId && (
                <TouchableOpacity onPress={() => setShowInputTranslate(!showInputTranslate)} style={{ padding: 5 }}>
                  <Globe size={22} color={THEME.primary} />
                </TouchableOpacity>
              )}
            </View>
            {!!selectedSendLang && (
              <Text style={{ color: THEME.primary, fontSize: 10, fontWeight: '700' }}>
                {selectedSendLang}
              </Text>
            )}
            <TouchableOpacity onPress={handleSend} disabled={isTranslatingBeforeSend}>
              <LinearGradient colors={[THEME.primary, THEME.secondary]} style={{ width: 45, height: 45, borderRadius: 22.5, justifyContent: 'center', alignItems: 'center' }}>
                {isTranslatingBeforeSend ? <ActivityIndicator color="#fff" /> : <Send size={20} color="#fff" />}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 3. NEW CHAT MODAL */}
      {showNewChatModal && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', zIndex: 5000, padding: 25 }}>
          <View style={{ width: '100%', backgroundColor: THEME.surface, borderRadius: 25, padding: 25, borderWidth: 1, borderColor: THEME.border }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 20 }}>Connect New Bridge</Text>
            <TextInput
              placeholder="Enter User ID (e.g. Zain_01)"
              placeholderTextColor={THEME.textMuted}
              style={{ backgroundColor: THEME.background, padding: 15, borderRadius: 15, color: '#fff', marginBottom: 20, borderWidth: 1, borderColor: THEME.border }}
              value={newUserId}
              onChangeText={setNewUserId}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, padding: 15, alignItems: 'center' }} onPress={() => { setShowNewChatModal(false); setNewUserId(''); }}>
                <Text style={{ color: THEME.textMuted, fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 2 }} onPress={startNewBridge} disabled={newBridgeLoading}>
                <LinearGradient colors={[THEME.primary, THEME.secondary]} style={{ padding: 15, borderRadius: 15, alignItems: 'center' }}>
                  {newBridgeLoading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={{ color: '#fff', fontWeight: 'bold' }}>Start Chat</Text>
                  }
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};
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
  const [cloningEnabled, setCloningEnabled] = useState(
    !!user?.voiceCloningEnabled,
  );
  // 'idle' | 'buffering' | 'cloning' | 'ready' | 'failed'
  const [cloneStatus, setCloneStatus] = useState<'idle' | 'buffering' | 'cloning' | 'ready' | 'failed'>('idle');
  const [participantIds, setParticipantIds] = useState('');
  const [activeConfig, setActiveConfig] = useState<any>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [callState, setCallState] = useState<'idle' | 'calling' | 'in-call'>('idle');

  const [discoverableUsers, setDiscoverableUsers] = useState<{ userId: string; name: string }[]>([]);

  const { socket } = useSocket(user?.userId ?? null, user?._id ?? null);
  const { startListening, stopListening } = useSpeechRecognition();
  const { startRecording, stopRecording, setTtsPlaying, warmUpAudio } = useVADAudioRecorder();
  const { devices: btDevices, isScanning: btScanning, scanError: btScanError, startScan: btStartScan, stopScan: btStopScan, isBleSupported } = useBluetooth();

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
  // Sirf tab timer chalayein jab asli CALL ho rahi ho
  if (screen === 'active') { 
    interval = setInterval(() => {
      setRecordingSeconds(prev => prev + 1);
    }, 1000);
  } else {
    // Agar chat-active ho ya home ho, to sab reset kar dein
    setRecordingSeconds(0);
    setLiveTranscript({});
    setIsMuted(false);
    setIsSpeaker(true);
    setCloneStatus('idle');
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

      // incomingCall being set means we are the callee; use popup-selected langs.
      // Otherwise we are the caller; use the setup-screen langs.
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
      setCloneStatus('idle');
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

    // ── Voice Cloning status events ───────────────────────────────────────────
    const onCloneStarted = () => setCloneStatus('buffering');
    const onCloneReady   = () => setCloneStatus('ready');
    const onCloneFailed  = () => setCloneStatus('failed');

    socket.on('clone-started', onCloneStarted);
    socket.on('clone-ready',   onCloneReady);
    socket.on('clone-failed',  onCloneFailed);

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
        setCloneStatus('idle');
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
      socket.off('clone-started', onCloneStarted);
      socket.off('clone-ready',   onCloneReady);
      socket.off('clone-failed',  onCloneFailed);
    };
  }, [socket, user, speakLang, hearLang, incomingCall, callInviteSpeakLang, callInviteHearLang, stopRecording, stopListening]);

  // ── Discoverable mode: emit start/stop based on screen ───────────────────
  useEffect(() => {
    if (!socket || !user) return;
    if (screen === 'bt') {
      socket.emit('start-discoverable', { userId: user.userId, name: user.name || user.userId });
    } else {
      socket.emit('stop-discoverable', { userId: user.userId });
      setDiscoverableUsers([]);
      btStopScan();
    }
  }, [screen, socket, user, btStopScan]);

  // ── translated-text — always reads latest isSpeaker/hearLang via refs ────
  useEffect(() => {
    if (!socket) return;

    // Early gate: backend emits tts-start right before sending translated-text with audio.
    // Pause the mic immediately so the VAD loop doesn't capture the incoming TTS.
    const onTtsStart = () => {
      setTtsPlaying(true);
    };
    socket.on('tts-start', onTtsStart);

    const onTranslatedText = ({ text, audioBase64, captionOnly }: { text: string; audioBase64?: string; captionOnly?: boolean }) => {
      console.log('[pipeline] translated-text received:', text, 'captionOnly:', captionOnly, 'isSpeaker:', isSpeakerRef.current);
      if (isSpeakerRef.current && !captionOnly) {
        // captionOnly=true means cloning is ON and the real voice is already
        // playing via audio-passthrough. Do NOT play TTS or browser speech here.
        if (audioBase64) {
          playAudio(
            audioBase64,
            () => setTtsPlaying(true),
            () => { setTtsPlaying(false); socket.emit('tts-end'); },
          );
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
          playAudio(
            audioBase64,
            () => setTtsPlaying(true),
            () => { setTtsPlaying(false); socket.emit('tts-end'); },
          );
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

    // ── Audio passthrough: play the sender's original voice directly ──────────
    // setTtsPlaying(true) mutes the VAD mic while the peer's audio plays through
    // the device speaker. Without this gate the receiver's own microphone picks
    // up the speaker output and re-transmits it as their own audio-chunk,
    // creating an echo / feedback loop.
    const onAudioPassthrough = ({ audioBase64 }: { audioBase64: string }) => {
      if (isSpeakerRef.current && audioBase64) {
        playAudio(
          audioBase64,
          () => setTtsPlaying(true),   // mute receiver's mic while peer voice plays
          () => setTtsPlaying(false),  // restore mic after playback ends
        );
      }
    };
    socket.on('audio-passthrough', onAudioPassthrough);

    return () => {
      socket.off('tts-start', onTtsStart);
      socket.off('translated-text', onTranslatedText);
      socket.off('speech-transcript', onSpeechTranscript);
      socket.off('meeting-translated', onMeetingTranslated);
      socket.off('meeting-speech-transcript', onMeetingSpeechTranscript);
      socket.off('audio-passthrough', onAudioPassthrough);
    };
  }, [socket, setTtsPlaying]); // setTtsPlaying is stable (useCallback); refs keep other values fresh

  // ── Hybrid Audio Capture ────────────────────────────────────────────────────
  // For languages supported by Web Speech API (EN, AR): use browser STT
  // For unsupported languages (UR): use audio recorder → Google Cloud STT
  useEffect(() => {
   const isActive = screen === 'active';
    if (!isActive || isMuted) {
      stopListening();
      stopRecording();
      setSttMode(null);
      return;
    }

    const locale = LOCALE_MAP[speakLang];
    console.log(`[pipeline] STT starting for ${speakLang} (${locale}) using recorder-only pipeline`);

    // ── All platforms: use recorder + backend STT ───────────────────────────
    startAudioRecorderMode();

    function startAudioRecorderMode() {
      setSttMode('audio-recorder');
      console.log('[pipeline] Using audio recorder for', locale);
      setLiveTranscript(prev => ({ ...prev, 0: '🎙️ Recording...' }));
      
      startRecording(
        (audioBase64: string, mimeType: string) => {
          const roomId = roomIdRef.current;
          const meetingId = meetingIdRef.current;
          console.log(
            `[pipeline] Audio chunk ready — bytes:${audioBase64.length} mime:${mimeType}` +
            ` roomId:${roomId} meetingMode:${isMeetingModeRef.current}`,
          );
          if (isMeetingModeRef.current) {
            socket?.emit('meeting-audio-chunk', {
              meetingId,
              audioBase64,
              mimeType,
            });
          } else {
            if (!roomId) {
              console.warn('[pipeline] Dropping audio chunk — roomId is null (call not yet established)');
              return;
            }
            socket?.emit('audio-chunk', {
              roomId,
              audioBase64,
              mimeType,
            });
          }
        },
        () =>
          showAlert(
            'Microphone Blocked',
            Platform.OS === 'web'
              ? 'Allow microphone access:\n1. Click the lock icon\n2. Set Microphone → Allow\n3. Refresh the page'
              : 'Microphone access is blocked. Please:\n1. Open system app settings\n2. Find Voice Bridge\n3. Enable microphone permission\n4. Restart the app',
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

 // 1. Messenger Screen (Strict Match)
if (screen === 'chat-active') {
  return <ChatScreen user={user} onBack={() => setScreen('home')} socket={socket} THEME={THEME} styles={styles} />;
}

// 2. Voice Call Screen (Sirf tab jab screen 'active' ho)
if (screen === 'active') { 
  return (
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
          {cloningEnabled && (
            <Text style={[
              styles.cloningStatusLabel,
              cloneStatus === 'buffering' && { color: THEME.primary },
              cloneStatus === 'cloning'   && { color: '#F59E0B' },
              cloneStatus === 'ready'     && { color: THEME.success },
              cloneStatus === 'failed'    && { color: THEME.danger },
            ]}>
              {cloneStatus === 'buffering' ? '● SAMPLING VOICE…'
                : cloneStatus === 'cloning' ? '⟳ CLONING VOICE…'
                : cloneStatus === 'ready'   ? '✓ AI CLONE ACTIVE'
                : cloneStatus === 'failed'  ? '⚠ CLONE FAILED — DEFAULT TTS'
                : 'AI CLONE ACTIVE'}
            </Text>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.participantsGrid}>
        {activeConfig?.map((p: any, i: number) => (
          <View key={i} style={[styles.participantTile, i === 0 && styles.tileActive]}>
            <View style={styles.tileTopRow}>
               <View style={[
                styles.avatarBox,
                i === 0 && cloningEnabled && cloneStatus === 'ready'     && { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
                i === 0 && cloningEnabled && cloneStatus === 'buffering' && { backgroundColor: 'rgba(6, 182, 212, 0.2)' },
                i === 0 && cloningEnabled && cloneStatus === 'cloning'   && { backgroundColor: 'rgba(245, 158, 11, 0.2)' },
                i === 0 && cloningEnabled && cloneStatus === 'failed'    && { backgroundColor: 'rgba(244, 63, 94, 0.2)' },
              ]}>
                {i === 0 && cloningEnabled && cloneStatus === 'ready'
                  ? <Mic size={24} color={THEME.success} />
                  : <Text style={styles.avatarLetter}>{p.userId?.charAt(0) || 'U'}</Text>}
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
}

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
                  warmUpAudio(); // pre-create AudioContext in user-gesture frame
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
{screen === 'chat-active' && (
  <ChatScreen
    user={user}
    onBack={() => setScreen('home')}
    socket={socket}
    THEME={THEME}
    styles={styles}
  />
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
                  <View style={styles.cloningIconBox}>
                    <Cpu size={24} color={THEME.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cloningTitle}>Neural Voice Cloning</Text>
                    <Text style={styles.cloningDesc}>
                      Use your natural voice for translations (ElevenLabs).
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={async () => {
                      const next = !cloningEnabled;
                      setCloningEnabled(next);
                      if (!user?.userId) return;
                      try {
                        await updatePreferences({
                          userId: user.userId,
                          voiceCloningEnabled: next,
                        });
                      } catch (err: any) {
                        console.error(
                          '[Preferences] Failed to update voice cloning flag:',
                          err.message || err,
                        );
                      }
                    }}
                    style={[
                      styles.toggleTrack,
                      cloningEnabled && styles.toggleTrackActive,
                    ]}
                  >
                    <View
                      style={[
                        styles.toggleThumb,
                        cloningEnabled && styles.toggleThumbActive,
                      ]}
                    />
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
                      if (targetId === user?.userId) {
                        showAlert('Error', 'You cannot call yourself.');
                        return;
                      }
                      warmUpAudio(); // pre-create AudioContext in user-gesture frame
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
                      warmUpAudio(); // pre-create AudioContext in user-gesture frame
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
                    warmUpAudio(); // pre-create AudioContext in user-gesture frame
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
          <Header title="Bluetooth" />

          <View style={btStyles.radarWrap}>
            {btScanning ? (
              <BluetoothSearching size={36} color={THEME.primary} />
            ) : (
              <Bluetooth size={36} color={THEME.primary} />
            )}
          </View>

          {/* Language selectors for BT calls */}
          <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            <Text style={styles.labelDark}>I WILL SPEAK</Text>
            <View style={styles.langRow}>
              {LANGUAGES.map(l => (
                <TouchableOpacity
                  key={'bts' + l.code}
                  onPress={() => setSpeakLang(l.code)}
                  style={[styles.langSelect, speakLang === l.code && styles.langSelectActive]}
                >
                  <Text style={styles.flag}>{l.flag}</Text>
                  <Text style={[styles.langName, speakLang === l.code && styles.langNameActive]}>{l.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.labelDark, { marginTop: 10 }]}>I WANT TO HEAR</Text>
            <View style={styles.langRow}>
              {LANGUAGES.map(l => (
                <TouchableOpacity
                  key={'bth' + l.code}
                  onPress={() => setHearLang(l.code)}
                  style={[styles.langSelect, hearLang === l.code && styles.langSelectActive]}
                >
                  <Text style={styles.flag}>{l.flag}</Text>
                  <Text style={[styles.langName, hearLang === l.code && styles.langNameActive]}>{l.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {(() => {
            const hasBleDevices = btDevices.length > 0;
            const hasOnlineUsers = discoverableUsers.length > 0;
            const hasAnyDevices = hasBleDevices || hasOnlineUsers;

            if (!hasAnyDevices) {
              return (
                <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
                  <Text style={btStyles.hint}>
                    {Platform.OS === 'web'
                      ? 'No Bluetooth scan results. On web, pair your headset or phone in Windows Bluetooth settings and select it as the audio output. Voice Bridge will automatically use the system output device.'
                      : 'No devices found. Turn on Bluetooth and tap below to scan.'}
                  </Text>
                  {btScanError && <Text style={btStyles.scanError}>{btScanError}</Text>}
                  {isBleSupported && Platform.OS !== 'web' && (
                    <TouchableOpacity
                      style={[btStyles.pairNowBtn, btScanning && btStyles.pairNowBtnDisabled]}
                      onPress={btScanning ? undefined : btStartScan}
                      disabled={btScanning}
                    >
                      {btScanning ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={btStyles.pairNowText}>Pair now</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  {!isBleSupported && Platform.OS !== 'web' && (
                    <Text style={btStyles.hint}>
                      Use a development build (not Expo Go) to scan for devices.
                    </Text>
                  )}
                </ScrollView>
              );
            }

            return (
              <ScrollView style={{ paddingHorizontal: 20, flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
                {btScanError && <Text style={btStyles.scanError}>{btScanError}</Text>}

                {hasBleDevices && (
                  <View style={{ marginBottom: 16 }}>
                    <Text style={btStyles.sectionLabel}>BLUETOOTH DEVICES</Text>
                    {btDevices.map((device) => (
                      <View key={device.id} style={btStyles.peerCard}>
                        <View style={btStyles.peerAvatar}><Bluetooth size={20} color={THEME.primary} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={btStyles.peerName}>{device.name || 'Unknown device'}</Text>
                          <Text style={btStyles.peerId}>{device.id}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {!hasBleDevices && isBleSupported && (
                  <TouchableOpacity
                    style={[btStyles.pairNowBtn, btScanning && btStyles.pairNowBtnDisabled]}
                    onPress={btScanning ? undefined : btStartScan}
                    disabled={btScanning}
                  >
                    {btScanning ? <ActivityIndicator size="small" color="#fff" /> : <Text style={btStyles.pairNowText}>Pair now</Text>}
                  </TouchableOpacity>
                )}

                {hasOnlineUsers && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={btStyles.sectionLabel}>ONLINE USERS</Text>
                    {discoverableUsers.map((peer) => (
                      <TouchableOpacity
                        key={peer.userId}
                        style={btStyles.peerCard}
                        onPress={() => {
                          setCallState('calling');
                          socket?.emit('call-user', { targetUserId: peer.userId, callerName: user?.userId, speakLang, hearLang });
                          setScreen('home');
                        }}
                      >
                        <View style={btStyles.peerAvatar}><Text style={btStyles.peerLetter}>{peer.userId.charAt(0).toUpperCase()}</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={btStyles.peerName}>{peer.name || peer.userId}</Text>
                          <Text style={btStyles.peerId}>ID: {peer.userId}</Text>
                        </View>
                        <View style={btStyles.connectBtn}><Bluetooth size={14} color="#fff" /><Text style={btStyles.connectText}>Connect</Text></View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </ScrollView>
            );
          })()}
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
  pulseContainer: { marginBottom: 20, padding: 10, borderRadius: 100, backgroundColor: 'rgba(6, 182, 212, 0.1)' },
  chatBubbleWrap: { marginBottom: 15, width: '100%' },
  chatBubble: { maxWidth: '80%', padding: 12, borderRadius: 20 },
  bubbleMe: { backgroundColor: THEME.primary, borderBottomLeftRadius: 4 },
  bubbleThem: { backgroundColor: THEME.surface, borderBottomRightRadius: 4, borderWidth: 1, borderColor: THEME.border },
  bubbleText: { color: '#fff', fontSize: 15 },
  bubbleFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  bubbleTime: { color: 'rgba(255,255,255,0.5)', fontSize: 9 },
  bubbleActions: { flexDirection: 'row', gap: 10 },
  inputArea: { flexDirection: 'row', padding: 15, backgroundColor: THEME.surface, alignItems: 'center', gap: 10 },
  chatInput: { flex: 1, backgroundColor: THEME.background, borderRadius: 20, paddingHorizontal: 15, paddingVertical: 10, color: THEME.textMain },
  sendBtnInner: { width: 45, height: 45, borderRadius: 23, justifyContent: 'center', alignItems: 'center' },
  // Text Styles inside Inbox
 chatItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 14, 
    backgroundColor: THEME.surface, 
    borderRadius: 18, 
    marginBottom: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    // Shadow for professional look
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    elevation: 2,
  },

  // Circle Avatar
  avatarCircle: { 
    width: 55, 
    height: 55, 
    borderRadius: 27.5, 
    backgroundColor: THEME.secondary, 
    justifyContent: 'center', 
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'
  },

  // Name Style
  inboxName: { 
    color: THEME.textMain, 
    fontWeight: '700', 
    fontSize: 16,
    letterSpacing: 0.2
  },
  
  // Message Preview
  inboxMsg: { 
    color: THEME.textMuted, 
    fontSize: 13, 
    marginTop: 2,
    lineHeight: 18
  },
  
  // Time Style
  inboxTime: { 
    color: THEME.textMuted, 
    fontSize: 11, 
    fontWeight: '600',
    marginTop: -20 // Isse time thoda upar adjust ho jayega
  },
  inputWrapper: {
  flexDirection: 'row',
  alignItems: 'center', // Vertical center align
  padding: 12,
  backgroundColor: '#0F1219',
  gap: 10,
},
innerInputContainer: {
  flex: 1,
  flexDirection: 'row',
  alignItems: 'center', // Isse Mic aur Text aik line mein ayenge
  backgroundColor: '#1A1F2B',
  borderRadius: 25,
  paddingHorizontal: 15,
  borderWidth: 1,
  borderColor: '#2D3548',
},
modernInput: {
  flex: 1,
  color: '#F8FAFC',
  fontSize: 16,
  paddingVertical: 10,
  maxHeight: 100,
},
onlineDot: {
  position: 'absolute',
  bottom: 0,
  right: 0,
  width: 14,
  height: 14,
  borderRadius: 7,
  backgroundColor: '#10B981',
  borderWidth: 2,
  borderColor: '#0F1219',
},
  offlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#64748B',
    borderWidth: 2,
    borderColor: '#0F1219',
  },
unreadBadge: {
  width: 10,
  height: 10,
  borderRadius: 5,
  marginTop: 10,
},
translationMenu: {
    position: 'absolute',
    top: -80,
    left: 0,
    right: 0,
    backgroundColor: '#1E293B',
    padding: 10,
    borderRadius: 15,
    zIndex: 100,
    minWidth: 180,
    borderWidth: 1,
    borderColor: THEME.primary,
  },
  menuTitle: { color: '#94A3B8', fontSize: 10, marginBottom: 5, textAlign: 'center' },
  menuRow: { flexDirection: 'row', justifyContent: 'space-around' },
  menuBtn: { padding: 5, backgroundColor: '#0F172A', borderRadius: 8, width: 55, alignItems: 'center' },
  menuBtnText: { color: '#fff', fontSize: 10 },
  
  inputMenu: {
    position: 'absolute',
    bottom: 70,
    left: 20,
    backgroundColor: THEME.surface,
    padding: 10,
    borderRadius: 15,
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: THEME.primary,
  },
  inputMenuBtn: { padding: 8, backgroundColor: THEME.background, borderRadius: 10 },
});


const btStyles = StyleSheet.create({
  statusBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginTop: 12, padding: 14, backgroundColor: THEME.surface, borderRadius: 16, borderWidth: 1, borderColor: THEME.border },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: THEME.success },
  dotOff: { backgroundColor: THEME.danger },
  statusText: { color: THEME.textMain, fontSize: 13, fontWeight: '600', flex: 1 },
  radarWrap: { alignItems: 'center', justifyContent: 'center', padding: 30 },
  hint: { color: THEME.textMuted, textAlign: 'center', marginTop: 10, fontSize: 14, paddingHorizontal: 40, lineHeight: 22 },
  hintSmall: { color: THEME.textMuted, fontSize: 12, marginBottom: 12, lineHeight: 18 },
  sectionLabel: { color: THEME.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 12 },
  pairNowBtn: { alignSelf: 'center', backgroundColor: THEME.primary, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 16, minWidth: 140, alignItems: 'center' },
  pairNowBtnDisabled: { opacity: 0.7 },
  pairNowText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  scanError: { color: THEME.danger, textAlign: 'center', marginTop: 8, fontSize: 12, paddingHorizontal: 20 },
  peerCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: THEME.surface, padding: 16, borderRadius: 18, marginBottom: 12, borderWidth: 1, borderColor: THEME.border },
  peerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(6, 182, 212, 0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: THEME.primary },
  peerLetter: { color: THEME.primary, fontSize: 18, fontWeight: '800' },
  peerName: { color: THEME.textMain, fontWeight: '700', fontSize: 15 },
  peerId: { color: THEME.textMuted, fontSize: 11, marginTop: 2 },
  connectBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: THEME.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  connectText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  pairedBadge: { backgroundColor: THEME.success, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  pairedBadgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
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