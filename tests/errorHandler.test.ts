import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { classifyError, withRetry, logError } from '../src/utils/errorHandler';

describe('errorHandler', () => {
  describe('classifyError', () => {
    it('classifies auth errors correctly', () => {
      expect(classifyError(new Error('JWT expired'))).toBe('auth');
      expect(classifyError({ message: 'User not authenticated' })).toBe('auth');
      expect(classifyError('Invalid token provided')).toBe('auth');
      expect(classifyError({ error: 'unauthorized_client' })).toBe('auth');
    });

    it('classifies network errors correctly', () => {
      expect(classifyError(new Error('Failed to fetch'))).toBe('network');
      expect(classifyError({ message: 'connect ECONNREFUSED 127.0.0.1:80' })).toBe('network');
      expect(classifyError('Network timeout')).toBe('network');
      expect(classifyError({ code: 'ENOTFOUND' })).toBe('network');
    });

    it('classifies unknown errors correctly', () => {
      expect(classifyError(new Error('Cannot read properties of undefined'))).toBe('unknown');
      expect(classifyError({ message: 'SyntaxError: Unexpected token' })).toBe('unknown');
      expect(classifyError('Something went wrong')).toBe('unknown');
      expect(classifyError(null)).toBe('unknown');
      expect(classifyError(123)).toBe('unknown');
    });
  });

  describe('withRetry', () => {
    // Suppress console.error during tests to keep output clean
    const originalConsoleError = console.error;
    
    // We only need to provide before/after hooks to handle console error 
    // inside the tests, since it is a global state.
    beforeAll(() => {
      console.error = vi.fn();
    });
    
    afterAll(() => {
      console.error = originalConsoleError;
    });

    // We can also spy on console.error directly inside specific tests
    // if we don't want to supress it globally.

    it('returns successfully on first attempt if no error', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      const result = await withRetry(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('retries on network error and eventually succeeds', async () => {
      // Create a mock that fails twice then succeeds
      let attempts = 0;
      const mockFn = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Failed to fetch'); // Network error
        }
        return 'success on try 3';
      });

      // Temporarily mock console.error
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Use a very short delay for testing
      const result = await withRetry(mockFn, {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 5,
        context: 'test-retry'
      });
      
      expect(result).toBe('success on try 3');
      expect(mockFn).toHaveBeenCalledTimes(3);
      
      consoleErrorSpy.mockRestore();
    });

    it('gives up after max attempts for network errors', async () => {
      const networkError = new Error('ECONNREFUSED');
      const mockFn = vi.fn().mockRejectedValue(networkError);
      
      // Temporarily mock console.error
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(withRetry(mockFn, {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 5
      })).rejects.toThrow('ECONNREFUSED');
      
      expect(mockFn).toHaveBeenCalledTimes(2);

      consoleErrorSpy.mockRestore();
    });

    it('does not retry for auth errors by default', async () => {
      const authError = new Error('User not authenticated');
      const mockFn = vi.fn().mockRejectedValue(authError);
      
      // Temporarily mock console.error
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(withRetry(mockFn, {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 5
      })).rejects.toThrow('User not authenticated');
      
      // Should fail immediately on the first attempt without retrying
      expect(mockFn).toHaveBeenCalledTimes(1);

      consoleErrorSpy.mockRestore();
    });

    it('retries on specific error categories if retryOn is overridden', async () => {
      const customError = new Error('Something went wrong'); // unknown error By default
      
      let attempts = 0;
      const mockFn = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw customError; 
        }
        return 'success';
      });
      
      // Temporarily mock console.error
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Override retryOn to include 'unknown'
      const result = await withRetry(mockFn, {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 5,
        retryOn: ['unknown']
      });

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);

      consoleErrorSpy.mockRestore();
    });
  });
});
