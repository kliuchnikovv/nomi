from typing import Any, Dict, Optional, Type, Callable
import json
import os
from datetime import datetime

from agno.agent import Agent, RunOutput
from agno.models.base import Model
from sqlalchemy import create_engine, Column, String, JSON, DateTime, Integer
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from sqlalchemy.dialects.postgresql import UUID
import uuid

# Database setup for Workflow Storage
Base = declarative_base()

class WorkflowArtifact(Base):
    __tablename__ = 'workflow_artifacts'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(String, index=True)
    task_id = Column(String, index=True) # UUID string
    step_name = Column(String) # e.g. "Analysis", "Planning"
    artifact_type = Column(String) # e.g. "AnalystOutput"
    content = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)

class PgWorkflowStorage:
    _engine = None

    def __init__(self, db_url: str):
        if not PgWorkflowStorage._engine:
            PgWorkflowStorage._engine = create_engine(db_url)
            Base.metadata.create_all(PgWorkflowStorage._engine)
        self.Session = sessionmaker(bind=PgWorkflowStorage._engine)

    def save_artifact(self, session_id: str, task_id: str, step_name: str, artifact_type: str, content: Dict[str, Any]) -> str:
        session = self.Session()
        try:
            artifact = WorkflowArtifact(
                session_id=session_id,
                task_id=task_id,
                step_name=step_name,
                artifact_type=artifact_type,
                content=content
            )
            session.add(artifact)
            session.commit()
            return str(artifact.id)
        finally:
            session.close()

    def get_last_artifact(self, session_id: str, artifact_type: str) -> Optional[Dict[str, Any]]:
        session = self.Session()
        try:
            artifact = session.query(WorkflowArtifact).filter_by(
                session_id=session_id, artifact_type=artifact_type
            ).order_by(WorkflowArtifact.created_at.desc()).first()
            if artifact:
                return artifact.content
            return None
        finally:
            session.close()

    def get_artifact_by_task(self, task_id: str, artifact_type: str) -> Optional[Dict[str, Any]]:
        session = self.Session()
        try:
            artifact = session.query(WorkflowArtifact).filter_by(
                task_id=task_id, artifact_type=artifact_type
            ).order_by(WorkflowArtifact.created_at.desc()).first()
            if artifact:
                return artifact.content
            return None
        finally:
            session.close()

    def get_session_id_by_task(self, task_id: str) -> Optional[str]:
        session = self.Session()
        try:
            artifact = session.query(WorkflowArtifact).filter_by(
                task_id=task_id
            ).order_by(WorkflowArtifact.created_at.desc()).first()
            if artifact:
                return artifact.session_id
            return None
        finally:
            session.close()

    def save_workflow_state(self, task_id: str, state: Dict[str, Any]):
        """Saves the workflow state as a special artifact"""
        # We use a dummy session_id for now if we can't find one, or just store it.
        # Ideally state is tied to task_id primarily.
        session_id = self.get_session_id_by_task(task_id) or "system"
        self.save_artifact(session_id, task_id, "System", "WorkflowState", state)

    def get_workflow_state(self, task_id: str) -> Optional[Dict[str, Any]]:
        return self.get_artifact_by_task(task_id, "WorkflowState")

class WorkflowAgent(Agent):
    """
    An Agent that participates in a workflow.
    It can save its output as an artifact and notify the next step.
    """
    def __init__(
        self,
        *args,
        workflow_storage: Optional[PgWorkflowStorage] = None,
        on_completion: Optional[Callable[[str, str, Any, str], None]] = None,
        **kwargs
    ):
        super().__init__(*args, **kwargs)
        self.workflow_storage = workflow_storage
        self.on_completion = on_completion

    def _fetch_artifact(self, task_id: Optional[str], session_id: Optional[str], artifact_type: str) -> Optional[Dict[str, Any]]:
        """Helper to fetch artifact by task_id then session_id"""
        artifact = None
        if task_id:
            artifact = self.workflow_storage.get_artifact_by_task(task_id, artifact_type)
        if not artifact and session_id:
            artifact = self.workflow_storage.get_last_artifact(session_id, artifact_type)
        return artifact

    def run(self, message: str = None, **kwargs) -> RunOutput:
        # Extract task_id and session_id from kwargs if present, without passing to super().run if not supported
        # Agno Agent.run passes kwargs to model.generate usually.

        task_id = kwargs.pop('task_id', None)
        session_id = kwargs.pop('session_id', None)

        # 2. Context Inheritance
        # If we have task_id/session_id, check for previous artifacts
        if self.workflow_storage and (task_id or session_id):
            previous_context = ""

            # Context for Architect (needs Analyst)
            if self.name == "Architect":
                 artifact = self._fetch_artifact(task_id, session_id, "AnalystOutput")
                 if artifact:
                     previous_context += f"\n\n[Context: AnalystOutput]\n{json.dumps(artifact, indent=2)}\n"

            # Context for Developer (needs Architect)
            elif self.name == "Developer":
                 # Normal flow
                 artifact = self._fetch_artifact(task_id, session_id, "ArchitectPlan")
                 if artifact:
                     previous_context += f"\n\n[Context: ArchitectPlan]\n{json.dumps(artifact, indent=2)}\n"

                 # Fix Loop flow: Check for ReviewVerdict
                 verdict = self._fetch_artifact(task_id, session_id, "ReviewVerdict")
                 if verdict and not verdict.get("approved", True):
                     previous_context += f"\n\n[Context: Review Feedback (FIX REQUIRED)]\n{json.dumps(verdict, indent=2)}\n"

            # Context for Reviewer (needs Analyst, Architect, and ideally PR info)
            elif self.name == "Reviewer":
                 # Analyst Requirements
                 analyst_out = self._fetch_artifact(task_id, session_id, "AnalystOutput")
                 if analyst_out:
                     previous_context += f"\n\n[Context: Requirements]\n{json.dumps(analyst_out, indent=2)}\n"

                 # Architect Plan
                 arch_plan = self._fetch_artifact(task_id, session_id, "ArchitectPlan")
                 if arch_plan:
                     previous_context += f"\n\n[Context: Architecture Plan]\n{json.dumps(arch_plan, indent=2)}\n"

                 # Developer Output (PR Link/Info) - Assuming Developer returns dict or string
                 # Note: Developer output might be raw dict if it's just a message, or a Model.
                 # We fetch "Developer" artifact (implicit name of artifact type from previous step logic)
                 # Wait, save_artifact uses type(output).__name__.
                 # If Developer returns a simple string, we might not have a structured artifact.
                 # But let's try to fetch "Dict" or whatever the developer returns.
                 # Actually, we should check `workflow_artifacts` for `step_name='Developer'`.
                 # My storage `get_artifact_by_task` filters by `artifact_type`.
                 # The `transition_to_next_step` saves it with `artifact_type`.
                 # If Developer output is just a dict/string, type is "Dict" or "str".
                 # This is tricky. Let's assume Developer output is important.
                 # I'll implement a fallback in `PgWorkflowStorage` or here.
                 # For now, let's assume we want to see the *last* artifact from the Developer step.
                 pass

            # Context for Verifier (needs Analyst, Architect, Reviewer)
            elif self.name == "Verifier":
                 # Analyst Requirements
                 analyst_out = self._fetch_artifact(task_id, session_id, "AnalystOutput")
                 if analyst_out:
                     previous_context += f"\n\n[Context: Requirements]\n{json.dumps(analyst_out, indent=2)}\n"

                 # Review Verdict
                 verdict = self._fetch_artifact(task_id, session_id, "ReviewVerdict")
                 if verdict:
                     previous_context += f"\n\n[Context: Review Verdict (Approved)]\n{json.dumps(verdict, indent=2)}\n"

            if previous_context:
                if message:
                    message += previous_context
                else:
                    message = previous_context

        # Run the agent
        response = super().run(message=message, **kwargs)

        # Extract output
        output = None
        if hasattr(response, 'content') and response.content is not None:
             output = response.content

        # 3. Save Artifact & Transition
        # If session_id is missing (e.g. webhook trigger), try to find it
        if task_id and not session_id and self.workflow_storage:
            session_id = self.workflow_storage.get_session_id_by_task(task_id)

        if output and self.on_completion and task_id and session_id:
             # Trigger the transition logic
             self.on_completion(task_id, self.name, output, session_id)

        return response
