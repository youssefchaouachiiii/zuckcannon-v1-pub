// tests/setup.js
// Silence console.log in tests
import { jest } from '@jest/globals';

global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
};
