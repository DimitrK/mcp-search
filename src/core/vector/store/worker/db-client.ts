import { Worker } from 'worker_threads';
import { spawn, ChildProcess } from 'child_process';
import { getDatabasePath, getEnvironment } from '../../../../config/environment';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { logger } from '../../../../utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let worker: Worker | ChildProcess | null;
let isInitialized = false;
let initPromise: Promise<boolean> | null = null;
type WorkerMessage = {
  id: number | null | undefined;
  type: string;
  result?: unknown;
  error?: string;
};
type WorkerEnvelope = { id: number; type: string; sql?: string; params?: unknown[] };
const inflight = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason?: Error) => void }
>();
let nextId = 0;
let allowRestart = true;

type MinimalMessenger = {
  on: (event: 'message', listener: (msg: WorkerMessage) => void) => void;
  off?: (event: 'message', listener: (msg: WorkerMessage) => void) => void;
  postMessage?: (msg: WorkerEnvelope) => void;
  send?: (msg: WorkerEnvelope) => boolean;
};

function resolveWorkerPath() {
  const env = getEnvironment();
  logger.debug('Resolving worker path');

  const override = process.env.VECTOR_DB_WORKER_PATH;
  if (override) {
    logger.debug(`Checking environment override: ${override}`);
    if (existsSync(override)) {
      logger.info(`Worker path resolved via environment override: ${override}`);
      return override;
    }
    logger.debug(`Environment override path not found: ${override}`);
  }

  // The worker file should be in the same directory as this file
  // This works correctly with npx installations since __dirname points to the actual file location
  const workerJs = join(__dirname, 'db-worker.js');
  logger.debug(`Checking same directory: ${workerJs}`);
  if (existsSync(workerJs)) {
    logger.info(`Worker path resolved from same directory: ${workerJs}`);
    return workerJs;
  }

  // Fallback: check in the dist subdirectory structure
  const distJs = join(__dirname, 'core', 'vector', 'store', 'worker', 'db-worker.js');
  logger.debug(`Checking dist subdirectory: ${distJs}`);
  if (existsSync(distJs)) {
    logger.info(`Worker path resolved from dist subdirectory: ${distJs}`);
    return distJs;
  }

  // Fallback: check relative to the main module directory (for npm installations)
  const mainModuleDir = process.mainModule
    ? dirname(process.mainModule.filename)
    : env.NODE_ENV === 'development'
      ? process.cwd()
      : '';
  const mainModuleWorker = join(mainModuleDir, 'core', 'vector', 'store', 'worker', 'db-worker.js');
  if (mainModuleDir) {
    logger.debug(`Checking main module directory: ${mainModuleWorker}`);
    if (existsSync(mainModuleWorker)) {
      logger.info(`Worker path resolved from main module directory: ${mainModuleWorker}`);
      return mainModuleWorker;
    }
  }

  // Final fallback: check in the source directory structure (for development)
  const sourceJs =
    env.NODE_ENV === 'development'
      ? join(process.cwd(), 'src', 'core', 'vector', 'store', 'worker', 'db-worker.js')
      : '';
  if (sourceJs) {
    logger.debug(`Checking source directory: ${sourceJs}`);
    if (existsSync(sourceJs)) {
      logger.info(`Worker path resolved from source directory: ${sourceJs}`);
      return sourceJs;
    }
  }

  logger.error(
    `Worker path not found. Searched paths: ${[override, workerJs, distJs, mainModuleWorker, sourceJs].filter(Boolean).join(', ')}`
  );
  throw new Error(
    `Worker path not found. Searched in: ${workerJs}, ${distJs}, ${mainModuleWorker}, ${sourceJs}. ` +
      `Current working directory: ${process.cwd()}. __dirname: ${__dirname}. ` +
      `Set VECTOR_DB_WORKER_PATH environment variable to specify the correct path.`
  );
}

// getWorker: Only used for non-inline modes. Inline mode never reaches this module.
function getWorker() {
  if (worker) return worker;

  const env = getEnvironment();
  const executionMode = env.VECTOR_DB_MODE ?? 'thread';
  const dbPath = getDatabasePath();
  const workerPath = resolveWorkerPath();

  if (executionMode === 'process') {
    const debugProc = (process.env.VECTOR_DB_PROCESS_DEBUG ?? '0').toLowerCase() === '1';
    const stdio = debugProc
      ? (['ignore', 'inherit', 'inherit', 'ipc'] as const)
      : (['ignore', 'pipe', 'pipe', 'ipc'] as const);
    const cp = spawn(process.execPath, [workerPath], {
      env: { ...process.env, DB_PATH: dbPath },
      stdio: stdio as unknown as
        | ['ignore', 'inherit', 'inherit', 'ipc']
        | ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    worker = cp;
    cp.on('message', (msg: WorkerMessage) => {
      const { id, result, error } = msg || ({} as WorkerMessage);
      if (id === null || id === undefined) return;
      const promise = inflight.get(id);
      if (promise) {
        if (error) promise.reject(new Error(error));
        else promise.resolve(result);
        inflight.delete(id);
      }
    });
    if (!debugProc) {
      cp.stdout?.on('data', d => process.stderr.write(`[db-proc][out] ${d}`));
      cp.stderr?.on('data', d => process.stderr.write(`[db-proc][err] ${d}`));
    }
    cp.on('exit', code => {
      if (code !== 0) {
        console.error(`DB process worker stopped with exit code ${code}`);
      }
      worker = null;
      isInitialized = false;
      initPromise = null;
      const restart = (env.VECTOR_DB_RESTART_ON_CRASH ?? 'true').toLowerCase() === 'true';
      allowRestart = restart;
    });
  } else {
    const wt = new Worker(workerPath, { workerData: { dbPath } });
    worker = wt;
    wt.on('message', (msg: WorkerMessage) => {
      const { id, result, error } = msg;
      if (id === null || id === undefined) return;
      const promise = inflight.get(id);
      if (promise) {
        if (error) promise.reject(new Error(error));
        else {
          promise.resolve(result);
        }
        inflight.delete(id);
      }
    });
    wt.on('exit', code => {
      if (code !== 0) {
        console.error(`DB worker thread stopped with exit code ${code}`);
      }
      worker = null;
      isInitialized = false;
      initPromise = null;
      const restart = (env.VECTOR_DB_RESTART_ON_CRASH ?? 'true').toLowerCase() === 'true';
      allowRestart = restart;
    });
  }

  return worker;
}

async function ensureInitialized() {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = new Promise<boolean>((resolve, reject) => {
    const w = getWorker() as unknown as MinimalMessenger;

    // Worker initialization can legitimately take time due to:
    // - DuckDB database file creation/opening
    // - VSS extension download and compilation
    // - System resource constraints
    const WORKER_INIT_TIMEOUT_MS = parseInt(process.env.WORKER_INIT_TIMEOUT_MS || '20000', 10);

    const timeout = setTimeout(() => {
      reject(
        new Error(
          `DB worker initialization timed out after ${WORKER_INIT_TIMEOUT_MS}ms. This may indicate network issues (VSS extension download), file system problems, or system resource constraints.`
        )
      );
    }, WORKER_INIT_TIMEOUT_MS);

    const onInit = (msg: { type: string; error?: string }) => {
      if (msg.type === 'init-success') {
        isInitialized = true;
        clearTimeout(timeout);
        w.off?.('message', onInit);
        resolve(true);
      } else if (msg.type === 'init-error') {
        clearTimeout(timeout);
        w.off?.('message', onInit);
        reject(new Error(msg.error || 'Unknown error'));
      }
    };
    w.on('message', onInit);
  });

  return initPromise;
}

function postMessage(type: string, sql?: string, params?: unknown[]): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    if (!allowRestart && !worker) {
      reject(new Error('DB worker not available'));
      return;
    }
    void ensureInitialized()
      .then(() => {
        const id = nextId++;
        inflight.set(id, { resolve, reject });
        const w = getWorker() as unknown as MinimalMessenger;
        const envelope: WorkerEnvelope = { id, type, sql, params };
        if (w.postMessage) w.postMessage(envelope);
        else if (w.send) w.send(envelope);
        else reject(new Error('DB worker has no messaging method'));
      })
      .catch(err => reject(err as Error));
  });
}

export const dbRun = (sql: string, params?: unknown[]): Promise<void> =>
  postMessage('run', sql, params) as Promise<void>;
export const dbAll = (sql: string, params?: unknown[]): Promise<unknown[]> =>
  postMessage('all', sql, params) as Promise<unknown[]>;

export async function closeDb() {
  if (!worker) return;

  // Send close message to worker
  try {
    await postMessage('close');
  } catch {
    // Worker might already be dead, continue with cleanup
  }

  // Wait for inflight operations to complete (no timeout needed with sequential logic)
  const inflightPromise = waitForInflightOperations();

  // Wait for inflight operations to complete, THEN terminate worker
  try {
    await inflightPromise; // Wait for operations to complete first

    if (worker instanceof Worker) {
      await worker.terminate(); // Now safely terminate the worker
    } else {
      worker.kill('SIGTERM'); // Send termination signal to child process
      // No arbitrary delay needed - SIGTERM should handle it
    }
  } catch (error) {
    // If inflight operations fail, force terminate anyway
    console.warn('Inflight operations failed during cleanup, force terminating worker:', error);
    if (worker instanceof Worker) {
      await worker.terminate();
    } else {
      worker.kill('SIGKILL'); // Force kill if SIGTERM didn't work
    }
  }

  // Reject any remaining inflight operations
  rejectAllInflightOperations();

  // Clean up state
  worker = null;
  isInitialized = false;
  initPromise = null;
}

async function waitForInflightOperations(): Promise<void> {
  if (inflight.size === 0) return;

  return new Promise<void>(resolve => {
    const checkInterval = setInterval(() => {
      if (inflight.size === 0) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
    // No timeout needed - operations will complete naturally
    // If they don't, that's a different bug to investigate
  });
}

function rejectAllInflightOperations(): void {
  for (const [_id, { reject }] of inflight.entries()) {
    reject(new Error('Database worker terminated during operation'));
  }
  inflight.clear();
}
