"""Installer regression tests: mocks only, no network or model downloads."""
import contextlib
import errno
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

sys.path.insert(0, "scripts/segmentation")
from setup_sam3 import download_model, failure_message, model_files_ready

SECRET = "hf_private_test_credential"


def error(status, reason=""):
    result = Exception("must not echo exception: " + SECRET)
    result.response = SimpleNamespace(status_code=status, text="")
    result.server_message = reason + " " + SECRET
    return result


class SetupTests(unittest.TestCase):
    def hub(self):
        api = SimpleNamespace(whoami=Mock(), auth_check=Mock())
        return SimpleNamespace(get_token=Mock(return_value=SECRET),
                               HfApi=Mock(return_value=api), snapshot_download=Mock())

    def run_download(self, directory, hub, check=False):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = download_model(directory, hub, check)
        text = out.getvalue() + err.getvalue()
        self.assertNotIn(SECRET, text)
        self.assertNotIn("Traceback", text)
        return code, text

    def test_missing_token_never_starts_requests(self):
        hub = self.hub()
        hub.get_token.return_value = None
        code, text = self.run_download(Path("unused"), hub)
        self.assertEqual(code, 1)
        self.assertIn("Chybí HF_TOKEN", text)
        hub.HfApi.assert_not_called()

    def test_invalid_token_and_gated_access_have_different_errors(self):
        for status, target, reason, expected in [
            (401, "whoami", "invalid", "HTTP 401"),
            (403, "auth_check", "not in the authorized list", "požádej o přístup"),
            (403, "auth_check", "enable public gated repositories in fine-grained token", "oprávnění tokenu"),
        ]:
            with self.subTest(status=status, reason=reason):
                hub = self.hub()
                getattr(hub.HfApi.return_value, target).side_effect = error(status, reason)
                code, text = self.run_download(Path("unused"), hub)
                self.assertEqual(code, 1)
                self.assertIn(expected, text)
                hub.snapshot_download.assert_not_called()

    def test_check_access_never_downloads_weights(self):
        hub = self.hub()
        code, text = self.run_download(Path("unused"), hub, check=True)
        self.assertEqual(code, 0)
        self.assertIn("Kontrola přístupu dokončena", text)
        hub.HfApi.assert_called_once_with(endpoint="https://huggingface.co", token=SECRET)
        hub.HfApi.return_value.auth_check.assert_called_once_with("facebook/sam3", repo_type="model")
        hub.snapshot_download.assert_not_called()

    def test_incomplete_download_is_not_reported_as_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "config.json").write_text('{}')
            hub = self.hub()
            code, text = self.run_download(directory, hub)
            self.assertEqual(code, 1)
            self.assertIn("není úplné", text)
            self.assertFalse(model_files_ready(directory))
            (directory / "model.safetensors").write_bytes(b'test-mock-checkpoint')
            code, text = self.run_download(directory, hub)
            self.assertEqual(code, 0)
            self.assertIn("Model SAM 3 je stažený", text)
            kwargs = hub.snapshot_download.call_args.kwargs
            self.assertEqual(kwargs["allow_patterns"], ["*.json", "*.safetensors"])

    def test_shards_must_all_exist_and_stay_inside_model_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "config.json").write_text('{}')
            index = directory / "model.safetensors.index.json"
            index.write_text(json.dumps({"weight_map": {"a": "a.safetensors", "b": "b.safetensors"}}))
            (directory / "a.safetensors").write_bytes(b'test-a')
            self.assertFalse(model_files_ready(directory))
            (directory / "b.safetensors").write_bytes(b'test-b')
            self.assertTrue(model_files_ready(directory))
            (directory / "b.safetensors").write_bytes(b'')
            self.assertFalse(model_files_ready(directory))
            index.write_text(json.dumps({"weight_map": {"a": "../outside.safetensors"}}))
            self.assertFalse(model_files_ready(directory))
            index.write_text('not json')
            self.assertFalse(model_files_ready(directory))
            for metadata in [[], {"weight_map": []}, {"weight_map": {}}]:
                index.write_text(json.dumps(metadata))
                self.assertFalse(model_files_ready(directory))

    def test_network_and_disk_errors_do_not_masquerade_as_account_errors(self):
        for exc, expected in [(error(503), "HTTP 503"),
                              (TimeoutError(SECRET), "Ověř síť"),
                              (OSError(errno.ENOSPC, SECRET), "místa na disku"),
                              (OSError(errno.EACCES, SECRET), "nelze zapisovat")]:
            text = failure_message(exc, "stažení vah")
            self.assertIn(expected, text)
            self.assertNotIn(SECRET, text)
            self.assertNotIn("požádej o přístup", text)


if __name__ == "__main__":
    unittest.main()
