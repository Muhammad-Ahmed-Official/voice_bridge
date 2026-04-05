/**
 * Jest Configuration for Voice Bridge Tests
 */

export default {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/socket/**',
    '!src/index.js',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
  ],
  testTimeout: 30000, // 30 seconds for API calls
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
};
