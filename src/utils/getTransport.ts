import pino from 'pino';
import { createRequire } from 'node:module';
import { getEnvironment, isRunningInDocker } from '../config/environment';
const STDERR_DESTINATION = 2;

export function getTransport(): pino.TransportSingleOptions | undefined {
  const env = getEnvironment();
  const isDevelopment = env.NODE_ENV === 'development';
  let pinoPrettyResolved;
  try {
    // Only try to use pino-pretty in development when it's actually available
    const _require = typeof require === 'function' ? require : createRequire(import.meta.url);
    _require.resolve('pino-pretty');
    pinoPrettyResolved = true;
  } catch {
    pinoPrettyResolved = false;
  }

  if (pinoPrettyResolved && isDevelopment && !isRunningInDocker()) {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
        destination: STDERR_DESTINATION, // Use stderr
      },
    };
  } else {
    return { target: 'pino/file', options: { destination: STDERR_DESTINATION } };
  }
}
