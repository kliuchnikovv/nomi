
import sys
import os
import logging
from typing import Any, Iterator, AsyncIterator

logging.basicConfig(level=logging.INFO)

from agno.models.base import Model
from agno.models.response import ModelResponse
from agno.workflow import Workflow

class MockModel(Model):
    id: str = "mock"
    
    def invoke(self, *args, **kwargs) -> ModelResponse: 
        return ModelResponse(content="mock response")
    
    async def ainvoke(self, *args, **kwargs) -> ModelResponse: 
        return ModelResponse(content="mock response")
        
    def invoke_stream(self, *args, **kwargs) -> Iterator[ModelResponse]: 
        yield ModelResponse(content="mock response")
        
    async def ainvoke_stream(self, *args, **kwargs) -> AsyncIterator[ModelResponse]: 
        yield ModelResponse(content="mock response")
        
    def _parse_provider_response(self, response: Any) -> ModelResponse:
        return ModelResponse(content="mock")
        
    def _parse_provider_response_delta(self, response_delta: Any) -> ModelResponse:
        return ModelResponse(content="mock")

from src.teams.development.team import DevelopmentTeam

def test_instantiation():
    print("Testing DevelopmentTeam instantiation and AgentOS compatibility...")
    try:
        team = DevelopmentTeam(
            model=MockModel(id="mock"),
            db=None,
            github_token="mock_token",
            jules_api_key="mock_key",
            user_id="user123",
            task_id="task123",
            project_id="proj123",
            client_tools=[]
        )
        print("Successfully instantiated DevelopmentTeam")
        print(f"Is instance of Workflow: {isinstance(team, Workflow)}")
        
        print(f"Is instance of Workflow: {isinstance(team, Workflow)}")
        
        # Check AgentOS requirements
        required_attrs = ['tools', 'members', 'knowledge', 'memory', 'model', 'tool_call_limit', 'instructions', 'tool_choice', 'description', 'add_history_to_context']
        for attr in required_attrs:
            if hasattr(team, attr):
                print(f"Verified attribute: {attr}")
            else:
                print(f"FAILED: Missing attribute {attr}")
        
        # Check methods
        if hasattr(team, 'initialize_team'):
            print("Verified method: initialize_team")
        if hasattr(team, '_determine_tools_for_model'):
            print("Verified method: _determine_tools_for_model")
            print(f"Tools determined: {team._determine_tools_for_model()}")
            
    except Exception as e:
        print(f"Error validating DevelopmentTeam: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    test_instantiation()
