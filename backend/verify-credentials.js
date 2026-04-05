#!/usr/bin/env node

/**
 * Verification Script - Check Google Cloud Credentials
 * Run: node verify-credentials.js
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: './.env' });

console.log('\n' + '='.repeat(70));
console.log('🔍 GOOGLE CLOUD CREDENTIALS VERIFICATION');
console.log('='.repeat(70) + '\n');

// ============ Check .env File ============
console.log('📋 .env File Configuration:');
console.log('-'.repeat(70));

const requiredVars = [
  'GOOGLE_PROJECT_ID',
  'GOOGLE_PROJECT_NUMBER',
  'GOOGLE_API_KEY_STT',
  'GOOGLE_API_KEY_TRANSLATION',
  'GOOGLE_API_KEY_TTS',
  'GOOGLE_API_KEY',
];

const foundVars = {};
let allPresent = true;

requiredVars.forEach(varName => {
  const value = process.env[varName];
  const status = value ? '✅' : '❌';

  if (!value) allPresent = false;

  if (value) {
    // Mask the full key, show only first and last 4 chars
    const masked = value.substring(0, 10) + '...' + value.substring(value.length - 4);
    foundVars[varName] = value;
    console.log(`${status} ${varName.padEnd(25)} = ${masked}`);
  } else {
    console.log(`${status} ${varName.padEnd(25)} = NOT SET ⚠️`);
  }
});

console.log('\n');

// ============ Check Service Account File ============
console.log('📁 Service Account File:');
console.log('-'.repeat(70));

const serviceAccountPath = path.resolve(process.env.GOOGLE_CREDENTIALS_JSON || './service-account.json');
const serviceAccountExists = fs.existsSync(serviceAccountPath);

if (serviceAccountExists) {
  console.log(`✅ Found: ${serviceAccountPath}`);
} else {
  console.log(`❌ Not found: ${serviceAccountPath}`);
}

console.log('\n');

// ============ API Usage Mapping ============
console.log('🔌 API Key Usage Mapping:');
console.log('-'.repeat(70));

const apiMapping = {
  'Speech-to-Text (STT)': {
    env: 'GOOGLE_API_KEY_STT',
    fallback: 'GOOGLE_API_KEY',
    key: foundVars['GOOGLE_API_KEY_STT'] || foundVars['GOOGLE_API_KEY'],
    file: 'src/services/stt.js',
  },
  'Cloud Translation': {
    env: 'GOOGLE_API_KEY_TRANSLATION',
    fallback: 'GOOGLE_API_KEY',
    key: foundVars['GOOGLE_API_KEY_TRANSLATION'] || foundVars['GOOGLE_API_KEY'],
    file: 'src/services/translate.js',
  },
  'Text-to-Speech (TTS)': {
    env: 'GOOGLE_API_KEY_TTS',
    fallback: 'google-tts-api library',
    key: foundVars['GOOGLE_API_KEY_TTS'],
    file: 'src/services/tts.js',
  },
};

Object.entries(apiMapping).forEach(([service, details]) => {
  const status = details.key ? '✅' : '⚠️';
  console.log(`${status} ${service}`);
  console.log(`   Primary: ${details.env}`);
  console.log(`   Fallback: ${details.fallback}`);
  console.log(`   File: ${details.file}`);
  if (details.key) {
    const masked = details.key.substring(0, 8) + '...' + details.key.substring(details.key.length - 4);
    console.log(`   Key: ${masked}`);
  }
  console.log('');
});

// ============ Project Information ============
console.log('🏢 Project Information:');
console.log('-'.repeat(70));

console.log(`Project ID: ${process.env.GOOGLE_PROJECT_ID || 'NOT SET'}`);
console.log(`Project Number: ${process.env.GOOGLE_PROJECT_NUMBER || 'NOT SET'}`);
console.log('\n');

// ============ Summary ============
console.log('📊 Configuration Summary:');
console.log('-'.repeat(70));

const hasSTT = !!foundVars['GOOGLE_API_KEY_STT'];
const hasTranslation = !!foundVars['GOOGLE_API_KEY_TRANSLATION'];
const hasTTS = !!foundVars['GOOGLE_API_KEY_TTS'];
const hasProjectID = !!process.env.GOOGLE_PROJECT_ID;

console.log(`✅ STT API Key:           ${hasSTT ? 'CONFIGURED' : 'MISSING'}`);
console.log(`✅ Translation API Key:   ${hasTranslation ? 'CONFIGURED' : 'MISSING'}`);
console.log(`✅ TTS API Key:           ${hasTTS ? 'CONFIGURED' : 'MISSING (OK - uses library)'}`);
console.log(`✅ Project ID:            ${hasProjectID ? 'CONFIGURED' : 'MISSING'}`);
console.log('\n');

// ============ Status ============
console.log('🎯 Overall Status:');
console.log('-'.repeat(70));

if (hasSTT && hasTranslation && hasProjectID) {
  console.log('✅ ALL CRITICAL CREDENTIALS CONFIGURED!');
  console.log('🚀 Ready to run tests!\n');
  console.log('Next steps:');
  console.log('  1. npm install');
  console.log('  2. node tests/latencyBenchmark.js');
  console.log('  3. node tests/integrationTest.js\n');
} else {
  console.log('❌ MISSING CRITICAL CREDENTIALS!');
  console.log('\nMissing:');
  if (!hasSTT) console.log('  - GOOGLE_API_KEY_STT');
  if (!hasTranslation) console.log('  - GOOGLE_API_KEY_TRANSLATION');
  if (!hasProjectID) console.log('  - GOOGLE_PROJECT_ID');
  console.log('\nFix .env file and try again.\n');
}

console.log('='.repeat(70));
console.log('✅ Verification Complete\n');
