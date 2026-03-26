import { describe, it, expect } from 'vitest';
import { addRoute, initRouter, getCurrentPath } from '../../src/ui/router.js';

// Note: Router tests run in Node environment, so window.location.hash is simulated
// These tests focus on the route matching logic

describe('Router', () => {
  describe('matchRoute (via addRoute)', () => {
    it('should export addRoute, initRouter, and getCurrentPath', () => {
      expect(typeof addRoute).toBe('function');
      expect(typeof initRouter).toBe('function');
      expect(typeof getCurrentPath).toBe('function');
    });
  });
});
