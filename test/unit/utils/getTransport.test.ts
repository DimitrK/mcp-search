import { describe, test, expect } from '@jest/globals';
import { getTransport } from '../../../src/utils/getTransport';

describe('getTransport Mock', () => {
  test('should always return null when mocked', () => {
    const result = getTransport();
    expect(result).toBeNull();
  });
});
