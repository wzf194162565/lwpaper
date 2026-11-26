"""Bounded retries for transient Windows file replacement failures."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class VaultRetryTest(unittest.TestCase):
    def test_transient_persistent_unrelated_and_interrupted_file_operations(self):
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(['javac', '-encoding', 'UTF-8', '--release', '17', '-d', directory,
                            *map(str, (ROOT / 'src').glob('*.java')),
                            str(ROOT / 'tests/VaultRetryFixture.java')], check=True, capture_output=True)
            subprocess.run(['java', '-cp', directory, 'VaultRetryFixture'], check=True, capture_output=True, timeout=10)
