"""Explicit installer only. No token/response bodies or downloads during play."""
import argparse
import errno
import json
from pathlib import Path
import sys

MODEL = "facebook/sam3"
ENDPOINT = "https://huggingface.co"
MODEL_URL = f"{ENDPOINT}/{MODEL}"
TOKEN_URL = f"{ENDPOINT}/settings/tokens"


class IncompleteModelError(Exception):
    pass


def model_files_ready(directory):
    """The status probe must not enable SAM 3 with only a downloaded index."""
    directory = Path(directory)
    try:
        config = directory / "config.json"
        if not config.is_file() or not isinstance(json.loads(config.read_text()), dict):
            return False
        index = directory / "model.safetensors.index.json"
        if index.is_file():
            metadata = json.loads(index.read_text())
            if not isinstance(metadata, dict) or not isinstance(metadata.get("weight_map"), dict):
                return False
            shards = set(metadata["weight_map"].values())
        else:
            shards = {"model.safetensors"}
        return bool(shards) and all(
            isinstance(name, str) and not Path(name).is_absolute()
            and ".." not in Path(name).parts and name.endswith(".safetensors")
            and (directory / name).is_file() and (directory / name).stat().st_size > 0
            for name in shards
        )
    except (OSError, ValueError, KeyError, TypeError):
        return False


def runtime_ready():
    from importlib.metadata import version

    expected = {
        "torch": "2.7.1", "torchvision": "0.22.1", "transformers": "5.20.2",
        "numpy": "2.2.6", "opencv-python-headless": "4.12.0.88", "Pillow": "12.0.0",
    }
    try:
        if any(version(name).split("+")[0] != value for name, value in expected.items()):
            return False
        import torch
        import torchvision
        import cv2
        from transformers import Sam3TrackerModel, Sam3TrackerProcessor
        return True
    except Exception:
        return False


def failure_message(error, stage):
    """Classify known indicators; never echo arbitrary provider text or URLs."""
    response = getattr(error, "response", None)
    status = getattr(response, "status_code", None)
    # Hub may keep the reason only in server_message, with an empty body.
    detail = (str(getattr(error, "server_message", "") or "") + " " +
              str(getattr(response, "text", "") or "")).lower()
    if status == 401:
        return ("Hugging Face odmítá HF_TOKEN (HTTP 401). Ověř platný token v .env.local "
                "nebo v shellu; hodnota v shellu má přednost. " + TOKEN_URL)
    if status == 403 and ("fine-grained" in detail or "public gated repositories" in detail):
        return ("Hugging Face zamítá oprávnění tokenu (HTTP 403). V nastavení fine-grained "
                "tokenu povol čtení facebook/sam3 a přístup k veřejným gated modelům, "
                "ke kterým má tvůj účet přístup. Schválení samotného modelu je také nutné. " + TOKEN_URL)
    if status == 403 and stage == "ověření tokenu":
        return "Hugging Face zamítá přihlášení tokenu (HTTP 403). Ověř jeho účet a oprávnění. " + TOKEN_URL
    if status == 403:
        return ("Stažení SAM 3 blokuje Hugging Face (HTTP 403). "
                "Účet použitého tokenu nemá povolené stažení facebook/sam3. "
                "Na " + MODEL_URL + " požádej o přístup a ověř jeho schválení pod stejným "
                "účtem, kterému patří HF_TOKEN. Samotné vytvoření tokenu přístup k modelu "
                "neuděluje. Pokud už přístup schválený je, ověř účet a oprávnění tokenu.")
    if status == 404:
        return "Soubor oficiálního modelu SAM 3 nebyl nalezen (HTTP 404). " + MODEL_URL
    if status is not None:
        return f"Hugging Face vrátil HTTP {status} při kroku „{stage}“. Zopakuj příkaz po vyřešení chyby služby."
    if isinstance(error, OSError) and error.errno == errno.ENOSPC:
        return "Pro váhy SAM 3 není dost místa na disku. Uvolni místo a zopakuj instalaci."
    if isinstance(error, OSError) and error.errno in (errno.EACCES, errno.EPERM):
        return "Do cílového adresáře SAM 3 nelze zapisovat. Ověř jeho oprávnění a SAM3_MODEL."
    if isinstance(error, IncompleteModelError):
        return "Stažení modelu SAM 3 není úplné nebo má neplatná metadata. Zopakuj npm run setup:sam3; chybějící soubory se doplní."
    return f"SAM 3: krok „{stage}“ se nedokončil. Ověř síť, dostupnost Hugging Face a místo na disku. Runtime zůstává zachovaný."


def download_model(directory, hub, check_access=False):
    token = hub.get_token()
    if not token:
        print("Chybí HF_TOKEN. Nastav ho v .env.local nebo se přihlas přes hf auth login. "
              "Účet musí mít schválený přístup na " + MODEL_URL, file=sys.stderr)
        return 1
    stage = "ověření tokenu"
    try:
        api = hub.HfApi(endpoint=ENDPOINT, token=token)
        api.whoami()
        print("Hugging Face token je platný.", flush=True)
        stage = "ověření přístupu k modelu"
        # Fail before the multi-GB download when approval/scope is missing.
        api.auth_check(MODEL, repo_type="model")
        print("Přístup k facebook/sam3 je ověřený.", flush=True)
        if check_access:
            print("Kontrola přístupu dokončena. Váhy se nestahovaly.")
            return 0
        stage = "stažení vah"
        hub.snapshot_download(MODEL, local_dir=str(directory), endpoint=ENDPOINT,
                              token=token, allow_patterns=["*.json", "*.safetensors"])
        # Reject incomplete sharded checkpoints instead of reporting readiness.
        if not model_files_ready(directory):
            raise IncompleteModelError()
        print("Model SAM 3 je stažený. Restartuj Vite a vyber SAM 3 v editoru masky.")
        return 0
    except Exception as error:
        print(failure_message(error, stage), file=sys.stderr)
        return 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path, nargs="?")
    parser.add_argument("--runtime-check", action="store_true")
    parser.add_argument("--check-access", action="store_true")
    args = parser.parse_args()
    if args.runtime_check:
        ready = runtime_ready()
        if not ready:
            print("Runtime SAM 3 má nekompatibilní nebo neúplné závislosti.", file=sys.stderr)
        return 0 if ready else 1
    if args.directory is None:
        parser.error("chybí cílový adresář")
    import huggingface_hub as hub
    return download_model(args.directory, hub, args.check_access)


if __name__ == "__main__":
    sys.exit(main())
