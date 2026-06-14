from __future__ import annotations

import logging
from typing import Awaitable, Callable

from agno.tools import Toolkit

logger = logging.getLogger(__name__)

TaskSpawner = Callable[[str], Awaitable[str]]


class BackgroundTaskTools(Toolkit):
    """Lets the lead agent hand substantial, multi-step work to an autonomous
    background runner.

    Unlike ``delegate_to`` (which blocks the turn until the sub-agent returns a
    summary), ``start_background_task`` returns immediately: the work then runs
    on its own, survives the chat turn, and streams progress to the Tasks screen.
    """

    def __init__(self, spawner: TaskSpawner):
        super().__init__(name="background_tasks")
        self._spawner = spawner
        self.add_instructions = True
        self.instructions = (
            "You have start_background_task(goal). Use it whenever the user asks for "
            "substantial, multi-step work — especially anything that needs the "
            "sandbox (code, files, the shell) for more than a couple of steps, or "
            "that would take longer than a single reply to finish. Examples: "
            "'clone my repo, fix the failing tests, and open a PR'; 'analyze this "
            "whole codebase and write an architecture report'; 'go through every "
            "file in src/ and summarize it'; 'build and run the project, then "
            "report what broke'. It returns immediately with a task id; the work "
            "then proceeds on its own and the user can watch progress and steer it "
            "on the Tasks screen. Pass a complete, self-contained goal in `goal`. "
            "Do NOT start the work inline yourself when it fits this description — "
            "hand it to start_background_task instead. Only handle quick answers or "
            "a single tool call directly."
        )
        self.register(self.start_background_task)

    async def start_background_task(self, goal: str) -> str:
        """Start a long-running autonomous background task.

        Args:
            goal: A complete, self-contained description of the work to carry out.

        Returns:
            A confirmation message including the task id.
        """
        try:
            task_id = await self._spawner(goal)
        except Exception as exc:  # noqa: BLE001
            logger.error("[BackgroundTask] Failed to start task: %s", exc, exc_info=True)
            return f"Failed to start the background task: {exc}"
        return (
            f"Started background task {task_id}. I'll work on it autonomously — "
            "follow the progress on the Tasks screen."
        )
