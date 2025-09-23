import { Worker } from 'worker_threads';
import { spawn, ChildProcess } from 'child_process';
import { getDatabasePath, getEnvironment } from '../../../../config/environment';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

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
  const override = process.env.VECTOR_DB_WORKER_PATH;
  if (override && existsSync(override)) return override;

  const localJs = join(__dirname, 'db-worker.js');
  if (existsSync(localJs)) return localJs;
  const distJs = join(process.cwd(), 'dist', 'core', 'vector', 'store', 'worker', 'db-worker.js');
  if (existsSync(distJs)) return distJs;

  throw new Error('Worker path not found');
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
        else promise.resolve(result);
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
    const timeout = setTimeout(() => {
      reject(new Error('DB worker initialization timed out'));
    }, 20000);

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
  await postMessage('close');
  if (worker instanceof Worker) {
    await worker.terminate();
  } else {
    try {
      worker.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  worker = null;
  isInitialized = false;
  initPromise = null;
}
