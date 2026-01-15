from typing import Optional, List, Literal
import subprocess
import os
from agno.tools import Toolkit
from agno.utils.log import logger


class GitTools(Toolkit):
    def __init__(self, repo_path: str = ".", allow_destructive: bool = False):
        super().__init__(name="git_tools")
        self.repo_path = os.path.abspath(repo_path)
        self.allow_destructive = allow_destructive

        self.register(self.status)
        self.register(self.diff)
        self.register(self.log)
        self.register(self.branch_list)
        self.register(self.branch_current)
        self.register(self.checkout)
        self.register(self.add)
        self.register(self.commit)
        self.register(self.push)
        self.register(self.pull)
        self.register(self.fetch)
        self.register(self.stash)
        self.register(self.show)
        self.register(self.merge)
        if allow_destructive:
            self.register(self.reset)

    def _run(self, args: List[str], check: bool = True) -> str:
        try:
            result = subprocess.run(
                ["git"] + args,
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                check=check,
            )
            return result.stdout.strip() or result.stderr.strip()
        except subprocess.CalledProcessError as e:
            logger.error(f"Git command failed: git {' '.join(args)}")
            return f"Error: {e.stderr.strip() or str(e)}"
        except Exception as e:
            logger.error(f"Git command error: {e}")
            return f"Error: {str(e)}"

    def status(self) -> str:
        """
        Shows the working tree status. Returns staged, unstaged, and untracked files.

        Returns:
            str: Output of `git status`.
        """
        return self._run(["status"])

    def diff(self, file: Optional[str] = None, staged: bool = False) -> str:
        """
        Shows changes between commits, commit and working tree, etc.

        Args:
            file: Optional file path to show diff for.
            staged: If True, show staged changes (--cached).

        Returns:
            str: Output of `git diff`.
        """
        args = ["diff"]
        if staged:
            args.append("--cached")
        if file:
            args.extend(["--", file])
        return self._run(args)

    def log(self, n: int = 10, oneline: bool = True) -> str:
        """
        Shows commit logs.

        Args:
            n: Number of commits to show (default: 10).
            oneline: If True, show each commit on a single line.

        Returns:
            str: Output of `git log`.
        """
        args = ["log", f"-{n}"]
        if oneline:
            args.append("--oneline")
        return self._run(args)

    def branch_list(self, all_branches: bool = False) -> str:
        """
        Lists branches.

        Args:
            all_branches: If True, list remote branches too (-a).

        Returns:
            str: List of branches.
        """
        args = ["branch"]
        if all_branches:
            args.append("-a")
        return self._run(args)

    def branch_current(self) -> str:
        """
        Returns the name of the current branch.

        Returns:
            str: Current branch name.
        """
        return self._run(["rev-parse", "--abbrev-ref", "HEAD"])

    def checkout(self, branch: str, create: bool = False) -> str:
        """
        Switches branches or restores working tree files.

        Args:
            branch: Branch name to checkout.
            create: If True, create the branch (-b).

        Returns:
            str: Result of checkout operation.
        """
        args = ["checkout"]
        if create:
            args.append("-b")
        args.append(branch)
        return self._run(args)

    def add(self, files: str = ".") -> str:
        """
        Adds file contents to the staging area.

        Args:
            files: File path(s) to add. Use "." for all files.

        Returns:
            str: Result of add operation.
        """
        args = ["add"]
        if isinstance(files, list):
            args.extend(files)
        else:
            args.append(files)
        return self._run(args) or "Files staged successfully."

    def commit(self, message: str) -> str:
        """
        Records changes to the repository.

        Args:
            message: Commit message.

        Returns:
            str: Result of commit operation.
        """
        if not message:
            return "Error: Commit message is required."
        return self._run(["commit", "-m", message])

    def push(self, remote: str = "origin", branch: Optional[str] = None, force: bool = False) -> str:
        """
        Updates remote refs along with associated objects.

        Args:
            remote: Remote name (default: origin).
            branch: Branch name. If None, pushes current branch.
            force: If True, force push (requires allow_destructive=True).

        Returns:
            str: Result of push operation.
        """
        if force and not self.allow_destructive:
            return "Error: Force push is disabled. Set allow_destructive=True to enable."

        args = ["push", remote]
        if branch:
            args.append(branch)
        if force:
            args.append("--force")
        return self._run(args)

    def pull(self, remote: str = "origin", branch: Optional[str] = None) -> str:
        """
        Fetches from and integrates with another repository or a local branch.

        Args:
            remote: Remote name (default: origin).
            branch: Branch name to pull.

        Returns:
            str: Result of pull operation.
        """
        args = ["pull", remote]
        if branch:
            args.append(branch)
        return self._run(args)

    def fetch(self, remote: str = "origin", prune: bool = False) -> str:
        """
        Downloads objects and refs from another repository.

        Args:
            remote: Remote name (default: origin).
            prune: If True, remove any remote-tracking references that no longer exist.

        Returns:
            str: Result of fetch operation.
        """
        args = ["fetch", remote]
        if prune:
            args.append("--prune")
        return self._run(args) or "Fetch completed successfully."

    def stash(self, operation: Literal["push", "pop", "list", "drop"] = "push", message: Optional[str] = None) -> str:
        """
        Stashes changes in a working directory.

        Args:
            operation: Stash operation - push, pop, list, or drop.
            message: Optional message for stash push.

        Returns:
            str: Result of stash operation.
        """
        args = ["stash", operation]
        if operation == "push" and message:
            args.extend(["-m", message])
        return self._run(args)

    def show(self, ref: str = "HEAD") -> str:
        """
        Shows various types of objects (commits, tags, etc.).

        Args:
            ref: Reference to show (default: HEAD).

        Returns:
            str: Output of `git show`.
        """
        return self._run(["show", ref, "--stat"])

    def merge(self, branch: str, no_ff: bool = False, message: Optional[str] = None) -> str:
        """
        Joins two or more development histories together.

        Args:
            branch: Branch to merge into current branch.
            no_ff: If True, create a merge commit even for fast-forward merges.
            message: Optional merge commit message.

        Returns:
            str: Result of merge operation.
        """
        args = ["merge", branch]
        if no_ff:
            args.append("--no-ff")
        if message:
            args.extend(["-m", message])
        return self._run(args)

    def reset(self, mode: Literal["soft", "mixed", "hard"] = "mixed", ref: str = "HEAD~1") -> str:
        """
        Resets current HEAD to the specified state.
        WARNING: This is a destructive operation. Requires allow_destructive=True.

        Args:
            mode: Reset mode - soft, mixed, or hard.
            ref: Reference to reset to (default: HEAD~1).

        Returns:
            str: Result of reset operation.
        """
        if not self.allow_destructive:
            return "Error: Reset is disabled. Set allow_destructive=True to enable."
        return self._run(["reset", f"--{mode}", ref])
