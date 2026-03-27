import { describe, it, expect } from 'vitest';
import { AppError, classifyError, ERROR_CODES } from '../../src/core/errors.js';

describe('AppError', () => {
  it('should create an error with code and message', () => {
    const err = new AppError('API_LIMIT', 'レート制限に達しました');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('API_LIMIT');
    expect(err.message).toBe('レート制限に達しました');
  });

  it('should preserve the cause chain', () => {
    const original = new Error('429 Too Many Requests');
    const err = new AppError('API_LIMIT', 'レート制限', original);
    expect(err.cause).toBe(original);
  });

  it('should have a name property of AppError', () => {
    const err = new AppError('NETWORK', 'ネットワークエラー');
    expect(err.name).toBe('AppError');
  });
});

describe('ERROR_CODES', () => {
  it('should define standard error codes', () => {
    expect(ERROR_CODES.API_LIMIT).toBe('API_LIMIT');
    expect(ERROR_CODES.NETWORK).toBe('NETWORK');
    expect(ERROR_CODES.AUTH).toBe('AUTH');
    expect(ERROR_CODES.FIRESTORE).toBe('FIRESTORE');
    expect(ERROR_CODES.VALIDATION).toBe('VALIDATION');
  });
});

describe('classifyError', () => {
  it('should classify 429 as API_LIMIT', () => {
    const err = new Error('Request failed');
    err.status = 429;
    const appErr = classifyError(err);
    expect(appErr).toBeInstanceOf(AppError);
    expect(appErr.code).toBe('API_LIMIT');
  });

  it('should classify 401/403 as AUTH', () => {
    const err401 = new Error('Unauthorized');
    err401.status = 401;
    expect(classifyError(err401).code).toBe('AUTH');

    const err403 = new Error('Forbidden');
    err403.status = 403;
    expect(classifyError(err403).code).toBe('AUTH');
  });

  it('should classify network errors as NETWORK', () => {
    const err = new TypeError('Failed to fetch');
    const appErr = classifyError(err);
    expect(appErr.code).toBe('NETWORK');
  });

  it('should classify Firestore permission errors as FIRESTORE', () => {
    const err = new Error('Missing or insufficient permissions');
    err.code = 'permission-denied';
    const appErr = classifyError(err);
    expect(appErr.code).toBe('FIRESTORE');
  });

  it('should default to UNKNOWN for unrecognized errors', () => {
    const err = new Error('Something weird happened');
    const appErr = classifyError(err);
    expect(appErr.code).toBe('UNKNOWN');
  });
});
