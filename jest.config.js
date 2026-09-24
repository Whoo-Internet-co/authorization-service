/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
  coverageThreshold: {
    global: {
      lines: 80,
      statements: 80,
      branches: 80,
      functions: 80,
    },
  },
  coverageReporters: ['text', 'json-summary', 'html'],
  maxWorkers: '50%',
  testTimeout: 60_000,
};

module.exports = config;
