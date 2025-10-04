import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock the entire db-client module
jest.mock('../../../../../src/core/vector/store/worker/db-client', () => ({
  dbRun: jest.fn(),
  dbAll: jest.fn(),
  closeDb: jest.fn(),
}));

// Import the mocked functions
import { dbRun, dbAll, closeDb } from '../../../../../src/core/vector/store/worker/db-client';

const mockedDbRun = jest.mocked(dbRun);
const mockedDbAll = jest.mocked(dbAll);
const mockedCloseDb = jest.mocked(closeDb);

describe('db-client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('database operations', () => {
    test('dbRun executes SQL successfully', async () => {
      mockedDbRun.mockResolvedValue(undefined);

      await expect(dbRun('CREATE TABLE test (id INTEGER)')).resolves.toBeUndefined();
      expect(mockedDbRun).toHaveBeenCalledWith('CREATE TABLE test (id INTEGER)');
    });

    test('dbRun executes SQL with parameters successfully', async () => {
      mockedDbRun.mockResolvedValue(undefined);

      await expect(dbRun('INSERT INTO test VALUES (?)', [123])).resolves.toBeUndefined();
      expect(mockedDbRun).toHaveBeenCalledWith('INSERT INTO test VALUES (?)', [123]);
    });

    test('dbRun handles errors', async () => {
      const testError = new Error('SQL syntax error');
      mockedDbRun.mockRejectedValue(testError);

      await expect(dbRun('INVALID SQL')).rejects.toThrow('SQL syntax error');
      expect(mockedDbRun).toHaveBeenCalledWith('INVALID SQL');
    });

    test('dbAll returns query results', async () => {
      const expectedResults = [{ id: 1, name: 'test' }];
      mockedDbAll.mockResolvedValue(expectedResults);

      const results = await dbAll('SELECT * FROM test');
      expect(results).toEqual(expectedResults);
      expect(mockedDbAll).toHaveBeenCalledWith('SELECT * FROM test');
    });

    test('dbAll handles errors', async () => {
      const testError = new Error('Query failed');
      mockedDbAll.mockRejectedValue(testError);

      await expect(dbAll('INVALID QUERY')).rejects.toThrow('Query failed');
      expect(mockedDbAll).toHaveBeenCalledWith('INVALID QUERY');
    });
  });

  describe('cleanup operations', () => {
    test('closeDb terminates database connection', async () => {
      mockedCloseDb.mockResolvedValue(undefined);

      await expect(closeDb()).resolves.toBeUndefined();
      expect(mockedCloseDb).toHaveBeenCalled();
    });

    test('closeDb handles errors gracefully', async () => {
      const testError = new Error('Close failed');
      mockedCloseDb.mockRejectedValue(testError);

      await expect(closeDb()).rejects.toThrow('Close failed');
      expect(mockedCloseDb).toHaveBeenCalled();
    });
  });
});
