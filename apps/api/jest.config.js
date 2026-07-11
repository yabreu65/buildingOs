module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
        types: ['jest', 'node'],
      },
    }],
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.module.ts',
    '!**/*.spec.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.js'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
    '^@buildingos/contracts$': '<rootDir>/../../../packages/contracts/src/index.ts',
    '^@buildingos/permissions$': '<rootDir>/../../../packages/permissions/src/index.ts',
  },
  testTimeout: 10000,
};
