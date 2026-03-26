import { useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder as useExpoAudioRecorder,
} from 'expo-audio';
import * as FileSystemLegacy from 'expo-file-system/legacy';

// ─── VAD tuning ───────────────────────────────────────────────────────────────
const VAD = {
  FFT_SIZE: 2048,            // 46 ms window @ 44100 Hz — stable RMS
  MIN_THRESHOLD: 0.002,      // absolute floor regardless of calibration
  NOISE_MULTIPLIER: 5,       // threshold = max(noiseFloor × 5, MIN_THRESHOLD)
  CALIBRATION_FRAMES: 90,    // ~1.5 s at 60 fps
  SPEECH_ONSET_FRAMES: 2,    // consecutive voiced frames to start segment
  SILENCE_OFFSET_FRAMES: 25, // consecutive silent frames to end segment (~400 ms)
  MAX_SEGMENT_MS: 8_000,
  MIN_SEGMENT_MS: 200,
  NO_CHUNK_TIMEOUT_MS: 8_000, // after calibration: if no chunk, force one
} as const;

// Gain applied to the raw analyser stream — amplifies quiet mics
const ANALYSER_GAIN = 5;

// Native fixed-cycle duration
const NATIVE_CYCLE_MS = 3_000;

type OnChunk = (audioBase64: string, mimeType: string) => void;

/** RN / Hermes: DOMException is undefined — use plain Error for abortable waits. */
const ABORTED_WAIT_MESSAGE = 'Aborted';

function isAbortedWaitError(e: unknown): boolean {
  return e instanceof Error && e.message === ABORTED_WAIT_MESSAGE;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Interruptible delay; rejects with Error(ABORTED_WAIT_MESSAGE) when signal aborts. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    if (!signal) return;
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new Error(ABORTED_WAIT_MESSAGE));
      },
      { once: true },
    );
  });
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus', // Chrome, Edge
    'audio/ogg;codecs=opus',  // Firefox
    'audio/mp4',              // Safari 14.5+
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

async function enumerateAudioInputs(): Promise<void> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    console.log(`[VAD] Audio inputs (${inputs.length}):`);
    inputs.forEach((d, i) =>
      console.log(`  [${i}] "${d.label || 'Unknown'}" id=${d.deviceId.slice(0, 8)}…`),
    );
  } catch {}
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useVADAudioRecorder() {
  // ── Shared ────────────────────────────────────────────────────────────────
  const activeRef       = useRef(false);
  const isTtsPlayingRef = useRef(false);
  const onChunkRef      = useRef<OnChunk | null>(null);

  // ── Web: Audio graph nodes ────────────────────────────────────────────────
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const analyserRef       = useRef<AnalyserNode | null>(null);
  const gainNodeRef       = useRef<GainNode | null>(null);
  const rawStreamRef      = useRef<MediaStream | null>(null);  // for analyser only
  const recStreamRef      = useRef<MediaStream | null>(null);  // for MediaRecorder
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const chunksRef         = useRef<Blob[]>([]);

  // ── VAD state ─────────────────────────────────────────────────────────────
  const isSpeakingRef    = useRef(false);
  const speechFramesRef  = useRef(0);
  const silenceFramesRef = useRef(0);
  const segmentStartRef  = useRef(0);
  const maxTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafHandleRef     = useRef<number | null>(null);
  const forcedChunkRef   = useRef(false); // guard: only one forced chunk at a time

  // ── Adaptive calibration ──────────────────────────────────────────────────
  const calibFramesRef    = useRef(0);
  const calibRmsSumRef    = useRef(0);
  const adaptiveThreshold = useRef(VAD.MIN_THRESHOLD);
  const calibDoneRef      = useRef(false);
  const calibEndTimeRef   = useRef(0);
  const lastChunkTimeRef  = useRef(0);

  // ── Diagnostics ───────────────────────────────────────────────────────────
  const diagCountRef = useRef(0);
  const ctxMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Native ────────────────────────────────────────────────────────────────
  const nativeRecorder = useExpoAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const nativeCycleBusyRef = useRef(false);
  const nativeAbortRef = useRef<AbortController | null>(null);

  // ── TTS gate ──────────────────────────────────────────────────────────────
  const setTtsPlaying = useCallback((playing: boolean): void | Promise<void> => {
    isTtsPlayingRef.current = playing;
    if (playing) endSpeechSegment('tts-started');
    if (playing && Platform.OS !== 'web') {
      nativeAbortRef.current?.abort();
      return (async () => {
        const deadline = Date.now() + 5_000;
        while (nativeCycleBusyRef.current && Date.now() < deadline) {
          await new Promise<void>((r) => setTimeout(r, 25));
        }
      })();
    }
    return undefined;
  }, []);

  // ── Segment helpers ───────────────────────────────────────────────────────

  function flushSegment() {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state !== 'recording') return;
    mr.stop();
  }

  function endSpeechSegment(reason = 'silence') {
    if (!isSpeakingRef.current) return;
    isSpeakingRef.current = false;
    speechFramesRef.current  = 0;
    silenceFramesRef.current = 0;
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
    flushSegment();
  }

  function buildOnStop(mimeType: string, forced = false) {
    return () => {
      if (forced) forcedChunkRef.current = false;
      const duration = Date.now() - segmentStartRef.current;
      const blobs = chunksRef.current.splice(0);
      if (blobs.length === 0) {
        console.warn('[VAD] buildOnStop: no blobs collected');
        return;
      }
      if (!forced && duration < VAD.MIN_SEGMENT_MS) {
        console.log(`[VAD] Discarding short segment: ${duration}ms`);
        return;
      }
      const effectiveMime = mimeType || blobs[0]?.type || 'audio/webm';
      const blob = new Blob(blobs, { type: effectiveMime });
      const reader = new FileReader();
      reader.onloadend = () => {
        const b64 = (reader.result as string).split(',')[1];
        if (b64 && onChunkRef.current && activeRef.current) {
          lastChunkTimeRef.current = Date.now();
          console.log(
            `[VAD] ✓ Chunk sent: ${b64.length} chars, mime=${effectiveMime}` +
            `${forced ? ' (FORCED fallback)' : ''}`,
          );
          onChunkRef.current(b64, effectiveMime);
        }
      };
      reader.readAsDataURL(blob);
    };
  }

  function startSpeechSegment(recStream: MediaStream, mimeType: string, forced = false) {
    if (isSpeakingRef.current && !forced) return;
    if (forced && mediaRecorderRef.current?.state === 'recording') return;

    isSpeakingRef.current = true;
    silenceFramesRef.current = 0;
    chunksRef.current = [];
    segmentStartRef.current = Date.now();

    let mr: MediaRecorder;
    try {
      mr = mimeType
        ? new MediaRecorder(recStream, { mimeType })
        : new MediaRecorder(recStream);
    } catch (err) {
      console.error('[VAD] MediaRecorder create failed:', err);
      isSpeakingRef.current = false;
      return;
    }
    mediaRecorderRef.current = mr;
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = buildOnStop(mimeType, forced);

    try {
      mr.start(100);
    } catch (err) {
      console.error('[VAD] MediaRecorder start failed:', err);
      isSpeakingRef.current = false;
      return;
    }

    if (!forced) {
      // Hard cap: flush at MAX_SEGMENT_MS then restart
      maxTimerRef.current = setTimeout(() => {
        if (!isSpeakingRef.current || mediaRecorderRef.current?.state !== 'recording') return;
        mediaRecorderRef.current.onstop = () => {
          buildOnStop(mimeType)();
          isSpeakingRef.current = false;
          startSpeechSegment(recStream, mimeType);
        };
        mediaRecorderRef.current.stop();
      }, VAD.MAX_SEGMENT_MS);
    }
  }

  // ── Web: VAD loop ─────────────────────────────────────────────────────────

  function runVADFrame(recStream: MediaStream, mimeType: string) {
    if (!activeRef.current) return;
    rafHandleRef.current = requestAnimationFrame(() => runVADFrame(recStream, mimeType));

    if (isTtsPlayingRef.current) {
      if (isSpeakingRef.current) endSpeechSegment('tts-active');
      return;
    }

    const analyser = analyserRef.current;
    if (!analyser) return;

    // Use fftSize (2048) — not frequencyBinCount (1024) — for time-domain data
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);

    // Verify first non-zero frame (one-time check)
    if (diagCountRef.current === 1) {
      const hasNonZero = data.some((v) => v !== 0);
      console.log(`[VAD] First frame non-zero check: ${hasNonZero}` +
        ` (if false, AudioContext may still be suspended)`);
      const ctx = audioCtxRef.current;
      if (ctx) console.log(`[VAD] AudioContext state at first frame: ${ctx.state}`);
    }

    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);

    // ── Adaptive calibration ───────────────────────────────────────────────
    if (!calibDoneRef.current) {
      calibRmsSumRef.current += rms;
      calibFramesRef.current++;
      if (calibFramesRef.current >= VAD.CALIBRATION_FRAMES) {
        const noiseFloor = calibRmsSumRef.current / VAD.CALIBRATION_FRAMES;
        adaptiveThreshold.current = Math.max(
          noiseFloor * VAD.NOISE_MULTIPLIER,
          VAD.MIN_THRESHOLD,
        );
        calibDoneRef.current  = true;
        calibEndTimeRef.current  = Date.now();
        lastChunkTimeRef.current = Date.now();
        console.log(
          `[VAD] Calibration done: noiseFloor=${noiseFloor.toFixed(5)}` +
          ` → threshold=${adaptiveThreshold.current.toFixed(5)}`,
        );
        if (noiseFloor < 0.0001) {
          console.warn(
            '[VAD] ⚠ Noise floor near zero after calibration — AudioContext ' +
            'is likely still suspended. Check that startRecording() is called ' +
            'directly from a user click/tap handler.',
          );
        }
      }
    }

    // ── Periodic diagnostic log ────────────────────────────────────────────
    diagCountRef.current++;
    if (diagCountRef.current % 90 === 0) {
      console.log(
        `[VAD] rms=${rms.toFixed(5)} threshold=${adaptiveThreshold.current.toFixed(5)}` +
        ` speaking=${isSpeakingRef.current} calibrated=${calibDoneRef.current}` +
        ` ctxState=${audioCtxRef.current?.state ?? 'n/a'}`,
      );
    }

    // ── Fallback: no chunk in 8 s after calibration ────────────────────────
    if (
      calibDoneRef.current &&
      !forcedChunkRef.current &&
      !isTtsPlayingRef.current &&
      Date.now() - calibEndTimeRef.current > VAD.NO_CHUNK_TIMEOUT_MS &&
      Date.now() - lastChunkTimeRef.current > VAD.NO_CHUNK_TIMEOUT_MS
    ) {
      const prev = adaptiveThreshold.current;
      adaptiveThreshold.current = Math.max(prev * 0.5, 0.0005);
      calibEndTimeRef.current = Date.now(); // reset window

      console.warn(
        `[VAD] No speech in ${VAD.NO_CHUNK_TIMEOUT_MS / 1000}s.` +
        ` Threshold: ${prev.toFixed(5)} → ${adaptiveThreshold.current.toFixed(5)}.` +
        ` Sending forced diagnostic chunk…`,
      );

      // Force a 1.5 s chunk so the STT pipeline is verified even without VAD
      forcedChunkRef.current = true;
      const savedIsSpeaking = isSpeakingRef.current;
      if (!savedIsSpeaking) isSpeakingRef.current = true; // guard startSpeechSegment
      startSpeechSegment(recStream, mimeType, true);
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          endSpeechSegment('forced-chunk-end');
        }
        isSpeakingRef.current = savedIsSpeaking;
      }, 1_500);
    }

    // ── VAD state machine ─────────────────────────────────────────────────
    const threshold = adaptiveThreshold.current;
    const voiced    = rms > threshold;

    if (voiced) {
      speechFramesRef.current++;
      silenceFramesRef.current = 0;
      if (!isSpeakingRef.current && speechFramesRef.current >= VAD.SPEECH_ONSET_FRAMES) {
        console.log(`[VAD] Speech onset: rms=${rms.toFixed(5)} > threshold=${threshold.toFixed(5)}`);
        startSpeechSegment(recStream, mimeType);
      }
    } else {
      silenceFramesRef.current++;
      speechFramesRef.current = 0;
      if (isSpeakingRef.current && silenceFramesRef.current >= VAD.SILENCE_OFFSET_FRAMES) {
        endSpeechSegment('silence');
      }
    }
  }

  
  const warmUpAudio = useCallback(() => {
    if (Platform.OS !== 'web') return;
    if (typeof AudioContext === 'undefined') return;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      // Already warm — resume in case browser suspended it
      audioCtxRef.current.resume().catch(() => {});
      return;
    }
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      ctx.resume().catch(() => {});
      console.log(`[VAD] warmUpAudio: ctx created in user-gesture: state=${ctx.state} sr=${ctx.sampleRate}`);
    } catch (err) {
      console.warn('[VAD] warmUpAudio failed:', err);
    }
  }, []);

  // ── Web: entry point ──────────────────────────────────────────────────────

  function startWebRecording(onChunk: OnChunk, onDenied?: () => void) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;

    let ctx: AudioContext;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      ctx = audioCtxRef.current;
      console.log(`[VAD] Reusing pre-warmed AudioContext: state=${ctx.state} sr=${ctx.sampleRate}`);
    } else {
      try {
        ctx = new AudioContext();
        audioCtxRef.current = ctx;
        console.log(`[VAD] AudioContext created (late — may be suspended): state=${ctx.state}`);
      } catch (err) {
        console.error('[VAD] AudioContext creation failed:', err);
        return;
      }
    }

    // Reset calibration for fresh start
    calibFramesRef.current    = 0;
    calibRmsSumRef.current    = 0;
    calibDoneRef.current      = false;
    adaptiveThreshold.current = VAD.MIN_THRESHOLD;
    diagCountRef.current      = 0;
    lastChunkTimeRef.current  = Date.now();
    forcedChunkRef.current    = false;

    // Log available devices (async, non-blocking)
    enumerateAudioInputs();

    // ── FIX #2: Raw stream for VAD analyser (no EC/NS to preserve signal) ─
    const rawConstraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: false,  // MUST be false — EC can suppress speech
        noiseSuppression: false,  // MUST be false — NS alters signal energy
        autoGainControl: true,    // keep: compensates for quiet hardware mics
        channelCount: 1,
        sampleRate: { ideal: 16_000 },
      },
      video: false,
    };

    // Processed stream for MediaRecorder (EC/NS on for cleaner audio to STT)
    const recConstraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: { ideal: 16_000 },
      },
      video: false,
    };

    // Get both streams in parallel
    Promise.all([
      navigator.mediaDevices.getUserMedia(rawConstraints),
      navigator.mediaDevices.getUserMedia(recConstraints),
    ])
      .then(async ([rawStream, recStream]) => {
        rawStreamRef.current = rawStream;
        recStreamRef.current = recStream;
        onChunkRef.current   = onChunk;
        activeRef.current    = true;

        // ── Track verification ────────────────────────────────────────────
        const rawTrack = rawStream.getAudioTracks()[0];
        if (!rawTrack) {
          console.error('[VAD] Raw stream has no audio track!');
          return;
        }
        const settings = rawTrack.getSettings?.() ?? {};
        console.log(
          `[VAD] Raw track: label="${rawTrack.label}"` +
          ` enabled=${rawTrack.enabled} muted=${rawTrack.muted}` +
          ` readyState=${rawTrack.readyState}`,
        );
        console.log(
          `[VAD] Raw settings: sampleRate=${(settings as any).sampleRate}` +
          ` ch=${(settings as any).channelCount}` +
          ` ec=${(settings as any).echoCancellation}` +
          ` ns=${(settings as any).noiseSuppression}`,
        );
        if (rawTrack.muted) {
          console.warn(
            '[VAD] ⚠ Audio track is MUTED — check OS/hardware mute.' +
            ' VAD will see silence regardless of microphone state.',
          );
        }

        // ── AudioContext state ────────────────────────────────────────────
        // Should be 'running' already. Resume as safety net.
        if (ctx.state !== 'running') {
          console.warn(`[VAD] AudioContext state after getUserMedia: ${ctx.state} — attempting resume`);
          await ctx.resume().catch(() => {});
          console.log(`[VAD] After resume: ${ctx.state}`);
        }

        // ── FIX #3: Build audio graph with GainNode ───────────────────────
        // raw stream → source → gain(5×) → analyser
        const source   = ctx.createMediaStreamSource(rawStream);
        const gainNode = ctx.createGain();
        gainNode.gain.value = ANALYSER_GAIN; // 5× — handles low-sensitivity mics
        const analyser = ctx.createAnalyser();
        analyser.fftSize              = VAD.FFT_SIZE; // 2048
        analyser.smoothingTimeConstant = 0;           // no smoothing on time-domain

        source.connect(gainNode);
        gainNode.connect(analyser);
        // NOT connected to ctx.destination — no speaker feedback loop

        gainNodeRef.current = gainNode;
        analyserRef.current = analyser;

        const mimeType = pickMimeType();
        console.log(
          `[VAD] Web recording ready | mimeType=${mimeType || 'browser-default'}` +
          ` | ctxRate=${ctx.sampleRate} | gain=${ANALYSER_GAIN}`,
        );

        // ── FIX #7: Monitor AudioContext state ────────────────────────────
        if (ctxMonitorRef.current) clearInterval(ctxMonitorRef.current);
        ctxMonitorRef.current = setInterval(() => {
          if (!activeRef.current) {
            clearInterval(ctxMonitorRef.current!);
            return;
          }
          if (ctx.state !== 'running') {
            console.warn(`[VAD] AudioContext drifted to ${ctx.state} — resuming`);
            ctx.resume().catch(() => {});
          }
        }, 5_000);

        runVADFrame(recStream, mimeType);
      })
      .catch((err) => {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          onDenied?.();
        } else {
          console.error('[VAD] getUserMedia error:', err);
        }
        // Clean up AudioContext if streams failed
        ctx.close().catch(() => {});
        audioCtxRef.current = null;
      });
  }

  function stopWebRecording() {
    if (ctxMonitorRef.current) {
      clearInterval(ctxMonitorRef.current);
      ctxMonitorRef.current = null;
    }
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    }
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
    if (mediaRecorderRef.current?.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    isSpeakingRef.current    = false;
    speechFramesRef.current  = 0;
    silenceFramesRef.current = 0;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    gainNodeRef.current = null;
    analyserRef.current = null;
    rawStreamRef.current?.getTracks().forEach((t) => t.stop());
    rawStreamRef.current = null;
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
  }

  // ── Native: fixed-interval recording with TTS gate ────────────────────────

  async function startNativeRecording(onChunk: OnChunk, onDenied?: () => void) {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { onDenied?.(); return; }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
      });

      activeRef.current  = true;
      onChunkRef.current = onChunk;
      console.log('[VAD] Native recording started');
      void runNativeCycle();
    } catch (err: any) {
      console.error('[VAD] Native start error:', err);
      onDenied?.();
    }
  }

  async function runNativeCycle(): Promise<void> {
    if (!activeRef.current) return;
    if (isTtsPlayingRef.current) {
      setTimeout(() => void runNativeCycle(), 200);
      return;
    }
    if (nativeCycleBusyRef.current) return;

    nativeCycleBusyRef.current = true;
    const ac = new AbortController();
    nativeAbortRef.current = ac;
    let retryDelayMs = 0;

    try {
      await nativeRecorder.prepareToRecordAsync();
      nativeRecorder.record();
      console.log('[VAD] Native: recording chunk…');

      await wait(NATIVE_CYCLE_MS, ac.signal);

      if (!activeRef.current) {
        try {
          await nativeRecorder.stop();
        } catch {
          /* not recording */
        }
        return;
      }

      await nativeRecorder.stop();
      const uri = nativeRecorder.uri;
      console.log(`[VAD] Native: stopped, uri=${uri}`);

      if (!isTtsPlayingRef.current && uri) {
        const base64 = await FileSystemLegacy.readAsStringAsync(uri, {
          encoding: FileSystemLegacy.EncodingType.Base64,
        });
        if (base64 && onChunkRef.current && activeRef.current) {
          lastChunkTimeRef.current = Date.now();
          console.log(`[VAD] Native ✓ Sending chunk: ${base64.length} chars`);
          onChunkRef.current(base64, 'audio/m4a');
        }
        await FileSystemLegacy.deleteAsync(uri, { idempotent: true }).catch(() => {});
      } else if (!uri) {
        console.warn('[VAD] Native: uri was null after stop()');
      } else if (uri && isTtsPlayingRef.current) {
        await FileSystemLegacy.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    } catch (outerErr: unknown) {
      if (isAbortedWaitError(outerErr)) {
        try {
          await nativeRecorder.stop();
        } catch {
          /* not recording */
        }
        const uri = nativeRecorder.uri;
        if (uri) await FileSystemLegacy.deleteAsync(uri, { idempotent: true }).catch(() => {});
      } else {
        console.error('[VAD] Native cycle error:', outerErr);
        retryDelayMs = 1_000;
      }
    } finally {
      nativeAbortRef.current = null;
      nativeCycleBusyRef.current = false;
      if (!activeRef.current) return;
      const delay = isTtsPlayingRef.current ? 200 : retryDelayMs;
      setTimeout(() => void runNativeCycle(), delay);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  const startRecording = useCallback((onChunk: OnChunk, onDenied?: () => void) => {
    if (activeRef.current) return;
    if (Platform.OS === 'web') {
      startWebRecording(onChunk, onDenied);
    } else {
      startNativeRecording(onChunk, onDenied);
    }
  }, []);

  const stopRecording = useCallback(() => {
    activeRef.current = false;
    nativeAbortRef.current?.abort();
    if (Platform.OS === 'web') {
      stopWebRecording();
    } else {
      void nativeRecorder.stop().catch(() => {});
    }
  }, []);

  const stopRecordingImmediately = useCallback((): void => {
    nativeAbortRef.current?.abort();
  }, []);

  return { startRecording, stopRecording, setTtsPlaying, warmUpAudio, stopRecordingImmediately };
}