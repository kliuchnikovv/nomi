import logging
from typing import Any, Dict, List, Optional
from contextvars import ContextVar
from pydantic import BaseModel, Field

from agno.tools import Toolkit

logger = logging.getLogger(__name__)

class ClientAction(BaseModel):
    tool: str = Field(..., description="Name of the tool (e.g. 'gmail')")
    method: str = Field(..., description="Method to execute (e.g. 'send_email')")
    params: Dict[str, Any] = Field(default_factory=dict, description="Parameters for the method")
    description: str = Field(..., description="Human readable description")

# Context-local storage for actions
_client_actions: ContextVar[List[ClientAction]] = ContextVar("client_actions", default=[])

def start_action_tracking():
    """Initialize a fresh list of actions for the current context.
    Must be called at the start of a request/agent run.
    """
    _client_actions.set([])

def add_client_action(tool: str, method: str, params: Dict[str, Any], description: str):
    """Record a client-side action."""
    # Ensure we have a list in the current context, if not (e.g. testing), create one but warn
    try:
        actions = _client_actions.get()
    except LookupError:
        actions = []
        _client_actions.set(actions)
        
    action = ClientAction(tool=tool, method=method, params=params, description=description)
    actions.append(action)
    logger.info(f"[ClientSide] Recorded action: {tool}.{method} - {description}")

def get_client_actions() -> List[ClientAction]:
    """Retrieve recorded actions."""
    try:
        return _client_actions.get()
    except LookupError:
        return []


class ClientGmailTools(Toolkit):
    def __init__(self):
        super().__init__(name="gmail_client")
        self.register(self.send_email)
        self.register(self.get_recent_emails)
        self.register(self.search_emails)
        self.register(self.get_email)
        self.register(self.reply_email)
        self.register(self.create_draft)
    
    def send_email(self, to: str, subject: str, body: str) -> str:
        """Sends an email to the specified recipient.
        
        Args:
            to: Email address of the recipient
            subject: Subject line of the email
            body: Body text of the email
        """
        add_client_action(
            tool="gmail",
            method="send_email",
            params={"to": to, "subject": subject, "body": body},
            description=f"Send email to {to}"
        )
        return f"Action delegated: Sending email to {to} with subject '{subject}'. The client application will execute this."

    def get_recent_emails(self, limit: int = 5) -> str:
        """Fetches the most recent emails from the user's inbox.
        
        Args:
            limit: Number of emails to fetch (default: 5)
        """
        add_client_action(
            tool="gmail",
            method="get_recent_emails",
            params={"limit": limit},
            description=f"Fetch last {limit} emails"
        )
        return f"Action delegated: Fetching last {limit} emails. The client application will display them."

    def search_emails(self, query: str, max_results: int = 10) -> str:
        """Searches for emails matching the query.
        
        Args:
            query: The search query (e.g., 'from:boss', 'subject:meeting')
            max_results: Maximum number of results to return (default: 10)
        """
        add_client_action(
            tool="gmail",
            method="search_emails",
            params={"query": query, "max_results": max_results},
            description=f"Search emails: '{query}'"
        )
        return f"Action delegated: Searching emails for '{query}'. The client application will display the results."

    def get_email(self, message_id: str) -> str:
        """Gets the full content of a specific email.
        
        Args:
            message_id: The ID of the message to retrieve.
        """
        add_client_action(
            tool="gmail",
            method="get_email",
            params={"message_id": message_id},
            description=f"Read email {message_id}"
        )
        return f"Action delegated: Reading email {message_id}. The client application will display the content."

    def reply_email(self, message_id: str, body: str) -> str:
        """Replies to a specific email.
        
        Args:
            message_id: The ID of the message to reply to.
            body: The body of the reply.
        """
        add_client_action(
            tool="gmail",
            method="reply_email",
            params={"message_id": message_id, "body": body},
            description=f"Reply to email {message_id}"
        )
        return f"Action delegated: Replying to email {message_id}. The client application will execute this."

    def create_draft(self, to: str, subject: str, body: str) -> str:
        """Creates a draft email.
        
        Args:
            to: Recipient email address.
            subject: Email subject.
            body: Email body.
        """
        add_client_action(
            tool="gmail",
            method="create_draft",
            params={"to": to, "subject": subject, "body": body},
            description=f"Create draft to {to}"
        )
        return f"Action delegated: Creating draft email to {to}. The client application will execute this."


class ClientCalendarTools(Toolkit):
    def __init__(self):
        super().__init__(name="calendar_client")
        self.register(self.create_event)
        self.register(self.list_events)
        self.register(self.update_event)
        self.register(self.delete_event)

    def create_event(self, title: str, start_time: str, end_time: str = "", description: str = "", attendees: List[str] = [], timezone: str = "") -> str:
        """Schedules a meeting/event on the calendar.

        Args:
            title: Title of the event
            start_time: Start time in ISO format (e.g. '2023-10-27T10:00:00'). Agent must calculate this from relative time (e.g. 'in 1 hour') using the Current User Time.
            end_time: End time in ISO format. If not provided, defaults to 30 minutes after start_time.
            description: Description of the event
            attendees: List of email addresses of attendees
            timezone: Optional timezone for the event (e.g. 'America/New_York'). If not provided, recipient's local time will be used.
        """
        add_client_action(
            tool="calendar",
            method="create_event",
            params={
                "title": title,
                "start": start_time,
                "end": end_time,
                "description": description,
                "attendees": attendees,
                "timezone": timezone
            },
            description=f"Schedule event '{title}'"
        )
        return f"Action delegated: Scheduling event '{title}' from {start_time} to {end_time}. The client application will execute this."

    def list_events(self, start_time: str = "", end_time: str = "", max_results: int = 10) -> str:
        """Lists events from the calendar. Use this tool BEFORE updating or deleting events to get their IDs.
        
        Args:
            start_time: Start time in ISO format. Defaults to now.
            end_time: End time in ISO format. Defaults to 30 days from now.
            max_results: Maximum number of events to return.
        """
        add_client_action(
            tool="calendar",
            method="list_events",
            params={
                "start_time": start_time,
                "end_time": end_time,
                "max_results": max_results
            },
            description=f"List calendar events"
        )
        return "Action delegated: Listing calendar events. The client application will display them."

    def update_event(self, event_id: str, title: str = "", start_time: str = "", end_time: str = "", description: str = "", attendees: List[str] = [], timezone: str = "") -> str:
        """Updates an existing calendar event.
        
        Args:
            event_id: The ID of the event to update. IMPORTANT: This must be the actual event ID returned by 'list_events', NOT the event title.
            title: New title (optional).
            start_time: New start time ISO (optional).
            end_time: New end time ISO (optional).
            description: New description (optional).
            attendees: New list of attendees (optional).
            timezone: New timezone (optional).
        """
        add_client_action(
            tool="calendar",
            method="update_event",
            params={
                "event_id": event_id,
                "title": title,
                "start": start_time,
                "end": end_time,
                "description": description,
                "attendees": attendees,
                "timezone": timezone
            },
            description=f"Update event {event_id}"
        )
        return f"Action delegated: Updating event {event_id}. The client application will execute this."

    def delete_event(self, event_id: str) -> str:
        """Deletes a calendar event.
        
        Args:
            event_id: The ID of the event to delete. IMPORTANT: This must be the actual event ID returned by 'list_events', NOT the event title.
        """
        add_client_action(
            tool="calendar",
            method="delete_event",
            params={"event_id": event_id},
            description=f"Delete event {event_id}"
        )
        return f"Action delegated: Deleting event {event_id}. The client application will execute this."

