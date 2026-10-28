"""One SSH request, isolated files, offline models, no changes to remote project."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def run(request):
    root = Path(request.get("root") or Path.home() / "Projects/tukabel").expanduser().resolve()
    settings = {}
    config = root / ".env.local"
    if config.is_file():
        for line in config.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                settings[key.strip()] = value.strip().strip("\"'")
    def setting(key, default):
        return os.environ.get(key) or settings.get(key) or str(root / default)
    python = setting("SEGMENTATION_PYTHON", ".local-tools/segmentation/bin/python")
    sam3 = setting("SAM3_PYTHON", ".local-tools/sam3/bin/python")
    env = dict(os.environ, HF_HUB_OFFLINE="1", NUMBA_NUM_THREADS="4",
               HF_HOME=str(root / ".local-tools/huggingface"),
               TUKABEL_DEVICE=request.get("device", "auto"),
               TUKABEL_SAM2_CHECKPOINT=setting("SAM2_CHECKPOINT", ".local-tools/models/sam2.1_hiera_tiny.pt"),
               TUKABEL_SAM2_CONFIG=os.environ.get("SAM2_CONFIG") or settings.get("SAM2_CONFIG") or "configs/sam2.1/sam2.1_hiera_t.yaml",
               TUKABEL_SAM3_MODEL=setting("SAM3_MODEL", ".local-tools/models/sam3"),
               TUKABEL_VITMATTE_MODEL=setting("VITMATTE_MODEL", ".local-tools/models/vitmatte-small"))
    with tempfile.TemporaryDirectory(prefix="tukabel-ssh-") as temp:
        folder = Path(temp)
        for name in ("segment.py", "matting.py", "sam3_adapter.py", "setup_sam3.py", "device.py"):
            (folder / name).write_bytes(base64.b64decode(request["helpers"][name], validate=True))
        def execute(runtime, helper, args):
            result = subprocess.run([runtime, str(folder / helper), *args], env=env, cwd=root,
                                    capture_output=True, timeout=8 if args == ["--status"] else 270, check=True)
            return result.stdout
        if request["operation"] == "status":
            result = {}
            for runtime, helper, keys in ((python, "segment.py", ("grabcut", "sam2")),
                                          (sam3, "segment.py", ("sam3",)),
                                          (python, "matting.py", ("closed-form", "vitmatte"))):
                try:
                    for key, value in json.loads(execute(runtime, helper, ["--status"])).items():
                        if key in keys:
                            result[key] = value is True
                except (OSError, subprocess.SubprocessError, ValueError):
                    pass
            return result
        for name in ("source.png", "prior.png", "seeds.png"):
            if name in request["files"]:
                (folder / name).write_bytes(base64.b64decode(request["files"][name], validate=True))
        method = request["args"][0]
        if request["operation"] == "segment" and method in ("sam2", "sam3", "grabcut"):
            execute(sam3 if method == "sam3" else python, "segment.py", [temp, *request["args"]])
        elif request["operation"] == "matte" and method in ("vitmatte", "closed-form", "foreground"):
            execute(python, "matting.py", [temp, *request["args"]])
        else:
            raise ValueError("unsupported operation")
        return {name: base64.b64encode((folder / name).read_bytes()).decode()
                for name in ("result.png", "foreground.png") if (folder / name).is_file()}


if __name__ == "__main__":
    try:
        print(json.dumps(run(json.load(sys.stdin))))
    except Exception:
        # Provider/runtime stderr may contain private paths and configuration.
        print('{"error":"remote inference failed"}')
        sys.exit(1)
