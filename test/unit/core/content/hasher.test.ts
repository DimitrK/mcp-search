import { describe, test, expect } from '@jest/globals';
import { sha256Hex, stableChunkId } from '../../../../src/core/content/hasher';

describe('hasher', () => {
  test('sha256Hex returns stable lowercase hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  test('stableChunkId combines url, path, text deterministically', () => {
    const id1 = stableChunkId('https://example.com', ['h1', 'p[0]'], 'Hello');
    const id2 = stableChunkId('https://example.com', ['h1', 'p[0]'], 'Hello');
    const id3 = stableChunkId('https://example.com', ['h1', 'p[1]'], 'Hello');
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
  });
});
