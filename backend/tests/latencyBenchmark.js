/**
 * Latency Benchmark Test
 * Run directly: node tests/latencyBenchmark.js
 * Tests Translation & TTS latency without Jest dependency
 */

import dotenv from 'dotenv';
import { translateText } from '../src/services/translate.js';
import { synthesizeSpeech } from '../src/services/tts.js';
import { LatencyProfiler, assessLatency } from '../src/utils/latencyProfiler.js';

dotenv.config({ path: './.env' });

const profiler = new LatencyProfiler('Latency Benchmark');
const results = [];

async function runBenchmarks() {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 VOICE BRIDGE - LATENCY BENCHMARK TEST');
  console.log('='.repeat(70) + '\n');

  // ============ TEST 1: Translation Latency ============
  console.log('📍 TEST 1: Translation Service Latency');
  console.log('-'.repeat(70));

  try {
    // Test 1.1: Urdu → English
    console.log('\n1️⃣  Testing: Urdu → English Translation');
    const ur_to_en = await profiler.measureAsync(
      'Translation: UR→EN',
      async () => {
        return await translateText(
          'السلام عليكم ورحمة الله وبركاته',
          'UR',
          'EN'
        );
      }
    );
    console.log(`   Result: "${ur_to_en.text}"`);

    // Test 1.2: English → Arabic
    console.log('\n2️⃣  Testing: English → Arabic Translation');
    const en_to_ar = await profiler.measureAsync(
      'Translation: EN→AR',
      async () => {
        return await translateText(
          'Hello, how are you today?',
          'EN',
          'AR'
        );
      }
    );
    console.log(`   Result: "${en_to_ar.text}"`);

    // Test 1.3: Arabic → Urdu
    console.log('\n3️⃣  Testing: Arabic → Urdu Translation');
    const ar_to_ur = await profiler.measureAsync(
      'Translation: AR→UR',
      async () => {
        return await translateText(
          'مرحبا بك',
          'AR',
          'UR'
        );
      }
    );
    console.log(`   Result: "${ar_to_ur.text}"`);

  } catch (err) {
    console.error('❌ Translation test failed:', err.message);
  }

  // ============ TEST 2: Text-to-Speech Latency ============
  console.log('\n\n📍 TEST 2: Text-to-Speech (TTS) Service Latency');
  console.log('-'.repeat(70));

  try {
    // Test 2.1: English TTS
    console.log('\n1️⃣  Testing: English TTS Synthesis');
    const en_tts = await profiler.measureAsync(
      'TTS: English Synthesis',
      async () => {
        return await synthesizeSpeech('Hello world, this is a test message', 'en-US');
      }
    );
    console.log(`   ✅ Generated audio (${en_tts.substring(0, 30)}...)`);

    // Test 2.2: Urdu TTS
    console.log('\n2️⃣  Testing: Urdu TTS Synthesis');
    const ur_tts = await profiler.measureAsync(
      'TTS: Urdu Synthesis',
      async () => {
        return await synthesizeSpeech('سلام علیکم', 'ur-PK');
      }
    );
    console.log(`   ✅ Generated audio (${ur_tts.substring(0, 30)}...)`);

    // Test 2.3: Arabic TTS
    console.log('\n3️⃣  Testing: Arabic TTS Synthesis');
    const ar_tts = await profiler.measureAsync(
      'TTS: Arabic Synthesis',
      async () => {
        return await synthesizeSpeech('مرحبا', 'ar-SA');
      }
    );
    console.log(`   ✅ Generated audio (${ar_tts.substring(0, 30)}...)`);

  } catch (err) {
    console.error('❌ TTS test failed:', err.message);
  }

  // ============ TEST 3: End-to-End Pipeline ============
  console.log('\n\n📍 TEST 3: End-to-End Voice Pipeline');
  console.log('-'.repeat(70));

  try {
    console.log('\n🔄 Running: Translate (EN→UR) → TTS (Urdu)');

    const e2ePipeline = new LatencyProfiler('E2E Pipeline');
    const pipelineStart = process.hrtime.bigint();

    // Translate
    e2ePipeline.mark('step1_start');
    const translated = await translateText(
      'Good morning, how are you?',
      'EN',
      'UR'
    );
    e2ePipeline.mark('step1_end');
    const step1Latency = e2ePipeline.measure('step1_start', 'step1_end');
    console.log(`   ✅ Step 1 - Translation (${step1Latency.toFixed(2)}ms): "${translated.text}"`);

    // TTS
    e2ePipeline.mark('step2_start');
    const audio = await synthesizeSpeech(translated.text, 'ur-PK');
    e2ePipeline.mark('step2_end');
    const step2Latency = e2ePipeline.measure('step2_start', 'step2_end');
    console.log(`   ✅ Step 2 - TTS (${step2Latency.toFixed(2)}ms): ${audio.substring(0, 30)}...`);

    const pipelineEnd = process.hrtime.bigint();
    const totalPipelineLatency = Number(pipelineEnd - pipelineStart) / 1_000_000;

    console.log(`\n   📊 Total Pipeline Latency: ${totalPipelineLatency.toFixed(2)}ms`);
    const assessment = assessLatency('TOTAL_PIPELINE', totalPipelineLatency);
    console.log(`   ${assessment.assessment}`);

  } catch (err) {
    console.error('❌ E2E pipeline test failed:', err.message);
  }

  // ============ RESULTS SUMMARY ============
  console.log('\n\n' + '='.repeat(70));
  console.log('📊 LATENCY BENCHMARK RESULTS');
  console.log('='.repeat(70) + '\n');

  const report = profiler.getReport();

  console.log('⏱️  Measurements:');
  report.measurements.forEach((m, idx) => {
    console.log(`   ${idx + 1}. ${m.operation}: ${m.latencyMs}ms`);
  });

  console.log(`\n📈 Summary:`);
  console.log(`   Total Latency: ${report.totalLatencyMs}ms`);
  console.log(`   Average Latency: ${report.averageLatencyMs}ms`);
  console.log(`   Count: ${report.measurementCount} operations`);

  // ============ PERFORMANCE ASSESSMENT ============
  console.log('\n🎯 Performance Assessment:');
  console.log('-'.repeat(70));

  report.measurements.forEach(m => {
    if (m.operation.includes('Translation')) {
      const assessment = assessLatency('TRANSLATION', parseFloat(m.latencyMs));
      console.log(`${assessment.assessment}`);
    } else if (m.operation.includes('TTS')) {
      const assessment = assessLatency('TTS', parseFloat(m.latencyMs));
      console.log(`${assessment.assessment}`);
    }
  });

  // ============ RECOMMENDATIONS ============
  console.log('\n💡 Optimization Recommendations:');
  console.log('-'.repeat(70));

  const avgTranslation = report.measurements
    .filter(m => m.operation.includes('Translation'))
    .reduce((sum, m) => sum + parseFloat(m.latencyMs), 0) / report.measurements.filter(m => m.operation.includes('Translation')).length;

  const avgTts = report.measurements
    .filter(m => m.operation.includes('TTS'))
    .reduce((sum, m) => sum + parseFloat(m.latencyMs), 0) / report.measurements.filter(m => m.operation.includes('TTS')).length;

  if (avgTranslation > 500) {
    console.log('   🔴 Translation slow. Consider:');
    console.log('      - Implement caching for common phrases');
    console.log('      - Use batch translation API');
    console.log('      - Check network latency to Google API');
  }

  if (avgTts > 1000) {
    console.log('   🔴 TTS slow. Consider:');
    console.log('      - Cache synthesized audio for common texts');
    console.log('      - Use streaming TTS instead of full synthesis');
    console.log('      - Check server resources');
  }

  if (avgTranslation < 500 && avgTts < 1000) {
    console.log('   ✅ Latency is good! Ready for voice cloning.');
    console.log('      - Next: Implement voice cloning for enhanced experience');
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ Benchmark Complete!');
  console.log('='.repeat(70) + '\n');
}

// Run benchmarks
runBenchmarks().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
