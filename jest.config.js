module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'config/**/*.js',
    'middleware/**/*.js',
    'services/**/*.js',
    'utils/**/*.js',
    'routes/**/*.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  setupFiles: ['<rootDir>/__tests__/setup.js'],
  testTimeout: 15000,
};
