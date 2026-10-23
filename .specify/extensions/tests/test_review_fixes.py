"""Run native extension contracts in disposable projects, never this checkout.

Run: python3 -B -m unittest discover -s .specify/extensions/tests -v
"""

from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

EXTENSIONS = Path(__file__).resolve().parents[1]
START = "<!-- SPECKIT START -->"
END = "<!-- SPECKIT END -->"


class ScriptContracts(unittest.TestCase):
    def run_command(self, args, cwd):
        env = {
            key: value for key, value in os.environ.items()
            if not key.startswith(("GIT_", "SPECIFY_", "SPECKIT_"))
        }
        env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
        return subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=20)

    @contextmanager
    def project(self):
        with tempfile.TemporaryDirectory(prefix="speckit-review-") as directory:
            root = Path(directory) / "project"
            root.mkdir()
            for extension in ("git", "agent-context"):
                shutil.copytree(EXTENSIONS / extension, root / ".specify/extensions" / extension)
            yield root

    def script(self, root, runtime, extension, name):
        names = {
            "bash": ("bash", name + ".sh"),
            "python": (sys.executable, name.replace("-", "_") + ".py"),
            "powershell": ("pwsh", name + ".ps1"),
        }
        command, filename = names[runtime]
        path = root / ".specify/extensions" / extension / "scripts" / runtime / filename
        return [command, str(path)]

    def git(self, root, *args):
        result = self.run_command(["git", "-C", str(root), *args], root.parent)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def initialize(self, root):
        for args in [
            ("init", "-q"), ("config", "user.name", "Fixture"),
            ("config", "user.email", "fixture@example.com"),
            ("config", "commit.gpgsign", "false"),
            ("config", "core.hooksPath", os.devnull),
            ("add", "."), ("commit", "-qm", "initial"),
        ]:
            self.git(root, *args)

    def check_context(self, runtime):
        contents = [
            ("", True),
            ("notes\n", True),
            (f"before\n{START}\nold\n{END}\nafter\n", True),
            (f"before\r\n{START}\r\nprivate notes\r\n", False),
            (f"private notes\n{END}\nafter\n", False),
            (f"{END}\nnotes\n{START}\n", False),
            (f"{START}\n{START}\n{END}\n", False),
            (f"{START}\n{END}\n{END}\n", False),
        ]
        for content, valid in contents:
            with self.subTest(runtime=runtime, markers=content), self.project() as root:
                target = root / "AGENTS.md"
                target.write_bytes(content.encode())
                original = target.read_bytes()
                command = self.script(root, runtime, "agent-context", "update-agent-context")
                result = self.run_command([*command, "docs/specs/current/plan.md"], root)
                if valid:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    updated = target.read_text()
                    self.assertIn("docs/specs/current/plan.md", updated)
                    self.assertEqual(updated.count(START), 1)
                    self.assertEqual(updated.count(END), 1)
                    if content.startswith("before"):
                        self.assertTrue(updated.startswith("before\n"))
                        self.assertTrue(updated.endswith("after\n"))
                        self.assertNotIn("\nold\n", updated)
                    else:
                        self.assertTrue(updated.startswith(content))
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("malformed markers", result.stdout + result.stderr)
                    self.assertEqual(target.read_bytes(), original)

        # Exercise the documented defaults and feature-first discovery with no explicit plan.
        with self.project() as root:
            config = root / ".specify/extensions/agent-context/agent-context-config.yml"
            config.write_text("context_files: []\ncontext_file: ''\n")
            (root / ".specify/init-options.json").write_text(json.dumps({"integration": "codex"}))
            feature = root / "docs/specs/current"
            feature.mkdir(parents=True)
            (feature / "plan.md").write_text("current")
            (root / ".specify/feature.json").write_text(json.dumps({"feature_directory": "docs/specs/current"}))
            fallback = root / "specs/newest"
            fallback.mkdir(parents=True)
            (fallback / "plan.md").write_text("newer fallback")
            command = self.script(root, runtime, "agent-context", "update-agent-context")
            result = self.run_command(command, root)
            self.assertEqual(result.returncode, 0, result.stderr)
            target = root / "AGENTS.md"
            self.assertIn("docs/specs/current/plan.md", target.read_text())
            (feature / "plan.md").unlink()
            result = self.run_command(command, root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("specs/newest/plan.md", target.read_text())

        with self.project() as root:
            config = root / ".specify/extensions/agent-context/agent-context-config.yml"
            config.write_text("context_file: rules.mdc\n")
            target = root / "rules.mdc"
            target.write_text("---\nalwaysApply: false\n---\n\nnotes\n")
            result = self.run_command(self.script(root, runtime, "agent-context", "update-agent-context"), root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("alwaysApply: true", target.read_text())
            self.assertIn("notes", target.read_text())

    def check_auto_commit(self, runtime):
        cases = [
            ("false # default", "    enabled: TrUe # event\n", True, 0),
            ("true # default", "    enabled: false # event\n", False, 0),
            ("true # default", None, True, 0),
            ("true", "", False, 0),
            ("true", "    enabled: invalid\n", False, 1),
            ("invalid", "    enabled: true\n", False, 1),
            ("true", "    enabled:\n", False, 1),
            ("true#not-a-comment", None, False, 1),
        ]
        for default, event, committed, status in cases:
            with self.subTest(runtime=runtime, default=default, event=event), self.project() as root:
                config = "auto_commit:\n  default: " + default + "\n"
                if event is not None:
                    config += '  after_specify:\n' + event + '    message: "Fix #12"\n'
                (root / ".specify/extensions/git/git-config.yml").write_text(config.rstrip("\n"))
                self.initialize(root)
                before = self.git(root, "rev-parse", "HEAD")
                (root / "new.txt").write_text("keep me")
                command = self.script(root, runtime, "git", "auto-commit")
                result = self.run_command([*command, "after_specify"], root.parent)
                if status:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("booleans must be true or false", result.stdout + result.stderr)
                    self.assertEqual(self.git(root, "diff", "--cached", "--name-only"), "")
                else:
                    self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.git(root, "rev-parse", "HEAD") != before, committed)
                if committed:
                    message = self.git(root, "log", "-1", "--format=%s")
                    self.assertEqual(message, "Fix #12" if event is not None else "[Spec Kit] Auto-commit after specify")
                    self.assertEqual(self.git(root, "status", "--porcelain"), "")

        with self.project() as root:
            config = root / ".specify/extensions/git/git-config.yml"
            config.write_text('auto_commit:\n  default: true # worktree\n')
            self.initialize(root)
            worktree = root.parent / "linked"
            self.git(root, "worktree", "add", "-qb", "fixture", str(worktree))
            (worktree / "new.txt").write_text("linked checkout")
            command = self.script(worktree, runtime, "git", "auto-commit")
            result = self.run_command([*command, "after_specify"], root.parent)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.git(worktree, "status", "--porcelain"), "")
            self.assertEqual(self.git(root, "log", "-1", "--format=%s"), "initial")

    def check_contracts(self, runtime):
        self.check_context(runtime)
        self.check_auto_commit(runtime)

    def test_bash(self):
        self.check_contracts("bash")

    def test_python(self):
        self.check_contracts("python")

    @unittest.skipUnless(shutil.which("pwsh"), "PowerShell runtime is unavailable")
    def test_powershell(self):
        self.check_contracts("powershell")
        with self.project() as root:
            self.initialize(root)
            self.git(root, "branch", "007-existing")
            command = self.script(root, "powershell", "git", "create-new-feature-branch")
            result = self.run_command([*command, "-Json", "next feature"], root.parent)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.git(root, "branch", "--show-current"), "008-next-feature")


if __name__ == "__main__":
    unittest.main()
