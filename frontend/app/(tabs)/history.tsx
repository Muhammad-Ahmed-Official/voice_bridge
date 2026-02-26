import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Phone, Users, Bluetooth, Trash2, Clock, Play, Square } from 'lucide-react-native';
import { Audio } from 'expo-av';
import { useAuth } from '@/contexts/AuthContext';
import { historyApi, HistoryItem } from '@/api/history';

const THEME = {
  bg: '#0a0a0f',
  card: '#15151f',
  accent: '#00d4ff',
  success: '#22c55e',
  danger: '#ef4444',
  warning: '#f59e0b',
  text: '#ffffff',
  textMuted: '#9ca3af',
};

const LANG_LABELS: Record<string, string> = {
  UR: 'Urdu',
  EN: 'English',
  AR: 'Arabic',
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function getCallIcon(callType: string) {
  switch (callType) {
    case 'One to One Call':
      return <Phone size={20} color={THEME.accent} />;
    case 'Group Meeting':
      return <Users size={20} color={THEME.success} />;
    case 'Bluetooth':
      return <Bluetooth size={20} color={THEME.warning} />;
    default:
      return <Phone size={20} color={THEME.accent} />;
  }
}

export default function HistoryScreen() {
  const { user } = useAuth();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const playRecording = useCallback(async (item: HistoryItem) => {
    if (!item.callRecordingUrl) return;

    try {
      if (playingId === item._id) {
        await soundRef.current?.stopAsync();
        await soundRef.current?.unloadAsync();
        soundRef.current = null;
        setPlayingId(null);
        return;
      }

      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: item.callRecordingUrl },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      setPlayingId(item._id);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingId(null);
          sound.unloadAsync();
          soundRef.current = null;
        }
      });
    } catch (error: any) {
      console.error('[History] Play error:', error.message);
      setPlayingId(null);
    }
  }, [playingId]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

  const fetchHistory = useCallback(async () => {
    const userId = user?._id;
    console.log('[History] Fetching for user:', userId);
    
    if (!userId) {
      console.log('[History] No user._id available, user may need to re-login');
      setLoading(false);
      return;
    }
    
    try {
      const data = await historyApi.getByUser(userId);
      console.log('[History] Fetched:', data.length, 'items');
      setHistory(data);
    } catch (error: any) {
      console.error('[History] Fetch error:', error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?._id]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchHistory();
  }, [fetchHistory]);

  const handleDelete = useCallback((item: HistoryItem) => {
    const doDelete = async () => {
      try {
        await historyApi.delete(item._id);
        setHistory(prev => prev.filter(h => h._id !== item._id));
      } catch (error: any) {
        console.error('[History] Delete error:', error.message);
      }
    };

    if (Platform.OS === 'web') {
      if (confirm('Delete this call from history?')) {
        doDelete();
      }
    } else {
      Alert.alert(
        'Delete Call',
        'Are you sure you want to delete this call from history?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  }, []);

  const renderItem = useCallback(({ item }: { item: HistoryItem }) => {
    const otherParticipants = item.participants.filter(
      p => p.user?._id !== user?._id
    );
    const participantNames = otherParticipants
      .map(p => p.user?.name || p.user?.userId || 'Unknown')
      .join(', ');

    const myParticipant = item.participants.find(p => p.user?._id === user?._id);
    const langInfo = myParticipant
      ? `${LANG_LABELS[myParticipant.languageSpoken] || myParticipant.languageSpoken} → ${LANG_LABELS[myParticipant.languageHeard] || myParticipant.languageHeard}`
      : '';

    const isPlaying = playingId === item._id;
    const hasRecording = !!item.callRecordingUrl;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.iconContainer}>
            {getCallIcon(item.callType)}
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.participantName} numberOfLines={1}>
              {participantNames || 'Unknown'}
            </Text>
            <Text style={styles.callType}>{item.callType}</Text>
          </View>
          {hasRecording && (
            <TouchableOpacity
              style={[styles.playBtn, isPlaying && styles.playBtnActive]}
              onPress={() => playRecording(item)}
            >
              {isPlaying ? (
                <Square size={16} color={THEME.accent} />
              ) : (
                <Play size={16} color={THEME.accent} />
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDelete(item)}
          >
            <Trash2 size={18} color={THEME.danger} />
          </TouchableOpacity>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.footerItem}>
            <Clock size={14} color={THEME.textMuted} />
            <Text style={styles.footerText}>{formatDuration(item.duration)}</Text>
          </View>
          <Text style={styles.langText}>{langInfo}</Text>
          <Text style={styles.dateText}>{formatDate(item.createdAt)}</Text>
        </View>
      </View>
    );
  }, [user?._id, handleDelete, playingId, playRecording]);

  if (!user) {
    return (
      <LinearGradient colors={['#0a0a0f', '#1a1a2e']} style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Please login to view history</Text>
        </View>
      </LinearGradient>
    );
  }


  return (
    <LinearGradient colors={['#0a0a0f', '#1a1a2e']} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Call History</Text>
      </View>

      {loading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      ) : history.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Phone size={48} color={THEME.textMuted} />
          <Text style={styles.emptyText}>No call history yet</Text>
          <Text style={styles.emptySubtext}>
            Your calls and meetings will appear here
          </Text>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={THEME.accent}
            />
          }
        />
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: THEME.text,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: THEME.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    marginLeft: 12,
  },
  participantName: {
    fontSize: 16,
    fontWeight: '600',
    color: THEME.text,
  },
  callType: {
    fontSize: 12,
    color: THEME.textMuted,
    marginTop: 2,
  },
  playBtn: {
    padding: 8,
    marginRight: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
  },
  playBtnActive: {
    backgroundColor: 'rgba(0, 212, 255, 0.25)',
  },
  deleteBtn: {
    padding: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    fontSize: 12,
    color: THEME.textMuted,
    marginLeft: 4,
  },
  langText: {
    fontSize: 12,
    color: THEME.accent,
    marginLeft: 16,
    flex: 1,
  },
  dateText: {
    fontSize: 12,
    color: THEME.textMuted,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 18,
    color: THEME.text,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: THEME.textMuted,
    marginTop: 8,
    textAlign: 'center',
  },
});
