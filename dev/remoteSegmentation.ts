import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export interface RemoteSegmentationOptions {
  host: string;
  user: string;
  password?: string;
  port?: number;
  root?: string;
  knownHosts?: string;
  device?: 'auto' | 'cpu' | 'cuda';
}
interface Request {
  operation: 'status' | 'segment' | 'matte';
  args?: string[];
  files?: Record<string, string>;
}
const folder = new URL('../scripts/segmentation/', import.meta.url);

export async function remoteSegmentation(
  options: RemoteSegmentationOptions,
  request: Request,
): Promise<Record<string, unknown>> {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(options.host) ||
    !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(options.user) ||
    (options.port !== undefined &&
      (!Number.isInteger(options.port) ||
        options.port < 1 ||
        options.port > 65535)) ||
    (options.device !== undefined &&
      !['auto', 'cpu', 'cuda'].includes(options.device))
  )
    throw Error('Neplatné nastavení SSH.');
  const helpers = Object.fromEntries(
    await Promise.all(
      [
        'segment.py',
        'matting.py',
        'sam3_adapter.py',
        'setup_sam3.py',
        'device.py',
      ].map(async (name) => [
        name,
        (await readFile(new URL(name, folder))).toString('base64'),
      ]),
    ),
  );
  const runner = (await readFile(new URL('remote.py', folder))).toString(
    'base64',
  );
  // Only our fixed, base64-encoded bootstrap enters the remote shell. Settings,
  // images and credentials never become shell commands.
  const command = `python3 -c 'import base64;exec(base64.b64decode("${runner}"))'`;
  const args = [
    '-T',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'NumberOfPasswordPrompts=1',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=2',
  ];
  if (options.knownHosts)
    args.push('-o', `UserKnownHostsFile=${options.knownHosts}`);
  if (options.port) args.push('-p', String(options.port));
  args.push(`${options.user}@${options.host}`, command);
  const payload = JSON.stringify({
    ...request,
    helpers,
    root: options.root,
    device: options.device ?? 'auto',
  });
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        'ssh',
        args,
        {
          timeout: 300000,
          maxBuffer: 128 * 1024 * 1024,
          env: {
            ...process.env,
            SSH_ASKPASS: fileURLToPath(new URL('ssh_askpass.py', folder)),
            SSH_ASKPASS_REQUIRE: 'force',
            DISPLAY: process.env.DISPLAY || ':0',
            TUKABEL_SSH_PASSWORD: options.password ?? '',
          },
        },
        (error, stdout) =>
          error ? reject(Error('SSH failed')) : resolve(stdout),
      );
      child.stdin?.on('error', () => {
        /* execFile callback owns failures */
      });
      child.stdin?.end(payload);
    });
    const result: unknown = JSON.parse(stdout);
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      'error' in result
    )
      throw Error('Invalid response');
    return result as Record<string, unknown>;
  } catch {
    throw Error(
      'Vzdálené zpracování přes SSH selhalo. Ověř připojení, známý klíč serveru a instalaci modelu; úloha se neopakuje.',
    );
  }
}
