from typing import Optional, Dict, Any, List
import logging
import base64

from agno.knowledge import Knowledge
from agno.tools import Toolkit
from agno.knowledge.document import Document
# Adjusted import to be relative or absolute based on running from root/back
# Since we are running from root, and PYTHONPATH includes '.',
# back.src.knowledge.factory should work, but src... fails if src is not in python path directly
from src.knowledge.factory import build_vector_db
from src.knowledge.user_knowledge import UserScopedKnowledge
from github import Github, GithubException

logger = logging.getLogger(__name__)

class ProjectKnowledgeManager:
    """
    Manages user knowledge using a shared vector database
    with metadata filtering for isolation and project scoping.
    """

    def __init__(self, user_id: str, db_url: Optional[str] = None):
        self.user_id = user_id
        self.vector_db = build_vector_db(db_url=db_url)
        # Use UserScopedKnowledge to enforce user_id isolation automatically
        self.knowledge = UserScopedKnowledge(user_id=user_id, vector_db=self.vector_db)

    def add_document(self, content: str, project_id: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> None:
        """
        Add a document to the knowledge base.
        If project_id is provided, it's added to metadata.
        If project_id is None, it's treated as general knowledge.
        """
        # Create a copy to avoid side effects on the passed dictionary
        meta = metadata.copy() if metadata else {}

        if project_id:
            meta["project_id"] = project_id
        else:
            meta["project_id"] = "general"

        logger.info(f"Adding document for user {self.user_id} (project: {meta.get('project_id')})")
        # UserScopedKnowledge.load_text enforces user_id
        self.knowledge.load_text(text=content, meta_data=meta)

    def search(self, query: str, project_id: Optional[str] = None, num_documents: int = 5) -> List[Document]:
        """
        Search for documents.
        If project_id is provided, filters by that project.
        If project_id is None, searches general knowledge (project_id="general").
        To search EVERYTHING for the user regardless of project, pass project_id="*" (or we could change design).
        Current requirement: "Project A search shouldn't return Project B data".
        So we enforce strict filtering.
        """
        filters = {}
        if project_id:
             filters["project_id"] = project_id
        else:
             filters["project_id"] = "general"

        logger.info(f"Searching user {self.user_id} (project: {filters['project_id']}) with query: {query}")
        # UserScopedKnowledge.search adds user_id to filter.
        # Fixed UserScopedKnowledge to use 'filters' as well.
        return self.knowledge.search(query=query, num_documents=num_documents, filters=filters)

    def ingest_repository(self, repo_name: str, project_id: str, github_token: Optional[str] = None) -> None:
        """
        Ingest files from a GitHub repository.
        Fetches README, AGENTS.md, and recursively everything in src/ and other source dirs.
        """
        logger.info(f"Starting ingestion for repo {repo_name} (project: {project_id})")

        documents = []

        try:
            if github_token:
                g = Github(github_token)
            else:
                logger.warning("No GitHub token provided - using unauthenticated access (60 requests/hour limit)")
                g = Github()
            repo = g.get_repo(repo_name)

            # 1. Fetch specific target files
            target_files = ["README.md", "AGENTS.md"]
            for file_path in target_files:
                try:
                    content = repo.get_contents(file_path)
                    if not isinstance(content, list):
                        decoded_content = content.decoded_content.decode('utf-8')
                        documents.append(Document(
                            content=decoded_content,
                            meta_data={
                                "project_id": project_id,
                                "source": f"github://{repo_name}/{file_path}",
                                "filename": file_path
                            }
                        ))
                        logger.debug(f"Queued {file_path}")
                except GithubException as e:
                    if e.status != 404:
                         logger.error(f"Error fetching {file_path}: {e}")
                except Exception as e:
                     logger.error(f"Error processing {file_path}: {e}")

            # 2. Recursively fetch source directories
            source_dirs = ["src", "back", "front"]
            for src_dir in source_dirs:
                try:
                    contents = repo.get_contents(src_dir)
                    queue = contents if isinstance(contents, list) else [contents]

                    while queue:
                        file_content = queue.pop(0)
                        if file_content.type == "dir":
                            try:
                                queue.extend(repo.get_contents(file_content.path))
                            except Exception as e:
                                logger.warning(f"Error reading dir {file_content.path}: {e}")
                        else:
                            try:
                                # Simple filter for likely text files
                                if file_content.encoding == "base64":
                                    # Try to decode, if fails or binary like image, skip
                                    # For now assume mostly code/text
                                    decoded = base64.b64decode(file_content.content).decode('utf-8')
                                    documents.append(Document(
                                        content=decoded,
                                        meta_data={
                                            "project_id": project_id,
                                            "source": f"github://{repo_name}/{file_content.path}",
                                            "filename": file_content.path
                                        }
                                    ))
                            except UnicodeDecodeError:
                                logger.debug(f"Skipping binary file {file_content.path}")
                            except Exception as e:
                                logger.warning(f"Skipping file {file_content.path}: {e}")

                except GithubException as e:
                    if e.status != 404:
                        logger.error(f"Error accessing '{src_dir}': {e}")
                except Exception as e:
                    logger.error(f"Error accessing '{src_dir}' directory: {e}")

            # 3. Batch upsert
            if documents:
                logger.info(f"Upserting {len(documents)} documents for {repo_name}")
                self.knowledge.load_documents(documents)
                logger.info(f"Ingestion complete for {repo_name}")
            else:
                logger.warning(f"No documents found to ingest for {repo_name}")

        except Exception as e:
            logger.error(f"Failed to ingest repository {repo_name}: {e}")
            raise

    def delete_project_knowledge(self, project_id: str) -> None:
        """
        Delete all knowledge associated with a project.
        """
        logger.info(f"Deleting knowledge for user {self.user_id} (project: {project_id})")
        # Ensure we filter by project_id. UserScopedKnowledge ensures user_id.
        self.knowledge.delete(filters={"project_id": project_id})



# Alias for backward compatibility if needed, though we updated usage below
KnowledgeManager = ProjectKnowledgeManager

class KnowledgeSearchTool(Toolkit):
    """
    Tool for agents to search knowledge (project-specific or general).
    """

    def __init__(self, user_id: str, manager: Optional[ProjectKnowledgeManager] = None):
        super().__init__(name="knowledge_search_tool")

        if manager is None:
            try:
                manager = ProjectKnowledgeManager(user_id=user_id)
            except Exception as e:
                logger.warning(f"Failed to initialize ProjectKnowledgeManager in tool: {e}")
                self.manager = None
                return

        self.manager = manager
        self.register(self.search_knowledge)

    def search_knowledge(self, query: str, project_id: Optional[str] = None) -> str:
        """
        Search for information in the knowledge base.

        Args:
            query (str): The search query or question.
            project_id (Optional[str]): The ID of the project to search in.
                                      If not provided, searches general knowledge.

        Returns:
            str: A string containing the relevant information found.
        """
        if not self.manager:
            return "Error: ProjectKnowledgeManager is not initialized."

        try:
            results = self.manager.search(query=query, project_id=project_id)
            if not results:
                scope = f"project '{project_id}'" if project_id else "general knowledge"
                return f"No information found for query '{query}' in {scope}."

            # Format results
            formatted_results = []
            for doc in results:
                content = getattr(doc, "content", str(doc))
                formatted_results.append(f"---\n{content}\n---")

            return "\n".join(formatted_results)
        except Exception as e:
            logger.error(f"Error searching knowledge: {e}")
            return f"Error occurred while searching: {str(e)}"
