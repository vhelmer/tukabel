#!/usr/bin/env python3
"""Explicitly install the pinned Wan Animate assets into an existing ComfyUI."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
import threading
import urllib.request

ROOT = Path(__file__).resolve().parent


def sha256(file):
    digest = hashlib.sha256()
    with file.open('rb') as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def download_ranges(url, temporary, size, connections):
    """Resume the existing prefix; disjoint HTTP ranges avoid a slow single stream."""
    parts = temporary.with_suffix(temporary.suffix + '.parts')
    parts.mkdir(exist_ok=True)
    progress_file = parts / 'prefix.json'
    if progress_file.exists():
        prefix = json.loads(progress_file.read_text())
    else:
        prefix = temporary.stat().st_size if temporary.exists() else 0
        progress_file.write_text(json.dumps(prefix))
    chunk_size = 64 * 1024 * 1024
    ranges = [(start, min(size, start + chunk_size)-1) for start in range(prefix, size, chunk_size)]
    lock = threading.Lock()
    done = prefix
    last_report = prefix

    def fetch(interval):
        nonlocal done, last_report
        start, end = interval
        file = parts / f'{start}-{end}.bin'
        if not file.exists() or file.stat().st_size != end-start+1:
            pending = file.with_suffix('.pending')
            offset = pending.stat().st_size if pending.exists() else 0
            if offset > end-start+1:
                raise ValueError(f'Invalid partial range: {pending}')
            if offset < end-start+1:
                request = urllib.request.Request(url, headers={'Range': f'bytes={start+offset}-{end}'})
                with urllib.request.urlopen(request, timeout=120) as response, pending.open('ab') as handle:
                    if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start+offset}-{end}/{size}':
                        raise ValueError('Server did not honor the requested byte range')
                    shutil.copyfileobj(response, handle, 1024 * 1024)
            if pending.stat().st_size != end-start+1:
                raise ValueError('Incomplete model chunk')
            pending.replace(file)
        with lock:
            done += end-start+1
            if done-last_report >= 512 * 1024 * 1024 or done == size:
                print(f'{temporary.stem}: {done/size:.0%}', flush=True)
                last_report = done
        return file

    with ThreadPoolExecutor(max_workers=connections) as pool:
        ordered = list(pool.map(fetch, ranges))
    with temporary.open('r+b' if temporary.exists() else 'w+b') as handle:
        handle.truncate(prefix)
        handle.seek(prefix)
        for file in ordered:
            with file.open('rb') as part:
                shutil.copyfileobj(part, handle, 8 * 1024 * 1024)
    return parts


def install(base, model, verify, connections):
    target = base / model['target']
    if target.exists():
        if target.stat().st_size != model['size'] or sha256(target) != model['sha256']:
            raise ValueError(f'Existing file differs; refusing overwrite: {target}')
        print(f"Verified: {target.name}", flush=True)
        return
    if verify:
        raise FileNotFoundError(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + '.partial')
    url = f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{model['file']}"
    print(f"Downloading {target.name}: {model['size']/1e9:.2f} GB", flush=True)
    parts = download_ranges(url, temporary, model['size'], connections)
    if temporary.stat().st_size != model['size'] or sha256(temporary) != model['sha256']:
        raise ValueError(f'Download checksum mismatch: {target.name}')
    temporary.replace(target)
    shutil.rmtree(parts)
    print(f"Installed and SHA-256 verified: {target.name}", flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('comfyui', type=Path, help='ComfyUI directory containing main.py/models')
    parser.add_argument('--verify', action='store_true', help='Offline checks only, no downloads')
    parser.add_argument('--connections', type=int, default=16, help='Concurrent ranges per model (1-64)')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'models.json')
    args = parser.parse_args()
    if not 1 <= args.connections <= 64:
        parser.error('connections must be between 1 and 64')
    base = args.comfyui.resolve()
    if not (base / 'main.py').is_file():
        parser.error('Select the existing ComfyUI directory containing main.py')
    models = sorted(json.loads(args.manifest.read_text()), key=lambda model: model['size'])
    missing = sum(m['size'] for m in models if not (base / m['target']).exists())
    if not args.verify and shutil.disk_usage(base).free < missing + 2 * 1024**3:
        parser.error('Not enough free space for the selected models')
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(lambda model: install(base, model, args.verify, args.connections), models))
