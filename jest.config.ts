import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  // Map bare module imports to src
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Silence console.log/warn from the engine during tests
  silent: false,
  verbose: true,
  testTimeout: 15_000,
  collectCoverage: false,
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: { branches: 70, functions: 80, lines: 80, statements: 80 },
  },
};

export default config;
