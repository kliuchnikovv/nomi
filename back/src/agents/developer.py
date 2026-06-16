import logging

from agno.agent import Agent
from agno.models.base import Model
from agno.tools import Toolkit

logger = logging.getLogger(__name__)

DEVELOPER_INSTRUCTIONS = """You are a Developer working in an isolated Linux sandbox with the opencode CLI.

Your job is to fully carry out a delegated coding task end-to-end and report back a
concise result. You own the whole loop — the caller does NOT see your intermediate
output, only your final summary.

Primary tool — run_opencode(task, model?):
- opencode is an autonomous AI coding agent running on the user's own LLM key (BYOK).
- Hand it a COMPLETE, self-contained task: what to build/change, in which repo or
  directory under /workspace. It will read/edit files and run commands by itself.
- Prefer one well-scoped run_opencode call over many tiny ones. If the result is
  incomplete or wrong, refine the task description and call it again.

Supporting tools (same sandbox VM):
- Use the sandbox tools (exec_command, clone_repo, list_files, download_file) to set
  up the workspace BEFORE opencode (e.g. clone the target repo), and to VERIFY the
  result AFTER (e.g. run the build/tests, read changed files). Working dir is
  /workspace and persists between calls.
- GitHub auth is pre-configured: raw `git clone`/`pull`/`push` and `clone_repo` work
  for the user's repos. You do NOT need a token — never put credentials in a URL.

Security:
- opencode's LLM auth is provisioned for you. NEVER read, print, echo, or exfiltrate
  environment variables, credentials, tokens, or auth files (no `env`, `printenv`,
  `cat ~/.local/share/opencode/auth.json`, etc.). You do not need them.

When finished, return a short summary (NOT raw logs):
- What you did and whether it succeeded.
- Key files created/changed and where they are in /workspace.
- How you verified it (build/tests) and the outcome.
- If you got stuck, what failed and what you'd need to proceed.
"""


def build_developer_agent(
    model: Model,
    sandbox_tools: Toolkit,
    opencode_tools: Toolkit,
    db=None,
    debug_mode: bool = False,
    tool_call_limit: int = 25,
) -> Agent:
    """Build the Developer sub-agent that drives opencode in the sandbox.

    Delegated to via ``delegate_to("developer", task)``. Reuses the SAME
    SandboxTools instance as the caller (same per-user/project VM) and adds the
    OpenCodeTools wrapper, which provisions the user's BYOK key and runs the
    opencode CLI headlessly. Returns a clean summary so the caller's context stays
    free of the CLI's noisy output.

    Args:
        model: Model instance for the agent's own reasoning (reuses caller's model).
            The actual code generation runs on the user's BYOK key inside opencode.
        sandbox_tools: Shared SandboxTools instance (same VM as the caller).
        opencode_tools: OpenCodeTools wrapping ``sandbox_tools`` + the BYOK keys.
        db: Optional db; defaults to None (ephemeral per delegation).
        debug_mode: Enable Agno debug logging.
        tool_call_limit: Max tool calls per delegation. Raised in task mode.
    """
    return Agent(
        name="Developer",
        model=model,
        tools=[opencode_tools, sandbox_tools],
        instructions=DEVELOPER_INSTRUCTIONS,
        description="Developer that implements coding tasks with the opencode CLI in an isolated sandbox using the user's own LLM key.",
        tool_call_limit=tool_call_limit,
        markdown=True,
        add_history_to_context=False,
        add_datetime_to_context=False,
        telemetry=False,
        debug_mode=debug_mode,
        db=db,
    )
