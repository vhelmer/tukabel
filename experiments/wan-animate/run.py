#!/usr/bin/env python3
"""Submit one local ComfyUI job, report progress, and archive its actual history."""
import argparse
import json
from pathlib import Path
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
API = 'http://127.0.0.1:8188'


def request(path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(API + path, data, {'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode()) from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('graph', type=Path)
    parser.add_argument('--timeout', type=int, default=3600)
    args = parser.parse_args()
    queue = request('/queue')
    if queue['queue_running'] or queue['queue_pending']:
        raise RuntimeError('ComfyUI is busy; refusing to silently enqueue another job')
    graph = json.loads(args.graph.read_text())
    started = time.monotonic()
    response = request('/prompt', {'prompt': graph})
    prompt_id = response['prompt_id']
    print(f'Submitted {prompt_id}', flush=True)
    previous = None
    while time.monotonic() - started < args.timeout:
        history = request(f'/history/{prompt_id}')
        if prompt_id in history:
            record = history[prompt_id]
            report = {'promptId': prompt_id, 'elapsedSeconds': round(time.monotonic()-started, 2),
                      'graph': args.graph.name, 'history': record}
            output = ROOT / f'{args.graph.stem}-run.json'
            output.write_text(json.dumps(report, indent=2) + '\n')
            status = record['status']
            files = [image for result in record.get('outputs', {}).values()
                     for image in result.get('images', [])]
            paths = [f"{file['type']}/{file.get('subfolder', '')}/{file['filename']}" for file in files]
            print(json.dumps({'status': status['status_str'], 'elapsedSeconds': report['elapsedSeconds'],
                              'fileCount': len(files), 'files': paths if len(paths) <= 6 else paths[:3] + ['…'] + paths[-3:],
                              'report': str(output)}, indent=2), flush=True)
            if status['status_str'] != 'success':
                raise RuntimeError('ComfyUI execution failed; see the archived history and server log')
            return
        stats = request('/prompt')['exec_info']
        marker = stats['queue_remaining']
        if marker != previous:
            print(f'Running; queue remaining {marker}', flush=True)
            previous = marker
        time.sleep(5)
    raise TimeoutError(f'Job {prompt_id} is still running; inspect ComfyUI before submitting another')


if __name__ == '__main__':
    main()
