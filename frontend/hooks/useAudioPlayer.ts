/**
 * useAudioPlayer
 *
 * Encapsulates all TTS / passthrough audio playback for both web and native.
 *
 * Design goals:
 *  - One active player at a time: new audio cancels the previous (prevents overlap)
 *  - Proper resource cleanup: players are removed after playback + on unmount
 *  - AudioMode set once per hook lifetime (not per-play): avoids repeat iOS session calls
 *  - Stable `playAudio` / `stopAudio` references (useCallback): safe in useEffect deps
 *
 * Web:   HTMLAudioElement (no expo-audio involved — browser handles MP3 natively)
 * Native: expo-audio `createAudioPlayer` (imperative API — supports dynamic base64 sources)
 */

import { useRef, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

type PlayCallback = () => void | Promise<void>;

export function useAudioPlayer() {
  // ── Native player instance ──────────────────────────────────────────────────
  const playerRef       = useRef<AudioPlayer | null>(null);
  const playerSubRef    = useRef<{ remove: () => void } | null>(null);
  const playerTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Web audio instance ──────────────────────────────────────────────────────
  const webAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── Pending end callback (for the currently playing audio) ──────────────────
  // Stored in a ref so stopCurrentPlayer() can fire it when interrupting mid-play.
  const pendingOnEndRef = useRef<PlayCallback | null>(null);

  // ── Audio mode: initialised once, not per-play ──────────────────────────────
  const audioModeReadyRef = useRef(false);

  // Cleanup on unmount — silence everything without firing onEnd callbacks
  useEffect(() => {
    return () => {
      pendingOnEndRef.current = null; // suppress onEnd on unmount
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

  // Stop current playback and optionally fire the queued onEnd callback.
  function stopCurrentPlayer(fireOnEnd = false) {
    const cb = pendingOnEndRef.current;
    pendingOnEndRef.current = null;
    releaseCurrentPlayer();
    if (fireOnEnd) cb?.();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Play a base64-encoded MP3 audio string.
   * Any previously playing audio is stopped immediately (not queued).
   *
   * @param audioBase64  - Base64 MP3 string (no data-URI prefix needed)
   * @param onStart      - Called just before playback begins (use to mute mic)
   * @param onEnd        - Called when playback finishes or errors (use to unmute mic)
   */
  const playAudio = useCallback(async (
    audioBase64: string,
    onStart?: PlayCallback,
    onEnd?: PlayCallback,
  ) => {
    if (!audioBase64) return;

    // Suppress the previous onEnd when interrupting (we're chaining, not stopping)
    pendingOnEndRef.current = null;
    releaseCurrentPlayer();

    console.log('[AudioPlayer] playAudio — bytes:', audioBase64.length);

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      try {
        const audio = new window.Audio('data:audio/mp3;base64,' + audioBase64);
        webAudioRef.current = audio;
        pendingOnEndRef.current = onEnd ?? null;

        const markEnded = () => {
          if (webAudioRef.current === audio) webAudioRef.current = null;
          const cb = pendingOnEndRef.current;
          pendingOnEndRef.current = null;
          cb?.();
        };

        audio.addEventListener('ended', markEnded, { once: true });
        audio.addEventListener('error', () => {
          console.warn('[AudioPlayer] web HTMLAudioElement error');
          markEnded();
        }, { once: true });

        await Promise.resolve(onStart?.());
        await audio.play();
      } catch (err: any) {
        console.error('[AudioPlayer] web play error:', err?.message ?? err);
        webAudioRef.current = null;
        pendingOnEndRef.current = null;
        onEnd?.();
      }

    } else {
      // ── Native: expo-audio ─────────────────────────────────────────────────
      try {
        // Stop / yield recorder BEFORE session + player so TTS can grab the route.
        await Promise.resolve(onStart?.());

        // Set iOS audio session once: allowsRecording=true keeps the mic active
        // during TTS playback (iOS would otherwise suspend it).
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
        pendingOnEndRef.current = onEnd ?? null;

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
          const cb = pendingOnEndRef.current;
          pendingOnEndRef.current = null;
          cb?.();
        };

        const sub = player.addListener('playbackStatusUpdate', (status) => {
          if (status?.didJustFinish) markEnded();
        });
        playerSubRef.current = sub;

        // Safety net: force-release after 60 s (avoids leaking stale players)
        playerTimerRef.current = setTimeout(markEnded, 60_000);

        player.play();

      } catch (err: any) {
        console.error('[AudioPlayer] native play error:', err?.message ?? err);
        playerRef.current = null;
        pendingOnEndRef.current = null;
        onEnd?.();
      }
    }
  }, []);

  /**
   * Stop any currently playing audio and fire the pending onEnd callback.
   * Call this when a call ends to cleanly release all resources.
   */
  const stopAudio = useCallback(() => {
    stopCurrentPlayer(true); // fire onEnd so TTS gate is lifted
  }, []);

  return { playAudio, stopAudio };
}
