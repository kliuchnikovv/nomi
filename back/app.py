import os
import json
import logging
from fastapi import FastAPI, Depends, Request, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any

from src.agents.briefing import BriefingAgent
from agno.models.google import Gemini

# Initialize App
app = FastAPI()
logger = logging.getLogger(__name__)

# Models
class BriefingRequest(BaseModel):
    integration_data: Optional[Dict[str, Any]] = None

# Dependencies
def get_user(request: Request):
    # Mock user auth for this context
    # In real app, we verify JWT from Authorization header
    return {"id": "user_123"}

# Agents
# Using Gemini as default model
llm = Gemini(id="gemini-1.5-flash", api_key=os.getenv("GOOGLE_API_KEY"))
briefing_agent = BriefingAgent(model=llm)

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/briefing")
async def get_briefing(request: BriefingRequest, user: dict = Depends(get_user)):
    try:
        # Pass data to agent
        result = await briefing_agent.generate_briefing(
            user_id=user["id"],
            integration_data=request.integration_data
        )

        # Result is likely a JSON string if the agent followed instructions.
        # We try to parse it to ensure it's valid JSON before returning,
        # or return as is if it's an object.
        if isinstance(result, str):
            try:
                # Clean up markdown code blocks if present
                clean_result = result.replace("```json", "").replace("```", "").strip()
                return json.loads(clean_result)
            except json.JSONDecodeError:
                # Fallback if LLM output isn't perfect JSON
                return {"headline": "Briefing Generated", "summary": result, "items": []}
        return result
        
    except Exception as e:
        logger.error(f"Briefing generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
