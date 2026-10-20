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
    (stage: (text: string) => void) => Promise<Result>
  >();
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
        job.stage = 'Pripravujem vstup';
        try {
          const result = await tasks.get(job.id)!((stage) => {
            job.stage = stage;
          });
          // Job kind and runner are paired by the local API, never by model output.
          Object.assign(job, {
            result,
            status: 'succeeded',
            stage: 'Pripravené na kontrolu',
          });
        } catch (error) {
          job.status = 'failed';
          job.stage = 'Úloha zlyhala · bez automatického opakovania';
          job.error = error instanceof Error ? error.message : 'Úloha zlyhala.';
        } finally {
          tasks.delete(job.id);
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
      run: (stage: (text: string) => void) => Promise<Result>,
    ) {
      if (closed || jobs.length >= 20)
        throw Error('Fronta je plná (20 úloh). Odlož hotové výsledky.');
      const job = {
        ...structuredClone(input),
        id: randomUUID(),
        label: label.slice(0, 100),
        createdAt: new Date().toISOString(),
        status: 'queued',
        stage: 'Čaká vo fronte',
      } as EditorJob;
      jobs.push(job);
      tasks.set(job.id, run);
      // Return 202 before starting work, including CPU-bound local image work.
      setImmediate(() => void drain());
      return job;
    },
    cancel(id: string) {
      const job = jobs.find((j) => j.id === id);
      if (!job || job.status !== 'queued')
        throw Error(
          'Zrušiť možno iba čakajúcu úlohu. Bežiaca požiadavka sa dokončí.',
        );
      job.status = 'cancelled';
      job.stage = 'Zrušené pred spustením';
      tasks.delete(id);
    },
    dismiss(id: string) {
      const index = jobs.findIndex((j) => j.id === id);
      if (index < 0 || ['queued', 'running'].includes(jobs[index]!.status))
        throw Error('Najprv dokonči alebo zruš úlohu.');
      jobs.splice(index, 1);
    },
    close() {
      closed = true;
    },
  };
}
