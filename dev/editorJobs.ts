import { randomUUID } from 'node:crypto';
import type { EditorJob } from '../src/editor/jobs.ts';

type JobInput = {
  [K in EditorJob['kind']]: {
    kind: K;
    context: Extract<EditorJob, { kind: K }>['context'];
  };
}[EditorJob['kind']];
type Result = NonNullable<EditorJob['result']>;

// A bounded in-process queue, deliberately separate from project revisions.
// Node's asynchronous provider calls never hold the editor's read/write lock.
export function createEditorJobs() {
  const jobs: EditorJob[] = [];
  const tasks = new Map<
    string,
    (stage: (text: string) => void, signal: AbortSignal) => Promise<Result>
  >();
  const controllers = new Map<string, AbortController>();
  let running = false,
    closed = false;
  async function drain() {
    if (running || closed) return;
    running = true;
    try {
      while (!closed) {
        const job = jobs.find((job) => job.status === 'queued');
        if (!job) break;
        job.status = 'running';
        job.stage = 'Připravuji vstup';
        const controller = new AbortController();
        controllers.set(job.id, controller);
        try {
          const result = await tasks.get(job.id)!((stage) => {
            if (controller.signal.aborted) return;
            job.stage = stage;
            if (job.kind === 'codex' && job.log?.at(-1) !== stage)
              job.log = [...(job.log ?? []), stage].slice(-40);
          }, controller.signal);
          if (controller.signal.aborted) continue;
          // Job kind and runner are paired by the local API, never by model output.
          Object.assign(job, {
            result,
            status: 'succeeded',
            stage: 'Připravené na kontrolu',
          });
        } catch (error) {
          if (controller.signal.aborted) continue;
          job.status = 'failed';
          job.stage = 'Úloha selhala · bez automatického opakování';
          job.error = error instanceof Error ? error.message : 'Úloha selhala.';
        } finally {
          if (job.kind === 'codex' && controller.signal.aborted) {
            job.status = 'cancelled';
            job.stage = 'Agent zastaven · výsledek se nepoužil';
          }
          tasks.delete(job.id);
          controllers.delete(job.id);
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    list: () => jobs,
    submit(
      input: JobInput,
      label: string,
      run: (
        stage: (text: string) => void,
        signal: AbortSignal,
      ) => Promise<Result>,
    ) {
      if (closed || jobs.length >= 20)
        throw Error('Fronta je plná (20 úloh). Odlož hotové výsledky.');
      const job = {
        ...structuredClone(input),
        id: randomUUID(),
        label: label.slice(0, 100),
        createdAt: new Date().toISOString(),
        status: 'queued',
        stage: 'Čeká ve frontě',
      } as EditorJob;
      jobs.push(job);
      tasks.set(job.id, run);
      // Return 202 before starting work, including CPU-bound local image work.
      setImmediate(() => void drain());
      return job;
    },
    cancel(id: string) {
      const job = jobs.find((j) => j.id === id);
      if (job?.status === 'running' && job.kind === 'codex') {
        controllers.get(id)?.abort();
        job.status = 'cancelled';
        job.stage = 'Agent se zastavuje · výsledek se nepoužije';
        return;
      }
      if (!job || job.status !== 'queued')
        throw Error(
          'Zrušit lze pouze čekající úlohu. Běžící požadavek se dokončí.',
        );
      job.status = 'cancelled';
      job.stage = 'Zrušené před spuštěním';
      tasks.delete(id);
    },
    dismiss(id: string) {
      const index = jobs.findIndex((j) => j.id === id);
      if (index < 0 || ['queued', 'running'].includes(jobs[index]!.status))
        throw Error('Nejprve dokonči nebo zruš úlohu.');
      jobs.splice(index, 1);
    },
    close() {
      closed = true;
      for (const job of jobs) {
        if (job.kind === 'codex' && job.status === 'running')
          controllers.get(job.id)?.abort();
      }
    },
  };
}
