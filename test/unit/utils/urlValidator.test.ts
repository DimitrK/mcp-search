import { describe, test, expect } from '@jest/globals';
import { isHttpUrl, normalizeUrl } from '../../../src/utils/urlValidator';

describe('urlValidator', () => {
  test('isHttpUrl accepts http and https only', () => {
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('not-a-url')).toBe(false);
  });

  test('normalizeUrl lowercases host, strips default port, sorts params, removes hash and tracking', () => {
    const input = 'HTTPS://Example.COM:443/a//b/?utm_source=x&b=2&a=1#frag';
    const out = normalizeUrl(input);
    expect(out).toBe('https://example.com/a/b?a=1&b=2');
  });

  test('normalizeUrl preserves non-default ports and path root', () => {
    const out = normalizeUrl('http://example.com:8080');
    expect(out).toBe('http://example.com:8080/');
  });
});
