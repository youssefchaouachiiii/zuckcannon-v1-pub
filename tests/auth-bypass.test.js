// tests/auth-bypass.test.js
// Security property: the auth guards bypass ONLY on the explicit
// ALLOW_AUTH_BYPASS=true flag — never implicitly on NODE_ENV=development.
// A single env typo / `npm run dev` in prod must NOT disable authentication.
import { jest } from '@jest/globals';
import {
  ensureAuthenticated,
  ensureAuthenticatedAPI,
  ensureNotAuthenticated,
} from '../backend/auth/passport-config.js';

const ENV_KEYS = ['ALLOW_AUTH_BYPASS', 'NODE_ENV'];
let saved;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.ALLOW_AUTH_BYPASS;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function mkRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.redirect = jest.fn(() => res);
  return res;
}
const authedReq = { isAuthenticated: () => true, path: '/x' };
const anonReq = { isAuthenticated: () => false, path: '/x' };

describe('ensureAuthenticatedAPI', () => {
  test('401 when unauthenticated and no bypass flag', () => {
    const res = mkRes();
    const next = jest.fn();
    ensureAuthenticatedAPI(anonReq, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('next() when authenticated', () => {
    const res = mkRes();
    const next = jest.fn();
    ensureAuthenticatedAPI(authedReq, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('bypass when ALLOW_AUTH_BYPASS=true (unauthenticated still passes)', () => {
    process.env.ALLOW_AUTH_BYPASS = 'true';
    const res = mkRes();
    const next = jest.fn();
    ensureAuthenticatedAPI(anonReq, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('NODE_ENV=development does NOT bypass (regression: 401 still returned)', () => {
    process.env.NODE_ENV = 'development';
    const res = mkRes();
    const next = jest.fn();
    ensureAuthenticatedAPI(anonReq, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('ALLOW_AUTH_BYPASS values other than "true" do not bypass', () => {
    process.env.ALLOW_AUTH_BYPASS = '1';
    const res = mkRes();
    const next = jest.fn();
    ensureAuthenticatedAPI(anonReq, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('ensureAuthenticated (redirect)', () => {
  test('redirect to /login.html when unauthenticated and no bypass', () => {
    const res = mkRes();
    const next = jest.fn();
    ensureAuthenticated(anonReq, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/login.html');
  });

  test('NODE_ENV=development does NOT bypass (regression)', () => {
    process.env.NODE_ENV = 'development';
    const res = mkRes();
    const next = jest.fn();
    ensureAuthenticated(anonReq, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/login.html');
  });

  test('bypass when ALLOW_AUTH_BYPASS=true', () => {
    process.env.ALLOW_AUTH_BYPASS = 'true';
    const res = mkRes();
    const next = jest.fn();
    ensureAuthenticated(anonReq, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('ensureNotAuthenticated', () => {
  test('redirect "/" when already authenticated and no bypass', () => {
    const res = mkRes();
    const next = jest.fn();
    ensureNotAuthenticated(authedReq, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  test('NODE_ENV=development does NOT bypass (regression: still redirects authed user)', () => {
    process.env.NODE_ENV = 'development';
    const res = mkRes();
    const next = jest.fn();
    ensureNotAuthenticated(authedReq, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/');
  });
});
