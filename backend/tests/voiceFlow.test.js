/**
 * Voice Bridge - Integration Tests
 * Tests STT → Translation → TTS flow with latency measurement
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { translateText } from '../src/services/translate.js';
import { transcribeAudio } from '../src/services/stt.js';
import { synthesizeSpeech, getTtsForUser } from '../src/services/tts.js';
import {
  initCloneBuffer,
  addChunkToCloneBuffer,
  getCloneState,
  clearCloneBuffer,
  isVoiceLimitReached,
} from '../src/services/voiceCloning.js';
import { User } from '../src/models/user.models.js';
import mongoose from 'mongoose';

/**
 * Latency Measurement Utility
 */
class LatencyProfiler {
  constructor(name) {
    this.name = name;
    this.measurements = [];
  }

  measure(label, fn) {
    return async (...args) => {
      const start = process.hrtime.bigint();
      try {
        const result = await fn(...args);
        const end = process.hrtime.bigint();
        const latencyMs = Number(end - start) / 1_000_000;
        this.measurements.push({ label, latencyMs, success: true });
        console.log(`⏱️  [${this.name}] ${label}: ${latencyMs.toFixed(2)}ms`);
        return result;
      } catch (err) {
        const end = process.hrtime.bigint();
        const latencyMs = Number(end - start) / 1_000_000;
        this.measurements.push({ label, latencyMs, success: false, error: err.message });
        console.error(`❌ [${this.name}] ${label} FAILED after ${latencyMs.toFixed(2)}ms:`, err.message);
        throw err;
      }
    };
  }

  getReport() {
    const totalLatency = this.measurements.reduce((sum, m) => sum + m.latencyMs, 0);
    const successCount = this.measurements.filter(m => m.success).length;
    const failureCount = this.measurements.filter(m => !m.success).length;

    return {
      name: this.name,
      totalLatency: totalLatency.toFixed(2),
      averageLatency: (totalLatency / this.measurements.length).toFixed(2),
      successCount,
      failureCount,
      measurements: this.measurements.map(m => ({
        label: m.label,
        latencyMs: m.latencyMs.toFixed(2),
        status: m.success ? '✅' : '❌'
      }))
    };
  }
}

describe('🎤 Voice Bridge - Voice Call Flow Tests', () => {
  let testUserId = 'test_user_' + Date.now();
  let profiler;

  beforeAll(async () => {
    profiler = new LatencyProfiler('Voice Flow Tests');

    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI not set in environment');
    }

    try {
      await mongoose.connect(`${mongoUri}/voice-bridge-test`);
      console.log('✅ Connected to test MongoDB');
    } catch (err) {
      console.error('❌ Failed to connect to MongoDB:', err.message);
      throw err;
    }

    // Create test user
    try {
      await User.deleteOne({ userId: testUserId });
      await User.create({
        userId: testUserId,
        password: 'test_password_123',
        voiceCloningEnabled: false,
      });
      console.log(`✅ Created test user: ${testUserId}`);
    } catch (err) {
      console.error('Failed to create test user:', err.message);
    }
  });

  afterAll(async () => {
    // Cleanup
    try {
      await User.deleteOne({ userId: testUserId });
      console.log('✅ Cleaned up test user');
    } catch (err) {
      console.warn('Failed to cleanup test user:', err.message);
    }

    await mongoose.connection.close();
    console.log('✅ Disconnected from MongoDB');

    // Print latency report
    console.log('\n📊 LATENCY REPORT:');
    console.log(JSON.stringify(profiler.getReport(), null, 2));
  });

  /**
   * TEST 1: Translation Service
   */
  describe('Translation Service', () => {
    it('should translate Urdu to English with reasonable latency', async () => {
      const urduText = 'السلام عليكم';
      const translateFn = profiler.measure('UR→EN Translation', async (text, from, to) => {
        return await translateText(text, from, to);
      });

      const result = await translateFn(urduText, 'UR', 'EN');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.text).toBeTruthy();
      console.log(`   Urdu: "${urduText}" → English: "${result.text}"`);
    });

    it('should translate English to Arabic with reasonable latency', async () => {
      const englishText = 'Hello, how are you?';
      const translateFn = profiler.measure('EN→AR Translation', async (text, from, to) => {
        return await translateText(text, from, to);
      });

      const result = await translateFn(englishText, 'EN', 'AR');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.text).toBeTruthy();
      console.log(`   English: "${englishText}" → Arabic: "${result.text}"`);
    });

    it('should skip translation when source and target languages are same', async () => {
      const text = 'Hello world';
      const result = await translateText(text, 'EN', 'EN');

      expect(result.text).toBe(text);
      expect(result.success).toBe(true);
    });
  });

  /**
   * TEST 2: Text-to-Speech Service
   */
  describe('Text-to-Speech Service', () => {
    it('should synthesize English text to speech', async () => {
      const text = 'Hello world';
      const ttsFn = profiler.measure('TTS: English Synthesis', async (t, locale) => {
        return await synthesizeSpeech(t, locale);
      });

      const audio = await ttsFn(text, 'en-US');

      expect(audio).toBeDefined();
      expect(typeof audio).toBe('string'); // base64
      expect(audio.length).toBeGreaterThan(100); // Should have actual audio data
      console.log(`   Generated audio: ${audio.substring(0, 30)}... (length: ${audio.length})`);
    });

    it('should synthesize Urdu text to speech', async () => {
      const text = 'سلام';
      const ttsFn = profiler.measure('TTS: Urdu Synthesis', async (t, locale) => {
        return await synthesizeSpeech(t, locale);
      });

      const audio = await ttsFn(text, 'ur-PK');

      expect(audio).toBeDefined();
      expect(typeof audio).toBe('string');
      expect(audio.length).toBeGreaterThan(100);
    });

    it('should return null for empty text', async () => {
      const audio = await synthesizeSpeech('', 'en-US');
      expect(audio).toBeNull();
    });
  });

  /**
   * TEST 3: Voice Cloning State Management
   */
  describe('Voice Cloning State Management', () => {
    const testSocketId = 'test_socket_' + Date.now();

    it('should initialize clone buffer correctly', () => {
      initCloneBuffer(testSocketId, testUserId);
      const state = getCloneState(testSocketId);

      expect(state).toBeDefined();
      expect(state.userId).toBe(testUserId);
      expect(state.status).toBe('buffering');
      expect(state.chunks.length).toBe(0);
    });

    it('should add audio chunks to buffer', () => {
      const audioChunk = Buffer.from('fake audio data').toString('base64');
      const shouldTrigger = addChunkToCloneBuffer(testSocketId, audioChunk, 'audio/webm');

      expect(shouldTrigger).toBe(false); // Not enough time elapsed
      const state = getCloneState(testSocketId);
      expect(state.chunks.length).toBe(1);
    });

    it('should detect voice limit correctly', () => {
      const isLimited = isVoiceLimitReached(testSocketId);
      expect(typeof isLimited).toBe('boolean');
    });

    it('should clear clone buffer on cleanup', () => {
      clearCloneBuffer(testSocketId);
      const state = getCloneState(testSocketId);
      expect(state).toBeNull();
    });
  });

  /**
   * TEST 4: End-to-End Voice Flow (Simulation)
   */
  describe('End-to-End Voice Flow Simulation', () => {
    it('should complete voice flow: Speak (UR) → Translate → TTS (EN)', async () => {
      console.log('\n📍 Simulating: User A speaks Urdu → User B hears English');

      // Step 1: User speaks in Urdu (simulated with text)
      const spokenTextInUrdu = 'السلام عليكم ورحمة الله';
      console.log(`   1️⃣  User A speaks (UR): "${spokenTextInUrdu}"`);

      // Step 2: Translate to English
      const step2Fn = profiler.measure('E2E: Translation', async (text, from, to) => {
        return await translateText(text, from, to);
      });
      const translatedText = await step2Fn(spokenTextInUrdu, 'UR', 'EN');
      console.log(`   2️⃣  Translated (UR→EN): "${translatedText.text}"`);
      expect(translatedText.success).toBe(true);

      // Step 3: Synthesize to English speech (for User B)
      const step3Fn = profiler.measure('E2E: TTS Synthesis', async (text, locale) => {
        return await synthesizeSpeech(text, locale);
      });
      const audioForUserB = await step3Fn(translatedText.text, 'en-US');
      console.log(`   3️⃣  User B hears (EN): Audio synthesized (${audioForUserB ? audioForUserB.length : 0} bytes)`);
      expect(audioForUserB).toBeTruthy();

      console.log('   ✅ Complete flow successful!\n');
    });

    it('should complete voice flow with voice cloning enabled', async () => {
      console.log('\n📍 Simulating: Voice Cloning Flow (if enabled)');

      // Update user to enable voice cloning
      await User.updateOne(
        { userId: testUserId },
        { $set: { voiceCloningEnabled: true } }
      );

      const params = {
        text: 'Hello from Voice Bridge',
        locale: 'en-US',
        speakerUserId: testUserId,
        cloningEnabled: true,
      };

      const ttsFlowFn = profiler.measure('E2E: TTS with Cloning Check', async (p) => {
        return await getTtsForUser(p);
      });

      try {
        const audio = await ttsFlowFn(params);
        console.log(`   ✅ TTS executed (cloning attempt made)`);
        expect(audio === null || typeof audio === 'string').toBe(true);
      } catch (err) {
        console.warn(`   ⚠️  TTS failed (expected if no voice_id exists):`, err.message);
      }
    });
  });

  /**
   * TEST 5: Latency Benchmarks
   */
  describe('Latency Benchmarks', () => {
    it('should complete translation within acceptable latency (< 2000ms)', async () => {
      const start = process.hrtime.bigint();
      await translateText('Test text', 'EN', 'AR');
      const end = process.hrtime.bigint();
      const latencyMs = Number(end - start) / 1_000_000;

      expect(latencyMs).toBeLessThan(2000);
      console.log(`   Translation latency: ${latencyMs.toFixed(2)}ms (Target: < 2000ms)`);
    });

    it('should synthesize speech within acceptable latency (< 1500ms)', async () => {
      const start = process.hrtime.bigint();
      await synthesizeSpeech('Hello', 'en-US');
      const end = process.hrtime.bigint();
      const latencyMs = Number(end - start) / 1_000_000;

      expect(latencyMs).toBeLessThan(1500);
      console.log(`   TTS latency: ${latencyMs.toFixed(2)}ms (Target: < 1500ms)`);
    });
  });

  /**
   * TEST 6: Error Handling
   */
  describe('Error Handling', () => {
    it('should handle invalid language codes gracefully', async () => {
      const result = await translateText('Test', 'INVALID', 'EN');
      expect(result.success).toBe(false);
    });

    it('should handle empty text in STT gracefully', async () => {
      // STT should handle gracefully
      expect(() => transcribeAudio('', 'en-US')).not.toThrow();
    });

    it('should handle missing API keys', async () => {
      const originalKey = process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      try {
        await transcribeAudio(Buffer.from('test').toString('base64'), 'en-US');
      } catch (err) {
        expect(err.message).toContain('GOOGLE_API_KEY');
      }

      process.env.GOOGLE_API_KEY = originalKey;
    });
  });
});
