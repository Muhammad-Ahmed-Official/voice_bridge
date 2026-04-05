/**
 * Latency Profiler - Measure and track latency across voice pipeline
 * Used for optimization and monitoring
 */

export class LatencyProfiler {
  constructor(sessionId = null) {
    this.sessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.marks = new Map();
    this.measurements = [];
    this.startTime = Date.now();
  }

  /**
   * Mark a point in time
   * @param {string} markName - e.g., 'stt_start', 'translation_end'
   */
  mark(markName) {
    const now = process.hrtime.bigint();
    this.marks.set(markName, now);
    console.log(`[⏱️ ${this.sessionId}] Mark: ${markName}`);
  }

  /**
   * Measure time between two marks
   * @param {string} startMark - Start mark name
   * @param {string} endMark - End mark name
   * @returns {number} Latency in milliseconds
   */
  measure(startMark, endMark) {
    const start = this.marks.get(startMark);
    const end = this.marks.get(endMark);

    if (!start || !end) {
      console.warn(`[⚠️ ${this.sessionId}] Missing mark: ${!start ? startMark : endMark}`);
      return null;
    }

    const latencyMs = Number(end - start) / 1_000_000;
    const measurement = {
      startMark,
      endMark,
      latencyMs,
      timestamp: new Date().toISOString(),
    };

    this.measurements.push(measurement);
    return latencyMs;
  }

  /**
   * Log an operation with latency
   * @param {string} operationName - Name of the operation
   * @param {number} latencyMs - Latency in milliseconds
   * @param {Object} metadata - Additional metadata
   */
  logOperation(operationName, latencyMs, metadata = {}) {
    const measurement = {
      operation: operationName,
      latencyMs,
      metadata,
      timestamp: new Date().toISOString(),
    };

    this.measurements.push(measurement);

    // Log with color coding based on latency threshold
    let status = '✅';
    if (latencyMs > 1500) status = '⚠️ ';
    if (latencyMs > 3000) status = '🔴';

    console.log(`${status} [${this.sessionId}] ${operationName}: ${latencyMs.toFixed(2)}ms`);
  }

  /**
   * Get latency report
   */
  getReport() {
    const totalLatency = this.measurements.reduce((sum, m) => sum + (m.latencyMs || 0), 0);
    const avgLatency = totalLatency / this.measurements.length || 0;

    const report = {
      sessionId: this.sessionId,
      totalLatencyMs: totalLatency.toFixed(2),
      averageLatencyMs: avgLatency.toFixed(2),
      measurementCount: this.measurements.length,
      measurements: this.measurements.map(m => ({
        ...m,
        latencyMs: m.latencyMs?.toFixed(2) || m.latencyMs,
      })),
      timeline: {
        startTime: new Date(this.startTime).toISOString(),
        totalDurationMs: (Date.now() - this.startTime).toFixed(2),
      }
    };

    return report;
  }

  /**
   * Print formatted report
   */
  printReport() {
    const report = this.getReport();
    console.log('\n' + '='.repeat(60));
    console.log('📊 LATENCY PROFILE REPORT');
    console.log('='.repeat(60));
    console.log(JSON.stringify(report, null, 2));
    console.log('='.repeat(60) + '\n');

    return report;
  }

  /**
   * Async wrapper to measure function execution
   * @param {string} label - Operation label
   * @param {Function} asyncFn - Function to measure
   * @returns {Promise} Result of asyncFn
   */
  async measureAsync(label, asyncFn) {
    const start = process.hrtime.bigint();
    try {
      const result = await asyncFn();
      const end = process.hrtime.bigint();
      const latencyMs = Number(end - start) / 1_000_000;
      this.logOperation(label, latencyMs, { success: true });
      return result;
    } catch (err) {
      const end = process.hrtime.bigint();
      const latencyMs = Number(end - start) / 1_000_000;
      this.logOperation(label, latencyMs, { success: false, error: err.message });
      throw err;
    }
  }

  /**
   * Sync wrapper to measure function execution
   * @param {string} label - Operation label
   * @param {Function} fn - Function to measure
   * @returns {*} Result of fn
   */
  measureSync(label, fn) {
    const start = process.hrtime.bigint();
    try {
      const result = fn();
      const end = process.hrtime.bigint();
      const latencyMs = Number(end - start) / 1_000_000;
      this.logOperation(label, latencyMs, { success: true });
      return result;
    } catch (err) {
      const end = process.hrtime.bigint();
      const latencyMs = Number(end - start) / 1_000_000;
      this.logOperation(label, latencyMs, { success: false, error: err.message });
      throw err;
    }
  }
}

/**
 * Performance Thresholds for Voice Pipeline
 */
export const PERFORMANCE_THRESHOLDS = {
  STT: {
    IDEAL: 500,      // STT should complete < 500ms
    ACCEPTABLE: 1000, // Acceptable < 1s
    WARNING: 2000,    // Warn if > 2s
  },
  TRANSLATION: {
    IDEAL: 300,
    ACCEPTABLE: 500,
    WARNING: 1000,
  },
  TTS: {
    IDEAL: 800,
    ACCEPTABLE: 1500,
    WARNING: 3000,
  },
  TOTAL_PIPELINE: {
    IDEAL: 1500,      // Complete flow < 1.5s
    ACCEPTABLE: 3000, // Acceptable < 3s
    WARNING: 5000,    // Warn if > 5s
  }
};

/**
 * Check if latency is within acceptable range
 * @param {string} operationType - 'STT', 'TRANSLATION', 'TTS', 'TOTAL_PIPELINE'
 * @param {number} latencyMs - Measured latency
 * @returns {Object} Status object with assessment
 */
export function assessLatency(operationType, latencyMs) {
  const threshold = PERFORMANCE_THRESHOLDS[operationType];
  if (!threshold) {
    throw new Error(`Unknown operation type: ${operationType}`);
  }

  let status = 'EXCELLENT';
  let emoji = '✅';

  if (latencyMs > threshold.WARNING) {
    status = 'CRITICAL';
    emoji = '🔴';
  } else if (latencyMs > threshold.ACCEPTABLE) {
    status = 'DEGRADED';
    emoji = '⚠️ ';
  } else if (latencyMs > threshold.IDEAL) {
    status = 'GOOD';
    emoji = '🟡';
  }

  return {
    status,
    emoji,
    latencyMs: latencyMs.toFixed(2),
    ideal: threshold.IDEAL,
    acceptable: threshold.ACCEPTABLE,
    warning: threshold.WARNING,
    assessment: `${emoji} ${operationType} latency: ${latencyMs.toFixed(2)}ms (${status})`
  };
}

export default LatencyProfiler;
