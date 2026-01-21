from typing import List, Dict
from agno.tools import Toolkit


class ClientUITools(Toolkit):
    def __init__(self):
        super().__init__(name="ui_client")
        self.register(self.show_poll)
        self.register(self.show_buttons)

    def show_poll(
        self, question: str, options: List[str], allow_multiple: bool = False
    ) -> str:
        """
        Displays an interactive poll to the user.
        Use this tool when you want to ask the user to choose from a list of options.
        The user's selection will be sent back as a message.

        Args:
            question: The question to ask.
            options: A list of text options for the user to choose from.
            allow_multiple: Whether to allow selecting multiple options (default: False).
        """
        # The frontend will intercept this tool call and render the UI.
        return (
            f"UI Request: Showing poll '{question}' with options: {', '.join(options)}"
        )

    def show_buttons(self, text: str, buttons: List[Dict[str, str]]) -> str:
        """
        Displays a set of action buttons below a text message.
        Use this for quick replies or specific actions.

        Args:
            text: The text to display above the buttons.
            buttons: A list of dictionaries, where each dict has 'label' (text on button) and 'value' (text to send back).
                     Example: [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]
        """
        # The frontend will intercept this tool call and render the UI.
        return f"UI Request: Showing buttons for '{text}'"
