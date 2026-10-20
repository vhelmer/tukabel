import { useEffect, useRef, useState } from 'react';
import { editorJobAction, listEditorJobs } from './api';
import type { EditorJob } from './jobs';

function reconcile(current: EditorJob[], incoming: EditorJob[]) {
  return incoming.map((job) => {
    const previous = current.find((j) => j.id === job.id);
    return previous && JSON.stringify(previous) === JSON.stringify(job)
      ? previous
      : job;
  });
}

export function useEditorJobs(active: boolean) {
  const mutations = useRef(0);
  const [jobs, setJobs] = useState<EditorJob[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const version = mutations.current;
      try {
        const data = await listEditorJobs();
        if (!disposed && version === mutations.current) {
          setJobs((current) => reconcile(current, data.jobs));
          setError('');
        }
      } catch {
        if (!disposed)
          setError('Frontu sa nepodarilo načítať. Úlohy sa neposielajú znovu.');
      }
      if (!disposed) timer = setTimeout(() => void poll(), 1000);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [active]);
  const action = async (id: string, type: 'cancel' | 'dismiss') => {
    try {
      await editorJobAction(id, type);
      mutations.current++;
      setJobs((current) =>
        current
          .filter((j) => j.id !== id || type !== 'dismiss')
          .map((j) =>
            j.id === id
              ? { ...j, status: 'cancelled', stage: 'Zrušené pred spustením' }
              : j,
          ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operácia zlyhala.');
    }
  };
  const add = (job: EditorJob) => {
    mutations.current++;
    setJobs((current) => [...current.filter((j) => j.id !== job.id), job]);
  };
  return { jobs, error, action, add };
}
