import type { EditorJob } from './jobs';

export function JobTray({
  jobs,
  error,
  onOpen,
  onAction,
}: {
  jobs: readonly EditorJob[];
  error: string;
  onOpen: (job: EditorJob) => void;
  onAction: (id: string, action: 'cancel' | 'dismiss') => void;
}) {
  if (!jobs.length && !error) return null;
  return (
    <details className="editor-job-tray" open>
      <summary>
        Úlohy na pozadí ·{' '}
        {jobs.filter((j) => ['running', 'queued'].includes(j.status)).length}{' '}
        rozpracovaných · {jobs.filter((j) => j.status === 'succeeded').length}{' '}
        na kontrolu
      </summary>
      <p className="field-note">
        Pokračuj v práci. Výsledky sa použijú až po kontrole. Fronta prežije
        obnovenie stránky; reštart Vite ju vymaže. Hotové grafické assety
        zostávajú v projekte.
      </p>
      {error && <p role="alert">{error}</p>}
      <ul>
        {[...jobs].reverse().map((job) => (
          <li key={job.id} data-job-id={job.id}>
            <div>
              <strong>{job.label}</strong>
              <span role="status">{job.stage}</span>
              {job.error && <p role="alert">{job.error}</p>}
            </div>
            {job.status === 'succeeded' && (
              <button onClick={() => onOpen(job)}>Otvoriť výsledok</button>
            )}
            {job.status === 'queued' && (
              <button onClick={() => onAction(job.id, 'cancel')}>
                Zrušiť čakajúcu úlohu
              </button>
            )}
            {!['queued', 'running'].includes(job.status) && (
              <button onClick={() => onAction(job.id, 'dismiss')}>
                Odložiť z fronty
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
