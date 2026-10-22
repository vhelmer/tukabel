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
        Pokračuj v práci. Výsledky se použijí až po kontrole. Fronta přežije
        obnovení stránky; restart Vite ji vymaže. Hotové grafické assety
        zůstávají v projektu.
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
              <button onClick={() => onOpen(job)}>Otevřít výsledek</button>
            )}
            {job.log && job.log.length > 0 && (
              <details className="codex-log">
                <summary>Průběh agenta</summary>
                <ol>
                  {job.log.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ol>
              </details>
            )}
            {(job.status === 'queued' ||
              (job.status === 'running' && job.kind === 'codex')) && (
              <button onClick={() => onAction(job.id, 'cancel')}>
                {job.status === 'running'
                  ? 'Zastavit agenta'
                  : 'Zrušit čekající úlohu'}
              </button>
            )}
            {!['queued', 'running'].includes(job.status) && (
              <button onClick={() => onAction(job.id, 'dismiss')}>
                Odložit z fronty
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
