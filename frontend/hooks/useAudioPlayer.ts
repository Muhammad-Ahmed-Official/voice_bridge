import { useRef, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

type PlayCallback = () => void | Promise<void>;
type QueueItem = {
  audioBase64: string;
  onStart?: PlayCallback;
  onEnd?: PlayCallback;
};

export function useAudioPlayer() {
  // ── Native player instance ──────────────────────────────────────────────────
  const playerRef = useRef<AudioPlayer | null>(null);
  const playerSubRef = useRef<{ remove: () => void } | null>(null);
  const playerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Web audio instance ──────────────────────────────────────────────────────
  const webAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── Queue & playback guards ────────────────────────────────────────────────
  const queueRef = useRef<QueueItem[]>([]);
  const isPlayingRef = useRef(false);
  const processingRef = useRef(false);

  // ── Audio mode: initialised once, not per-play ──────────────────────────────
  const audioModeReadyRef = useRef(false);

  // Cleanup on unmount — clear queue and release players
  useEffect(() => {
    return () => {
      queueRef.current = [];
      isPlayingRef.current = false;
      processingRef.current = false;
      releaseCurrentPlayer();
    };
  }, []);

  // ─── Internal helpers ────────────────────────────────────────────────────────

  function releaseCurrentPlayer() {
    // Web
    if (webAudioRef.current) {
      try {
        webAudioRef.current.pause();
        webAudioRef.current.src = '';
      } catch {}
      webAudioRef.current = null;
    }
    // Native
    if (playerSubRef.current) {
      try { playerSubRef.current.remove(); } catch {}
      playerSubRef.current = null;
    }
    if (playerTimerRef.current) {
      clearTimeout(playerTimerRef.current);
      playerTimerRef.current = null;
    }
    if (playerRef.current) {
      try { playerRef.current.remove?.(); } catch {}
      playerRef.current = null;
    }
  }

  // Stop current playback and clear queue.
  function stopCurrentPlayer() {
    queueRef.current = [];
    isPlayingRef.current = false;
    processingRef.current = false;
    releaseCurrentPlayer();
  }

  const playSingleAudio = useCallback(async (
    audioBase64: string,
    onStart?: PlayCallback,
    onEnd?: PlayCallback,
  ) => {
    if (!audioBase64) return;
    console.log('[AudioPlayer] playAudio — bytes:', audioBase64.length);

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      try {
        const audio = new window.Audio('data:audio/mp3;base64,' + audioBase64);
        webAudioRef.current = audio;

        await Promise.resolve(onStart?.());

        await new Promise<void>((resolve) => {
          const markEnded = () => {
            if (webAudioRef.current === audio) webAudioRef.current = null;
            resolve();
          };

          audio.addEventListener('ended', markEnded, { once: true });
          audio.addEventListener('error', () => {
            console.warn('[AudioPlayer] web HTMLAudioElement error');
            markEnded();
          }, { once: true });

          audio.play().catch((err) => {
            console.warn('[AudioPlayer] web play() rejected:', err);
            markEnded();
          });
        });
      } catch (err: any) {
        console.error('[AudioPlayer] web play error:', err?.message ?? err);
      } finally {
        webAudioRef.current = null;
        await Promise.resolve(onEnd?.());
      }
    } else {
      // ── Native: expo-audio ─────────────────────────────────────────────────
      try {
        await Promise.resolve(onStart?.());

        if (!audioModeReadyRef.current) {
          await setAudioModeAsync({
            playsInSilentMode: true,
            allowsRecording: true,
            interruptionMode: 'doNotMix',
          });
          audioModeReadyRef.current = true;
        }

        const player = createAudioPlayer({
          uri: 'data:audio/mp3;base64,' + audioBase64,
        });
        playerRef.current = player;

        await new Promise<void>((resolve) => {
          let finished = false;
          const markEnded = () => {
            if (finished) return;
            finished = true;
            if (playerRef.current === player) playerRef.current = null;
            if (playerTimerRef.current) {
              clearTimeout(playerTimerRef.current);
              playerTimerRef.current = null;
            }
            if (playerSubRef.current) {
              try { playerSubRef.current.remove(); } catch {}
              playerSubRef.current = null;
            }
            try { player.remove?.(); } catch {}
            resolve();
          };

          const sub = player.addListener('playbackStatusUpdate', (status) => {
            if (status?.didJustFinish) markEnded();
          });
          playerSubRef.current = sub;

          // Safety net: force-release after 60 s (avoids leaking stale players)
          playerTimerRef.current = setTimeout(markEnded, 60_000);

          player.play();
        });
      } catch (err: any) {
        console.error('[AudioPlayer] native play error:', err?.message ?? err);
      } finally {
        playerRef.current = null;
        await Promise.resolve(onEnd?.());
      }
    }
  }, []);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current.shift();
        if (!item || !item.audioBase64) continue;
        isPlayingRef.current = true;
        await playSingleAudio(item.audioBase64, item.onStart, item.onEnd);
      }
    } finally {
      isPlayingRef.current = false;
      processingRef.current = false;
    }
  }, [playSingleAudio]);

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Queue a base64-encoded MP3 chunk. Chunks are played sequentially in FIFO order.
   */
  const playAudio = useCallback(async (
    audioBase64: string,
    onStart?: PlayCallback,
    onEnd?: PlayCallback,
  ) => {
    if (!audioBase64) return;
    queueRef.current.push({ audioBase64, onStart, onEnd });
    if (!processingRef.current) {
      await processQueue();
    }
  }, [processQueue]);

  const stopAudio = useCallback(() => {
    stopCurrentPlayer();
  }, []);

  return {
    playAudio,
    stopAudio,
    stopCurrentPlayer,
    isPlaybackActive: () => isPlayingRef.current || queueRef.current.length > 0,
  };
}