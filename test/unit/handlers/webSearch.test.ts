import { describe, test, expect, jest } from '@jest/globals';
import { handleWebSearch } from '../../../src/handlers/webSearch';
import { createChildLogger } from '../../../src/utils/logger';
import { GoogleClient } from '../../../src/core/search/googleClient';

jest.mock('../../../src/core/search/googleClient');

const MockedGoogleClient = GoogleClient as jest.MockedClass<typeof GoogleClient>;

describe('Web Search Handler', () => {
  const mockLogger = createChildLogger('test');

  test('should call GoogleClient and return formatted results for a single query', async () => {
    const mockSearchResult = { queries: [{ query: 'test', result: { success: true } }] };
    MockedGoogleClient.prototype.search.mockResolvedValue(mockSearchResult);

    const input = { query: 'test', resultsPerQuery: 7, minimal: false };
    const result = await handleWebSearch(input, mockLogger);

    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    expect(JSON.parse(result.content[0].text)).toEqual(mockSearchResult);
    expect(MockedGoogleClient.prototype.search).toHaveBeenCalledWith('test', {
      resultsPerQuery: 7,
    });
  });

  test('should handle an array of queries', async () => {
    const mockSearchResult = {
      queries: [
        { query: 'q1', result: {} },
        { query: 'q2', result: {} },
      ],
    };
    MockedGoogleClient.prototype.search.mockResolvedValue(mockSearchResult);

    const input = { query: ['q1', 'q2'], resultsPerQuery: 10, minimal: true };
    await handleWebSearch(input, mockLogger);

    expect(MockedGoogleClient.prototype.search).toHaveBeenCalledWith(['q1', 'q2'], {
      resultsPerQuery: 10,
    });
  });

  test('should reject invalid input', async () => {
    const invalidInput = { resultsPerQuery: 5 };
    await expect(handleWebSearch(invalidInput, mockLogger)).rejects.toThrow();
  });

  test('should propagate errors from the GoogleClient', async () => {
    MockedGoogleClient.prototype.search.mockRejectedValue(new Error('API Error'));

    const input = { query: 'failing query' };
    await expect(handleWebSearch(input, mockLogger)).rejects.toThrow('API Error');
  });
});
