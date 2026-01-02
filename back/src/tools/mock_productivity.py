import json
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from agno.tools import Toolkit

class MockProductivityTools(Toolkit):
    def __init__(self):
        super().__init__(name="mock_productivity")
        self.register(self.get_recent_emails)
        self.register(self.get_upcoming_events)
        self.register(self.get_github_issues)

    def get_recent_emails(self, count: int = 10) -> str:
        """Get recent emails from the inbox.
        
        Args:
            count: Number of emails to retrieve.
            
        Returns:
            JSON string of emails.
        """
        emails = [
            {"id": "e1", "from": "boss@company.com", "subject": "URGENT: Quarterly Review", "body": "We need to discuss the Q1 results immediately. Please schedule time.", "timestamp": (datetime.now() - timedelta(hours=1)).isoformat(), "is_read": False},
            {"id": "e2", "from": "alex@partner.com", "subject": "API Integration Update", "body": "Hey, just wanted to follow up on the API docs we discussed last week. Any updates?", "timestamp": (datetime.now() - timedelta(hours=2)).isoformat(), "is_read": True},
            {"id": "e3", "from": "newsletter@tech.com", "subject": "Tech Weekly: AI Trends", "body": "Top 10 AI trends you need to know...", "timestamp": (datetime.now() - timedelta(hours=5)).isoformat(), "is_read": False},
            {"id": "e4", "from": "jira@company.com", "subject": "[JIRA] New comment on PROJ-123", "body": "Ivan commented: Fixed in staging.", "timestamp": (datetime.now() - timedelta(hours=12)).isoformat(), "is_read": True},
            {"id": "e5", "from": "hr@company.com", "subject": "Office Party", "body": "Don't forget the christmas party!", "timestamp": (datetime.now() - timedelta(days=1)).isoformat(), "is_read": False},
        ]
        return json.dumps(emails[:count])

    def get_upcoming_events(self, days: int = 1) -> str:
        """Get upcoming calendar events.
        
        Args:
            days: Number of days to look ahead.
            
        Returns:
            JSON string of events.
        """
        events = [
            {"id": "ev1", "title": "Quarterly Review", "start": (datetime.now() + timedelta(hours=2)).isoformat(), "end": (datetime.now() + timedelta(hours=3)).isoformat(), "participants": ["boss@company.com", "me@company.com"]},
            {"id": "ev2", "title": "Sync with Alex", "start": (datetime.now() + timedelta(hours=5)).isoformat(), "end": (datetime.now() + timedelta(hours=5.5)).isoformat(), "participants": ["alex@partner.com", "me@company.com"]},
            {"id": "ev3", "title": "Lunch", "start": (datetime.now() + timedelta(hours=1)).isoformat(), "end": (datetime.now() + timedelta(hours=2)).isoformat(), "participants": ["me@company.com"]},
        ]
        return json.dumps(events)

    def get_github_issues(self, repo: Optional[str] = None) -> str:
        """Get relevant GitHub issues.
        
        Args:
            repo: Optional repository name to filter.
            
        Returns:
            JSON string of issues.
        """
        issues = [
            {"id": "i1", "title": "Fix login timeout", "repo": "frontend", "status": "open", "priority": "high", "assignee": "me"},
            {"id": "i2", "title": "Update dependencies", "repo": "backend", "status": "open", "priority": "low", "assignee": "me"},
            {"id": "i3", "title": "Documentation typo", "repo": "docs", "status": "closed", "priority": "low", "assignee": "other"},
        ]
        return json.dumps(issues)
