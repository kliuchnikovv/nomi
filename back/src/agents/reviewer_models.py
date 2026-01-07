from typing import List, Literal, Optional
from pydantic import BaseModel, Field
from src.teams.development.models import AnalystOutput, ArchitectOutput

class ReviewerInput(BaseModel):
    pr_diff: str = Field(..., description="The diff of the pull request")
    analyst_output: AnalystOutput = Field(..., description="The original requirements")
    architect_output: ArchitectOutput = Field(..., description="The architectural plan")
    file_list: List[str] = Field(..., description="List of files changed in PR")

class ReviewComment(BaseModel):
    file_path: str = Field(..., description="File path related to the comment")
    line_number: Optional[int] = Field(None, description="Line number for the comment")
    body: str = Field(..., description="The comment text")
    severity: Literal["critical", "warning", "info"] = Field("warning")

class ReviewerOutput(BaseModel):
    verdict: Literal["approve", "request_changes"] = Field(..., description="The final decision")
    comments: List[ReviewComment] = Field(default_factory=list, description="List of specific comments")
    summary: str = Field(..., description="High-level summary of the review")
