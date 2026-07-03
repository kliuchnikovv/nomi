"""Tests that GitHubTools write operations resolve the repo owner.

With a GitHub App installation token the agent usually knows only the repo
name and guesses (or omits) the owner. ``create_pull_request``,
``create_branch`` and ``create_or_update_file`` previously used the given
``owner`` verbatim and 404'd on a wrong guess. They now route through
``_resolve_repo`` (like ``list_commits``), looking the repo up among the
installation's accessible repositories and using the authoritative owner.

The github plugin lives at repo-root ``plugins/github/server`` and is loaded
by the plugin loader at runtime, so we load it by file path (mirroring
``tests/tools/test_sandbox_git_auth.py``).
"""

import importlib.util
import os
import sys
import types

import pytest

_PLUGIN_DIR = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "plugins", "github", "server"
    )
)


def _load(mod_name: str, filename: str):
    spec = importlib.util.spec_from_file_location(
        mod_name, os.path.join(_PLUGIN_DIR, filename)
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


for _pkg in ("plugins", "plugins.github", "plugins.github.server"):
    sys.modules.setdefault(_pkg, types.ModuleType(_pkg))

tools = _load("plugins.github.server.tools", "tools.py")
GitHubTools = tools.GitHubTools


def _make_tools() -> tuple:
    """Return (GitHubTools, recorded_requests). Stubs network + repo listing.

    The repo "myrepo" is owned by the authoritative owner "realowner"; the
    caller passes the wrong/absent owner to prove resolution kicks in.
    """
    gh = GitHubTools(access_token="tok")
    requests: list[tuple[str, str, dict]] = []

    async def fake_make_request(method, endpoint, data=None):
        requests.append((method, endpoint, data))
        # Default-branch lookup: GET /repos/{owner}/{repo}
        if method == "GET" and endpoint.count("/") == 2:
            return {"default_branch": "main"}
        # Base-ref lookup for create_branch.
        if endpoint.endswith("/git/ref/heads/main"):
            return {"object": {"sha": "basesha"}}
        return {"ok": True}

    async def fake_list_repos(limit=30):
        return [{"name": "myrepo", "full_name": "realowner/myrepo"}]

    gh._make_request = fake_make_request  # type: ignore[assignment]
    gh.list_repos = fake_list_repos  # type: ignore[assignment]
    return gh, requests


@pytest.mark.asyncio
async def test_create_pull_request_resolves_owner():
    gh, requests = _make_tools()
    await gh.create_pull_request(
        owner="wrongowner", repo="myrepo", title="t", head="feature", base="main"
    )
    # The POST to open the PR must use the authoritative owner, not the guess.
    posts = [e for e in requests if e[0] == "POST"]
    assert posts, "expected a POST to create the PR"
    assert posts[-1][1] == "/repos/realowner/myrepo/pulls"


@pytest.mark.asyncio
async def test_create_branch_resolves_owner():
    gh, requests = _make_tools()
    await gh.create_branch(owner="wrongowner", repo="myrepo", branch="feature")
    posts = [e for e in requests if e[0] == "POST"]
    assert posts[-1][1] == "/repos/realowner/myrepo/git/refs"


@pytest.mark.asyncio
async def test_create_or_update_file_resolves_owner():
    gh, requests = _make_tools()
    await gh.create_or_update_file(
        owner="wrongowner",
        repo="myrepo",
        path="f.py",
        content="x",
        message="m",
        branch="feature",
    )
    puts = [e for e in requests if e[0] == "PUT"]
    assert puts[-1][1] == "/repos/realowner/myrepo/contents/f.py"


@pytest.mark.asyncio
async def test_owner_omitted_is_resolved():
    """owner="" (agent didn't know it) still resolves via the listing."""
    gh, requests = _make_tools()
    await gh.create_pull_request(
        owner="", repo="myrepo", title="t", head="feature", base="main"
    )
    posts = [e for e in requests if e[0] == "POST"]
    assert posts[-1][1] == "/repos/realowner/myrepo/pulls"
