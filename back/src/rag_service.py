from typing import Optional, Dict, Any, List
import logging

from agno.knowledge import Knowledge
from agno.tools import Toolkit
from agno.knowledge.document import Document
# Adjusted import to be relative or absolute based on running from root/back
# Since we are running from root, and PYTHONPATH includes '.',
# back.src.knowledge.factory should work, but src... fails if src is not in python path directly
from back.src.knowledge.factory import build_vector_db

logger = logging.getLogger(__name__)

class ProjectKnowledgeManager:
    """
    Manages project-specific knowledge using a shared vector database
    with metadata filtering for isolation.
    """

    def __init__(self, db_url: Optional[str] = None):
        self.vector_db = build_vector_db(db_url=db_url)
        # We use a generic Knowledge base here because filtering is applied per-call
        self.knowledge = Knowledge(vector_db=self.vector_db)

    def add_document_to_project(self, project_id: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        """
        Add a document to the knowledge base with project_id in metadata.
        """
        if metadata is None:
            metadata = {}

        # Enforce project_id in metadata
        metadata["project_id"] = project_id

        logger.info(f"Adding document to project {project_id}")
        self.knowledge.load_text(text=content, meta_data=metadata)

    def search_project(self, project_id: str, query: str, num_documents: int = 5) -> List[Document]:
        """
        Search for documents within a specific project's scope.
        """
        # PgVector uses the 'filter' argument for metadata filtering
        filters = {"project_id": project_id}

        logger.info(f"Searching project {project_id} with query: {query}")
        return self.knowledge.search(query=query, num_documents=num_documents, filter=filters)


class ProjectSearchTool(Toolkit):
    """
    Tool for agents to search project-specific knowledge.
    """

    def __init__(self, manager: Optional[ProjectKnowledgeManager] = None):
        super().__init__(name="project_search_tool")
        if manager is None:
            # Fallback to default initialization if not provided
            try:
                manager = ProjectKnowledgeManager()
            except Exception as e:
                logger.warning(f"Failed to initialize ProjectKnowledgeManager in tool: {e}")
                self.manager = None
                return

        self.manager = manager
        self.register(self.search_project_knowledge)

    def search_project_knowledge(self, project_id: str, query: str) -> str:
        """
        Search for information within a specific project's knowledge base.

        Args:
            project_id (str): The ID of the project to search in.
            query (str): The search query or question.

        Returns:
            str: A string containing the relevant information found.
        """
        if not self.manager:
            return "Error: ProjectKnowledgeManager is not initialized."

        try:
            results = self.manager.search_project(project_id, query)
            if not results:
                return f"No information found for query '{query}' in project '{project_id}'."

            # Format results
            formatted_results = []
            for doc in results:
                # Document object usually has 'content'
                formatted_results.append(f"---\n{doc.content}\n---")

            return "\n".join(formatted_results)
        except Exception as e:
            logger.error(f"Error searching project knowledge: {e}")
            return f"Error occurred while searching: {str(e)}"
