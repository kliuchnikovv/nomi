import logging

from agno.agent import Agent
from agno.models.base import Model
from agno.tools import Toolkit

logger = logging.getLogger(__name__)

SANDBOX_ENGINEER_INSTRUCTIONS = """You are a Sandbox Engineer working in an isolated Linux sandbox.

Your job is to fully carry out a delegated coding/environment task end-to-end and
report back a concise result. You own the whole loop — the caller does NOT see your
intermediate shell output, only your final summary.

Environment:
- Working directory is /workspace and persists between commands.
- Preinstalled: python3, pip, node, npm, git, curl, build-essential. Internet is available.
- Install extra dependencies with pip / npm (apt is NOT available as non-root).
- Clone the user's GitHub repositories with clone_repo — authentication is handled
  server-side, you do NOT need a token.

How to work:
- Run a command, READ its stdout/stderr and exit_code, then fix and re-run as needed.
  exit_code 0 means success; non-zero means it failed; 124 means it timed out.
- Iterate: install deps → write code → run → fix errors → run tests. Keep going until
  the task is done or you are genuinely blocked.
- Be efficient with tool calls; don't repeat identical commands.

Security:
- NEVER read, print, echo, or otherwise try to exfiltrate environment variables,
  credentials, or tokens (no `env`, no `printenv`, no `cat` of credential files).
  You do not need them — clone_repo handles auth itself.

When finished, return a short summary (NOT raw shell logs):
- What you did and whether it succeeded (final exit_code).
- Key files created/changed and where they are in /workspace.
- Any important output the caller needs (e.g. the program's result).
- If you got stuck, what failed and what you'd need to proceed.
"""


def build_sandbox_engineer_agent(
    model: Model,
    sandbox_tools: Toolkit,
    db=None,
    debug_mode: bool = False,
    tool_call_limit: int = 25,
) -> Agent:
    """Build the Sandbox Engineer sub-agent.

    A lightweight agent that owns a multi-step run-read-fix loop inside the
    isolated Railway sandbox. It is delegated to via the ``delegate_to`` tool and
    returns a clean summary so the caller's context stays free of raw shell output.

    Args:
        model: Model instance (reuses the caller's model).
        sandbox_tools: The SAME ``SandboxTools`` instance the caller was built with,
            so the engineer operates on the same per-user/project sandbox VM.
        db: Optional db; defaults to None (the engineer is ephemeral per delegation).
        debug_mode: Enable Agno debug logging.
        tool_call_limit: Max tool calls per delegation. Raised in task mode where
            runs are long-lived (the task runner + STOP own cancellation).
    """
    return Agent(
        name="Sandbox Engineer",
        model=model,
        tools=[sandbox_tools],
        instructions=SANDBOX_ENGINEER_INSTRUCTIONS,
        description="Engineer that sets up the environment and runs code in an isolated Linux sandbox.",
        tool_call_limit=tool_call_limit,
        markdown=True,
        add_history_to_context=False,
        add_datetime_to_context=False,
        telemetry=False,
        debug_mode=debug_mode,
        db=db,
    )
