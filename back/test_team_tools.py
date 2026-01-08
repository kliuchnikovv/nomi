import asyncio
import os
from typing import Optional, List
from unittest.mock import MagicMock
from agno.tools import Toolkit
from src.teams.development.team import DevelopmentTeam

async def test_distribution():
    print("Testing DevelopmentTeam Tool Distribution (Lightweight)...")
    
    # Mock inputs - use a string for the model with provider prefix
    model = "google:gemini-2.0-flash" 
    github_token = "mock-github-token"
    user_id = "test-user-id"
    
    # Mock client side tools
    gmail_tool = MagicMock(spec=Toolkit)
    gmail_tool.name = "gmail_client"
    client_tools = [gmail_tool]
    
    # Instantiate team
    team = DevelopmentTeam(
        model=model,
        github_token=github_token,
        user_id=user_id,
        client_tools=client_tools,
        db_url=None
    )
    
    print(f"Team Lead Name: {team.name}")
    # Get tool names from the team (Team Lead)
    team_tool_names = [t.name for t in team.tools] if team.tools else []
    print(f"Team Lead Tools: {team_tool_names}")
    
    # Check members
    for member in team.members:
        tool_names = [t.name for t in member.tools] if member.tools else []
        print(f"Member: {member.name}, Tools: {tool_names}")
        
        if member.name == "Analyst":
            assert any("github" in n.lower() for n in tool_names)
            assert "knowledge_search_tool" in tool_names
            assert "gmail_client" in tool_names
            
        if member.name == "Worker":
            assert "jules_api" in tool_names
            assert "task_management_tool" in tool_names
            assert "gmail_client" in tool_names
            
    print("\nSUCCESS: All tools verified in distribution!")

if __name__ == "__main__":
    asyncio.run(test_distribution())
