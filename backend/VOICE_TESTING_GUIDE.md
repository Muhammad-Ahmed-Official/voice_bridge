# 🎤 Voice Bridge - Testing & Optimization Guide

## Quick Start Testing

### Prerequisites
```bash
# Ensure .env is configured with:
MONGO_URI=mongodb+srv://...
GOOGLE_API_KEY=AIzaSy...
ELEVENLABS_API_KEY=sk_...
```

### Run Tests

**1. Latency Benchmark Test (Recommended First)**
```bash
node tests/latencyBenchmark.js
```
✅ Tests Translation + TTS latency without database dependency

**2. Integration Test (Full Flow)**
```bash
node tests/integrationTest.js
```
✅ Tests complete pipeline with database operations

**3. Jest Tests (Advanced)**
```bash
npm test:voice
```
✅ Comprehensive unit + integration tests with coverage

---

## Voice Pipeline Flow

### Current Architecture

```
User Audio Input
    ↓
┌─────────────────────────────────────────┐
│  STEP 1: Speech-to-Text (STT)           │
│  Google Cloud Speech API                │
│  Input:  Audio (webm, m4a, wav)         │
│  Output: Transcript (text)              │
│  Latency: 500-1500ms                    │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  STEP 2: Translation                    │
│  Google Cloud Translate API             │
│  Input:  Transcript + Language Pair     │
│  Output: Translated Text                │
│  Latency: 300-800ms                     │
│  (With Cache: < 10ms)                   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  STEP 3: Text-to-Speech (TTS)           │
│  Google TTS (Default)                   │
│  ElevenLabs (With Voice Cloning)        │
│  Input:  Translated Text + Locale       │
│  Output: Audio Base64                   │
│  Latency: 800-2000ms                    │
└─────────────────────────────────────────┘
    ↓
Listener Hears Audio
```

### Total Pipeline Latency Target

| Scenario | Target | Current |
|----------|--------|---------|
| Basic Translation + TTS | < 2000ms | 1300-2500ms |
| With Translation Cache | < 1500ms | 900-1300ms |
| With Voice Cloning | < 3000ms | 2000-4000ms |

---

## Test Files Overview

### 1. `tests/latencyBenchmark.js`
**Purpose:** Measure latency of individual services

**What it tests:**
- ✅ Translation latency (UR→EN, EN→AR, AR→UR)
- ✅ TTS latency (EN, UR, AR)
- ✅ End-to-end pipeline latency
- ✅ Performance assessment & recommendations

**Run it:**
```bash
node tests/latencyBenchmark.js
```

**Expected Output:**
```
📊 LATENCY BENCHMARK RESULTS
⏱️  Measurements:
   1. Translation: UR→EN: 523.45ms
   2. TTS: English Synthesis: 1245.67ms
   ...

🎯 Performance Assessment:
   ✅ Translation: 523.45ms (IDEAL < 300ms)
   ⚠️  TTS: 1245.67ms (ACCEPTABLE < 1500ms)

💡 Optimization Recommendations:
   ✅ Latency is good! Ready for voice cloning.
```

### 2. `tests/integrationTest.js`
**Purpose:** Test complete flow with database

**What it tests:**
- ✅ Database connectivity
- ✅ User creation/management
- ✅ Voice chunk processing
- ✅ Multi-language flows
- ✅ Error handling
- ✅ Voice cloning integration

**Run it:**
```bash
node tests/integrationTest.js
```

**Expected Output:**
```
🎤 VOICE BRIDGE - INTEGRATION TEST
✅ Connected to MongoDB
✅ Created speaker user: integration_test_1701234567
✅ Created listener user: integration_listener_1701234567

📍 TEST 1: Voice Chunk Processing
Processing voice chunk: Speaker talks in Urdu → Listener hears in English

📊 Voice Chunk Processing Result:
   Transcript: "السلام عليكم"
   Translated: "Hello"
   Audio Output: Generated
   Total Latency: 1847.23ms
```

### 3. `tests/voiceFlow.test.js`
**Purpose:** Jest unit + integration tests

**What it tests:**
- ✅ Translation service
- ✅ Text-to-speech service
- ✅ Voice cloning state management
- ✅ End-to-end flows
- ✅ Latency benchmarks
- ✅ Error handling

**Run it:**
```bash
npm install --save-dev jest @jest/globals
npm test:voice
```

---

## Latency Optimization Strategies

### PHASE 1: Reduce STT Latency (Current: 500-1500ms)

**Current Issues:**
- M4A → WAV conversion (FFmpeg) adds 200-400ms
- Network latency to Google API
- Large audio files take longer

**Optimizations:**
```javascript
// ✅ DONE: Already implemented in voiceHandler.js
// 1. Parallel processing (don't wait for STT before translation)
// 2. Buffer audio chunks (collect 1.5s data before processing)
// 3. Auto-convert M4A format before sending to Google

// TODO: Future optimizations
// 1. Implement client-side audio preprocessing
// 2. Use local STT model for initial transcription
// 3. Stream audio to Google API instead of batch processing
```

### PHASE 2: Reduce Translation Latency (Current: 300-800ms)

**Current Issues:**
- Network latency to Google API
- No caching mechanism

**Optimizations:**
```javascript
// ✅ DONE: Translation caching implemented
translationCache.get(text, from, to)  // < 10ms if cached
translationCache.set(text, from, to, result)

// TODO: Future optimizations
// 1. Pre-translate common phrases
// 2. Implement batch translation for multiple texts
// 3. Cache at CDN level
```

### PHASE 3: Reduce TTS Latency (Current: 800-2000ms)

**Current Issues:**
- Network latency to Google TTS API
- Large audio files being generated
- No streaming option

**Optimizations:**
```javascript
// ✅ DONE: Caching structure ready
// TODO: Implement audio caching
//   Cache common phrases: "Hello", "How are you?", etc.

// TODO: Implement streaming TTS
//   Don't wait for full audio, send chunks as they arrive

// TODO: Use parallel TTS for multiple languages
//   If user has multiple listening languages, synthesize all in parallel
```

---

## Frontend Integration Checklist

### ✅ What's Ready

- [x] `voiceHandler.js` - Complete voice processing service
- [x] `latencyProfiler.js` - Latency measurement utilities
- [x] Test files for validation
- [x] Error handling & graceful degradation
- [x] Multi-language support (UR, EN, AR)

### 🔄 Frontend Integration Points

```javascript
// In Socket.io handler, import and use:
import { processVoiceChunk } from './services/voiceHandler.js';

socket.on('voice_chunk', async (data) => {
  const result = await processVoiceChunk({
    audioBase64: data.audio,
    audioMimeType: data.mimeType,
    speakerLanguage: data.speakingLanguage,
    listenerLanguage: data.listeningLanguage,
    speakerId: data.userId,
    listenerId: data.receiverId,
    enableCloning: false, // true after latency optimized
  });

  // Send back to listener
  io.to(listenerSocketId).emit('voice_output', {
    audio: result.audioOutput,
    transcript: result.transcript,
    translated: result.translatedText,
    latency: result.latency,
  });
});
```

### 📋 Required Frontend Changes (Minimal)

1. **In Expo Audio Recording:**
```javascript
// Send audio chunk with metadata
const audioData = await recordingObject.stopAndUnloadAsync();
socket.emit('voice_chunk', {
  audio: audioData.base64, // Already base64 from Expo
  mimeType: 'audio/m4a',  // iOS gives m4a, Android gives ogg
  speakingLanguage: userSettings.speakingLanguage,
  listeningLanguage: otherUserSettings.listeningLanguage,
  userId: currentUser._id,
  receiverId: otherUser._id,
});
```

2. **In Voice Output Handler:**
```javascript
socket.on('voice_output', (data) => {
  // Update UI with transcript for debugging
  setTranscript(data.transcript);
  setTranslated(data.translated);

  // Play audio to user
  playAudio(data.audio, data.audioFormat);

  // Log latency for monitoring
  console.log('Voice latency:', data.latency);
});
```

---

## Performance Monitoring

### Real-time Latency Tracking

```javascript
// In every voice transmission:
const profiler = new LatencyProfiler(sessionId);

profiler.logOperation('STT Complete', sttLatency);
profiler.logOperation('Translation Complete', translationLatency);
profiler.logOperation('TTS Complete', ttsLatency);

const report = profiler.getReport();
// Send to monitoring service for analysis
```

### What to Monitor

1. **Per-user latency** - Varies by device/network
2. **Per-language pair** - Some combinations slower
3. **Peak times** - Latency during high load
4. **Error rates** - API failures, timeouts

---

## Troubleshooting Guide

### Issue: Translation latency > 800ms

**Symptoms:** Users experience noticeable delay

**Fixes:**
1. Check Google Cloud quota - may be throttled
2. Verify network latency: `curl -w "@curl-format.txt" -o /dev/null -s https://translate.googleapis.com/`
3. Enable translation cache - should hit > 50% of the time
4. Consider edge cache (CloudFlare, etc.)

### Issue: TTS latency > 2000ms

**Symptoms:** Audio takes too long to generate

**Fixes:**
1. Check Google TTS API - may be overloaded
2. Pre-generate common phrases
3. Use regional API endpoints
4. Implement audio caching

### Issue: STT failing on M4A audio

**Symptoms:** "M4A→WAV conversion failed"

**Fixes:**
1. Ensure FFmpeg is installed: `apt-get install ffmpeg`
2. Check ffmpeg-static package version
3. Verify audio format from frontend

---

## Next Steps: Voice Cloning

Once latency is optimized to < 2000ms for basic flow:

1. **Enable voice cloning:**
```javascript
// Update user preferences
await User.updateOne(
  { userId },
  { $set: { voiceCloningEnabled: true } }
);
```

2. **Implement voice cloning in voiceHandler:**
```javascript
enableCloning: true,  // Trigger voice recording/cloning
```

3. **Monitor cloning latency:**
- Initial: 45s to collect 20s of audio
- Cloning API call: 5-10s
- Cached voice: < 1s

---

## Testing Commands Reference

```bash
# Quick latency test (no DB needed)
node tests/latencyBenchmark.js

# Full integration test (needs DB)
node tests/integrationTest.js

# Run Jest tests
npm test:voice

# Run all tests
npm test

# Watch mode (re-run on file changes)
npm test -- --watch
```

---

## Success Criteria

✅ **Latency Targets Achieved:**
- [ ] STT: < 1000ms
- [ ] Translation: < 500ms (with cache: < 50ms)
- [ ] TTS: < 1500ms
- [ ] Total Pipeline: < 2000ms

✅ **All Tests Passing:**
- [ ] Latency benchmark shows green ✅
- [ ] Integration test completes successfully
- [ ] Jest coverage > 80%

✅ **Frontend Integration Working:**
- [ ] Audio plays in real-time
- [ ] Transcripts display correctly
- [ ] Translations appear instantly
- [ ] No crashes or memory leaks

---

## Support & Questions

If tests fail, check:
1. `.env` file configured correctly
2. Network connectivity to Google APIs
3. MongoDB connection
4. FFmpeg installation: `ffmpeg -version`
5. Node.js version: `node --version` (should be 18+)

Debug logs available in:
- Backend console (detailed logs)
- MongoDB logs
- Network tab (browser DevTools)
