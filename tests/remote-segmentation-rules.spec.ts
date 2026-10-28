import { test, expect } from '@playwright/test';
import { remoteSegmentation } from '../dev/remoteSegmentation';

test('SSH transport rejects unsafe destinations before launching processes', async () => {
  await expect(
    remoteSegmentation(
      { host: '-oProxyCommand=bad', user: 'user' },
      { operation: 'status' },
    ),
  ).rejects.toThrow('SSH');
});

test('SSH transport reports a bounded error without leaking credentials', async () => {
  await expect(
    remoteSegmentation(
      { host: '127.0.0.1', user: 'user', port: 1, password: 'secret-value' },
      { operation: 'status' },
    ),
  ).rejects.toThrow('Vzdálené zpracování');
});

test('remote runner isolates inputs, returns only output files and removes temporary data', async () => {
  const { mkdtemp, writeFile, readFile, access, rm } =
    await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-remote-test-'));
  try {
    await writeFile(
      path.join(root, '.env.local'),
      'SEGMENTATION_PYTHON=python3\nSAM3_PYTHON=python3\n',
    );
    const helper = `import sys,json\nfrom pathlib import Path\nif sys.argv[1]=='--status': print(json.dumps({'grabcut':True,'sam2':True,'sam3':True,'closed-form':True,'vitmatte':True}))\nelse:\n folder=Path(sys.argv[1]); assert (folder/'source.png').read_bytes()==b'original'\n Path('last-temp').write_text(str(folder))\n (folder/'result.png').write_bytes(b'mask-result')\n`;
    const helpers = Object.fromEntries(
      [
        'segment.py',
        'matting.py',
        'sam3_adapter.py',
        'setup_sam3.py',
        'device.py',
        'align.py',
      ].map((name) => [name, Buffer.from(helper).toString('base64')]),
    );
    const run = (operation: string) =>
      spawnSync('python3', ['scripts/segmentation/remote.py'], {
        input: JSON.stringify({
          root,
          operation,
          helpers,
          args: ['grabcut'],
          files: { 'source.png': Buffer.from('original').toString('base64') },
        }),
        encoding: 'utf8',
      });
    const status = run('status');
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual({
      grabcut: true,
      sam2: true,
      sam3: true,
      'closed-form': true,
      vitmatte: true,
    });
    await writeFile(
      path.join(root, '.env.local'),
      'SEGMENTATION_PYTHON=python3\nSAM3_PYTHON=/missing/python\n',
    );
    expect(JSON.parse(run('status').stdout).sam3).toBeUndefined();
    const result = run('segment');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      'result.png': Buffer.from('mask-result').toString('base64'),
    });
    await expect(
      access(await readFile(path.join(root, 'last-temp'), 'utf8')),
    ).rejects.toThrow();
    const failure = run('unknown');
    expect(failure.status).toBe(1);
    expect(JSON.parse(failure.stdout)).toEqual({
      error: 'remote inference failed',
    });
    expect(failure.stderr).toBe('');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
