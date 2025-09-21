import { describe, test, expect } from '@jest/globals';
import { handleDebugEcho } from '../../../src/handlers/debugEcho';
import { createChildLogger } from '../../../src/utils/logger';

describe('Debug Echo Handler', () => {
  const mockLogger = createChildLogger('test');

  test('should echo message with metadata', async () => {
    const input = {
      message: 'Hello, world!',
      metadata: { test: 'value' },
    };

    const result = await handleDebugEcho(input, mockLogger);
    const parsedContent = JSON.parse(result.content[0].text);

    expect(parsedContent.echo).toBe('Hello, world!');
    expect(parsedContent.metadata?.test).toBe('value');
    expect(parsedContent.metadata?.server).toBe('mcp-search');
    expect(parsedContent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  test('should handle message without metadata', async () => {
    const input = {
      message: 'Simple message',
    };

    const result = await handleDebugEcho(input, mockLogger);
    const parsedContent = JSON.parse(result.content[0].text);

    expect(parsedContent.echo).toBe('Simple message');
    expect(parsedContent.metadata?.server).toBe('mcp-search');
  });

  test('should reject empty message', async () => {
    const input = {
      message: '',
    };

    await expect(handleDebugEcho(input, mockLogger)).rejects.toThrow('Message is required');
  });

  test('should reject invalid input', async () => {
    const invalidInput = {
      // missing message field
    };

    await expect(handleDebugEcho(invalidInput, mockLogger)).rejects.toThrow(); // Should fail validation
  });

  test('should include correlationId from logger', async () => {
    const input = { message: 'test' };

    const result = await handleDebugEcho(input, mockLogger);
    const parsedContent = JSON.parse(result.content[0].text);

    expect(parsedContent.metadata?.correlationId).toBeDefined();
  });
});
