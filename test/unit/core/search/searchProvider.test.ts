import { describe, expect, test } from '@jest/globals';
import {
  boundedResultsPerQuery,
  displayLinkFromUrl,
} from '../../../../src/core/search/searchProvider';

describe('searchProvider helpers', () => {
  test('displayLinkFromUrl returns the hostname for valid URLs', () => {
    expect(displayLinkFromUrl('https://docs.example.com/path')).toBe('docs.example.com');
  });

  test('displayLinkFromUrl returns an empty string for malformed URLs', () => {
    expect(displayLinkFromUrl('not a url')).toBe('');
  });

  test('boundedResultsPerQuery clamps requested result counts', () => {
    expect(boundedResultsPerQuery(undefined, 20)).toBe(5);
    expect(boundedResultsPerQuery(0, 20)).toBe(1);
    expect(boundedResultsPerQuery(50, 20)).toBe(20);
    expect(boundedResultsPerQuery(7, 20)).toBe(7);
  });
});
