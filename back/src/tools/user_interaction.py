from typing import Any

from agno.tools import Toolkit
from agno.utils.log import logger


class UserInteractionTools(Toolkit):
    """Tools for interacting with the user (asking questions, polls, etc.)."""

    def __init__(self):
        super().__init__(name="user_interaction")
        self.client_tool_runner: Any = None
        self.register(self.ask_user)

    async def ask_user(
        self,
        question: str,
        options: list[str],
    ) -> str:
        """Ask the user a question with predefined options and custom text input.

        Use this tool when you need clarification, preferences, or specific input from the user.
        The user will see a modal dialog with:
        - The question text
        - Predefined option buttons (one-click selection)
        - A text input field for custom answers (always available)

        Args:
            question (str): The question to ask the user. Be clear and concise.
            options (list[str]): List of predefined answer options. Provide 3-5 relevant options.
                                The user can select one or type their own answer.

        Returns:
            str: The user's response - either a selected option or custom text.

        Examples:
            >>> await ask_user("What type of task is this?", ["bug", "feature", "improvement", "documentation"])
            >>> await ask_user("Which programming language should I use?", ["Python", "JavaScript", "Go", "Other"])
        """
        if not self.client_tool_runner:
            logger.warning("[UserInteraction] client_tool_runner not available")
            return "Error: Cannot ask user - client_tool_runner not available"

        logger.info(
            f"[UserInteraction] Asking user: question='{question}', options={options}"
        )

        params = {
            "question": question,
            "options": options,
            "allow_custom": True,  # Always enabled per user preference
        }

        try:
            result = await self.client_tool_runner("ask_user", "ask", params)
            logger.info(f"[UserInteraction] User responded: {result}")
            return result
        except Exception as e:
            logger.error(
                f"[UserInteraction] Failed to get user response: {e}",
                exc_info=True,
            )
            return f"Error: Failed to get user response: {str(e)}"
