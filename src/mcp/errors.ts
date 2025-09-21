import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export class TimeoutError extends McpError {
  constructor(message: string, timeoutMs: number) {
    super(ErrorCode.InternalError, `${message} (timeout: ${timeoutMs}ms)`);
  }
}

export class NetworkError extends McpError {
  constructor(message: string, statusCode?: number) {
    const statusInfo = statusCode ? ` (status: ${statusCode})` : '';
    super(ErrorCode.InternalError, `Network error: ${message}${statusInfo}`);
  }
}

export class ExtractionError extends McpError {
  constructor(message: string, url?: string) {
    const urlInfo = url ? ` for URL: ${url}` : '';
    super(ErrorCode.InternalError, `Content extraction failed: ${message}${urlInfo}`);
  }
}

export class EmbeddingError extends McpError {
  constructor(message: string, provider?: string) {
    const providerInfo = provider ? ` (provider: ${provider})` : '';
    super(ErrorCode.InternalError, `Embedding operation failed: ${message}${providerInfo}`);
  }
}

export class ValidationError extends McpError {
  constructor(message: string) {
    super(ErrorCode.InvalidParams, `Validation error: ${message}`);
  }
}

export class ConfigurationError extends McpError {
  constructor(message: string) {
    super(ErrorCode.InternalError, `Configuration error: ${message}`);
  }
}

export class DatabaseError extends McpError {
  constructor(message: string) {
    super(ErrorCode.InternalError, `Database error: ${message}`);
  }
}

export function handleMcpError(error: unknown, context?: string): McpError {
  if (error instanceof McpError) {
    return error;
  }

  const prefix = context ? `${context}: ` : '';

  if (error instanceof Error) {
    return new McpError(ErrorCode.InternalError, `${prefix}${error.message}`);
  }

  return new McpError(ErrorCode.InternalError, `${prefix}Unknown error occurred`);
}
