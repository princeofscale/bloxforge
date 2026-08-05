/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'esnext',
        target: 'esnext',
        lib: ['esnext'],
        allowJs: true,
        esModuleInterop: true,
        moduleResolution: 'node'
      }
    }],
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/*.test.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // A ratchet, not a target. These are the numbers this suite actually reached
  // (61.58 / 51.33 / 54.46 / 63.25) with a small margin, so the gate says
  // "coverage may not fall", which is enforceable today, rather than picking an
  // aspirational percentage that would have to be disabled to merge anything.
  // Raise the floor when a change raises the measurement; never lower it to
  // make a red build green.
  coverageThreshold: {
    global: {
      statements: 61,
      branches: 51,
      functions: 54,
      lines: 62.8,
    },
  },
  testTimeout: 30000,
};
