import copy
import hashlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("updater", Path(__file__).parents[1] / "update-homebrew-cask.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)

CASK = '''cask "swaggy" do
  version "0.1.0"
  sha256 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

  url "https://github.com/k4rmakoma0/swaggy-edit/releases/download/v#{version}/Swaggy_#{version}_universal.dmg"
  name "Swaggy"
  app "Swaggy.app", target: "Swaggy Edit.app"
end
'''


class UpdateTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.cask = Path(directory.name) / "swaggy.rb"
        self.cask.write_text(CASK)
        self.name = "Swaggy_0.2.0_universal.dmg"
        self.payload = b"fixture for the final notarized DMG"
        self.checksum = hashlib.sha256(self.payload).hexdigest()
        self.payloads = {
            self.name: self.payload,
            "SHA256SUMS.txt": f"{self.checksum}  {self.name}\n".encode(),
        }
        self.release = {"id": 2, "tag_name": "v0.2.0", "draft": False, "prerelease": False, "assets": []}
        self.refresh_assets()
        network = patch.object(updater, "urlopen", side_effect=self.respond)
        self.network = network.start()
        self.addCleanup(network.stop)
        verifier = patch.object(updater.subprocess, "run")
        self.verifier = verifier.start()
        self.addCleanup(verifier.stop)

    def refresh_assets(self):
        self.release["assets"] = [
            {
                "name": name,
                "state": "uploaded",
                "size": len(data),
                "digest": "sha256:" + hashlib.sha256(data).hexdigest(),
                "browser_download_url": f"https://github.com/{updater.REPOSITORY}/releases/download/v0.2.0/{name}",
            }
            for name, data in self.payloads.items()
        ]

    def respond(self, request, timeout):
        self.assertEqual(timeout, 60)
        self.assertNotIn("Authorization", request.headers)
        return io.BytesIO(self.payloads[request.full_url.rsplit("/", 1)[-1]])

    def update(self):
        return updater.update_cask(self.cask, self.release, self.release)

    def test_updates_only_version_and_checksum_after_verifying_package(self):
        self.assertTrue(self.update())
        expected = CASK.replace('version "0.1.0"', 'version "0.2.0"').replace("a" * 64, self.checksum)
        self.assertEqual(self.cask.read_text(), expected)
        self.assertEqual(self.verifier.call_count, 3)
        self.assertEqual(self.verifier.call_args_list[1].args[0][:3], ["xcrun", "stapler", "validate"])

    def test_repeated_run_is_idempotent(self):
        self.assertTrue(self.update())
        first = self.cask.read_bytes()
        self.assertFalse(self.update())
        self.assertEqual(self.cask.read_bytes(), first)

    def test_drafts_and_prereleases_never_update(self):
        for field in ("draft", "prerelease"):
            release = copy.deepcopy(self.release)
            release[field] = True
            with self.subTest(field=field), self.assertRaises(ValueError):
                updater.update_cask(self.cask, release, release)
        self.network.assert_not_called()
        self.assertEqual(self.cask.read_text(), CASK)

    def test_out_of_order_release_is_skipped(self):
        self.assertFalse(updater.update_cask(self.cask, self.release, {"id": 3}))
        self.network.assert_not_called()
        self.assertEqual(self.cask.read_text(), CASK)

    def test_downgrades_and_unsupported_versions_are_rejected(self):
        for version in ("0.0.9", "0.2.0-beta.1", "01.2.0", "0.2.0; echo unsafe"):
            with self.subTest(version=version), self.assertRaises(ValueError):
                updater.render_cask(CASK, version, self.checksum)
        self.assertEqual(self.cask.read_text(), CASK)

    def test_missing_duplicate_or_unuploaded_assets_are_rejected(self):
        for assets in ([], self.release["assets"] * 2, [{**self.release["assets"][0], "state": "new"}]):
            release = {**self.release, "assets": assets}
            with self.subTest(assets=assets), self.assertRaises(ValueError):
                updater.update_cask(self.cask, release, release)
        self.network.assert_not_called()

    def test_unexpected_download_host_is_rejected(self):
        self.release["assets"][0]["browser_download_url"] = "https://example.org/Swaggy.dmg"
        with self.assertRaises(ValueError):
            self.update()
        self.network.assert_not_called()

    def test_tampered_download_is_rejected_before_cask_changes(self):
        self.payloads[self.name] = b"x" * len(self.payload)
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            self.update()
        self.verifier.assert_not_called()
        self.assertEqual(self.cask.read_text(), CASK)

    def test_stale_checksum_manifest_is_rejected(self):
        self.payloads["SHA256SUMS.txt"] = f"{'0' * 64}  {self.name}\n".encode()
        self.refresh_assets()
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.update()
        self.verifier.assert_not_called()
        self.assertEqual(self.cask.read_text(), CASK)

    def test_failed_signature_or_notarization_leaves_cask_unchanged(self):
        self.verifier.side_effect = [None, subprocess.CalledProcessError(1, "stapler")]
        with self.assertRaises(subprocess.CalledProcessError):
            self.update()
        self.assertEqual(self.cask.read_text(), CASK)

    def test_changed_cask_url_requires_manual_review(self):
        self.cask.write_text(CASK.replace("_universal.dmg", "_arm64.zip"))
        with self.assertRaisesRegex(ValueError, "naming changed"):
            self.update()
        self.network.assert_not_called()


if __name__ == "__main__":
    unittest.main()
