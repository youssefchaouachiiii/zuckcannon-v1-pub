export default {
  testEnvironment: 'node',
  transform: {},
  setupFilesAfterEnv: ['./tests/setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/.worktrees/'],
};
