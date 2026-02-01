from typing import Optional, Dict, Any, List
import logging
import os
import httpx

from agno.knowledge import Knowledge
from agno.knowledge.document import Document
from agno.tools import Toolkit

from src.knowledge.factory import build_vector_db
from github import Github, GithubException

logger = logging.getLogger(__name__)


class ProjectKnowledgeManager:
    """
    Manages user knowledge using a shared Knowledge instance.
    User isolation via user_id in metadata/filters on every insert/search/delete.
    """

    def __init__(
        self,
        user_id: str,
        knowledge: Optional[Knowledge] = None,
        db_url: Optional[str] = None,
        vector_db: Optional[Any] = None,
    ):
        self.user_id = user_id
        if knowledge is not None:
            self.knowledge = knowledge
        else:
            # Legacy: build from vector_db or db_url
            vec = vector_db if vector_db else build_vector_db(db_url=db_url)
            self.knowledge = Knowledge(vector_db=vec, max_results=5)

    def add_document(
        self,
        content: str,
        project_id: Optional[str] = None,
        list_id: Optional[str] = None,
        item_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Add a document to the knowledge base.
        """
        # Create a copy to avoid side effects on the passed dictionary
        meta = metadata.copy() if metadata else {}

        if list_id:
            meta["list_id"] = list_id
            if item_id:
                meta["item_id"] = item_id
                # Deduplication: Delete existing document for this item before adding
                logger.info(
                    f"Removing stale documents for item {item_id} in list {list_id}"
                )
                self.knowledge.remove_vectors_by_metadata(
                    metadata={"user_id": self.user_id, "list_id": list_id, "item_id": item_id}
                )

            logger.info(f"Adding document for user {self.user_id} (list: {list_id})")
        elif project_id:
            meta["project_id"] = project_id
            logger.info(
                f"Adding document for user {self.user_id} (project: {project_id})"
            )
        else:
            meta["project_id"] = "general"
            logger.info(f"Adding document for user {self.user_id} (general)")

        meta["user_id"] = self.user_id
        self.knowledge.insert(text_content=content, metadata=meta)

    def search(
        self,
        query: str,
        project_id: Optional[str] = None,
        list_id: Optional[str] = None,
        max_results: int = 5,
    ) -> List[Document]:
        """
        Search for documents with strict user isolation.
        """
        filters = {}

        if list_id:
            filters["list_id"] = list_id
            logger.info(f"Searching knowledge for list {list_id} with query: {query}")
        elif project_id and project_id != "*":
            filters["project_id"] = project_id
            logger.info(
                f"Searching knowledge for project {project_id} with query: {query}"
            )
        elif project_id == "*":
            # Search across all projects (no project_id filter), but still scoped to user
            logger.info(
                f"Searching across all projects for user {self.user_id} with query: {query}"
            )
        else:
            filters["project_id"] = "general"
            logger.info(
                f"Searching general knowledge for user {self.user_id} with query: {query}"
            )

        filters["user_id"] = self.user_id
        results = self.knowledge.search(
            query=query, max_results=max_results, filters=filters
        )

        scope = (
            f"list {list_id}"
            if list_id
            else (f"project {project_id}" if project_id else "general")
        )
        logger.info(f"Found {len(results)} results in {scope} for user {self.user_id}")
        return results

    def ingest_repository(
        self, repo_name: str, project_id: str, github_token: Optional[str] = None
    ) -> None:
        """
        Ingest repository as structured project knowledge.

        Instead of copying all files, creates structured summaries:
        1. docs — README.md, AGENTS.md (full text)
        2. structure — Project directory layout
        3. api — Endpoint definitions (routes, handlers)
        4. components — Key classes/functions with signatures
        5. dependencies — From package.json, go.mod, requirements.txt
        """
        logger.info(
            f"Starting structured ingestion for repo {repo_name} (project: {project_id})"
        )

        documents = []

        try:
            if github_token:
                g = Github(github_token)
            else:
                logger.warning(
                    "No GitHub token provided - using unauthenticated access (60 requests/hour limit)"
                )
                g = Github()
            repo = g.get_repo(repo_name)

            # 1. Documentation files (full text)
            docs = self._ingest_documentation(repo, repo_name, project_id)
            documents.extend(docs)

            # 2. Project structure
            structure_doc = self._build_project_structure(repo, repo_name, project_id)
            if structure_doc:
                documents.append(structure_doc)

            # 3. Dependencies
            deps_docs = self._extract_dependencies(repo, repo_name, project_id)
            documents.extend(deps_docs)

            # 4. API endpoints and key components
            components_docs = self._extract_key_components(repo, repo_name, project_id)
            documents.extend(components_docs)

            # 5. Batch insert with user_id in metadata
            if documents:
                logger.info(
                    f"Upserting {len(documents)} structured documents for {repo_name}"
                )
                for doc in documents:
                    meta = dict(doc.meta_data or {})
                    meta["user_id"] = self.user_id
                    self.knowledge.insert(
                        text_content=doc.content,
                        metadata=meta,
                    )
                logger.info(f"Structured ingestion complete for {repo_name}")
            else:
                logger.warning(f"No documents found to ingest for {repo_name}")

        except Exception as e:
            logger.error(f"Failed to ingest repository {repo_name}: {e}")
            raise

    def _ingest_documentation(
        self, repo, repo_name: str, project_id: str
    ) -> List[Document]:
        """Fetch documentation files (full text)."""
        documents = []
        doc_files = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "docs/README.md"]

        for file_path in doc_files:
            try:
                content = repo.get_contents(file_path)
                if not isinstance(content, list):
                    decoded_content = content.decoded_content.decode("utf-8")
                    documents.append(
                        Document(
                            content=decoded_content,
                            meta_data={
                                "project_id": project_id,
                                "doc_type": "docs",
                                "source": f"github://{repo_name}/{file_path}",
                                "filename": file_path,
                            },
                        )
                    )
                    logger.debug(f"Indexed documentation: {file_path}")
            except GithubException as e:
                if e.status != 404:
                    logger.error(f"Error fetching {file_path}: {e}")
            except Exception as e:
                logger.error(f"Error processing {file_path}: {e}")

        return documents

    def _build_project_structure(
        self, repo, repo_name: str, project_id: str
    ) -> Optional[Document]:
        """Build a structured description of project directories using Git Tree API (faster)."""
        try:
            # Use get_git_tree with recursive=True to get flat list of all files in one API call
            # This avoids N+1 API calls and rate limits
            try:
                # Use HEAD or main branch
                sha = repo.default_branch
                tree = repo.get_git_tree(sha=sha, recursive=True)
            except Exception as e:
                logger.warning(
                    f"Failed to get git tree: {e}. Falling back to non-recursive."
                )
                return None

            structure_lines = [f"# Project Structure: {repo_name}\n"]
            if tree.truncated:
                structure_lines.append(
                    "> Note: Project is too large, structure is truncated.\n"
                )

            # Process tree elements
            # Sort by path to ensure deterministic order
            elements = sorted(tree.tree, key=lambda x: x.path)

            # Helper to check if path is too deep (e.g. > 5 levels)
            def get_depth(path):
                return path.count("/")

            # Track which directories we've already described to avoid noise
            described_dirs = set()

            root_files = []

            for element in elements:
                path = element.path
                depth = get_depth(path)

                # Skip deep nesting
                if depth > 4:
                    continue

                # Skip hidden files/dirs
                if "/." in f"/{path}" or path.startswith("."):
                    continue

                if element.type == "tree":  # Directory
                    # Only describe top-level and second-level directories
                    if depth <= 2:
                        name = path.split("/")[-1]
                        indent = "  " * depth
                        purpose = self._guess_dir_purpose(name)
                        structure_lines.append(f"{indent}- **{name}/** — {purpose}\n")
                        described_dirs.add(path)

                elif element.type == "blob":  # File
                    # Only list root files
                    if depth == 0:
                        root_files.append(path)

            if root_files:
                key_files = [
                    f
                    for f in root_files
                    if f
                    in [
                        "README.md",
                        "package.json",
                        "go.mod",
                        "requirements.txt",
                        "Makefile",
                        "docker-compose.yml",
                        "pyproject.toml",
                    ]
                ]
                if key_files:
                    structure_lines.append(
                        f"Root Config files: {', '.join(key_files)}\n"
                    )

            return Document(
                content="".join(structure_lines),
                meta_data={
                    "project_id": project_id,
                    "doc_type": "structure",
                    "source": f"github://{repo_name}",
                    "filename": "_project_structure.md",
                },
            )
        except Exception as e:
            logger.error(f"Failed to build project structure: {e}")
            return None

    def _guess_dir_purpose(self, dir_name: str) -> str:
        """Guess the purpose of a directory based on common conventions."""
        purposes = {
            "src": "Source code",
            "api": "REST API / Backend server",
            "back": "Backend service (Python)",
            "front": "Frontend application",
            "frontend": "Frontend application",
            "backend": "Backend service",
            "lib": "Library code",
            "pkg": "Go packages",
            "internal": "Internal packages (not exported)",
            "cmd": "Command-line entry points",
            "test": "Tests",
            "tests": "Tests",
            "__tests__": "Tests",
            "spec": "Test specifications",
            "docs": "Documentation",
            "config": "Configuration files",
            "scripts": "Build/deployment scripts",
            "migrations": "Database migrations",
            "models": "Data models",
            "handlers": "Request handlers",
            "services": "Business logic services",
            "components": "UI components",
            "screens": "App screens/pages",
            "utils": "Utility functions",
            "helpers": "Helper functions",
            "hooks": "React hooks",
            "assets": "Static assets (images, fonts)",
            "public": "Public static files",
            "static": "Static files",
            "templates": "Template files",
            "views": "View templates",
            "routes": "Route definitions",
            "middleware": "Middleware functions",
            "agents": "AI agents",
            "tools": "Agent tools",
            "teams": "Agent teams",
            "knowledge": "RAG knowledge base",
            "workflow": "Workflow logic",
        }
        return purposes.get(dir_name.lower(), "Project directory")

    def _extract_dependencies(
        self, repo, repo_name: str, project_id: str
    ) -> List[Document]:
        """Extract dependencies from package files."""
        documents = []
        dep_files = {
            "package.json": self._parse_package_json,
            "go.mod": self._parse_go_mod,
            "requirements.txt": self._parse_requirements,
            "pyproject.toml": self._parse_pyproject,
        }

        for file_path, parser in dep_files.items():
            try:
                content = repo.get_contents(file_path)
                if not isinstance(content, list):
                    decoded = content.decoded_content.decode("utf-8")
                    deps_summary = parser(decoded)
                    if deps_summary:
                        documents.append(
                            Document(
                                content=deps_summary,
                                meta_data={
                                    "project_id": project_id,
                                    "doc_type": "dependencies",
                                    "source": f"github://{repo_name}/{file_path}",
                                    "filename": file_path,
                                },
                            )
                        )
                        logger.debug(f"Indexed dependencies from: {file_path}")
            except GithubException:
                pass
            except Exception as e:
                logger.debug(f"Could not parse {file_path}: {e}")

        return documents

    def _parse_package_json(self, content: str) -> str:
        """Parse package.json and return dependency summary."""
        import json

        try:
            pkg = json.loads(content)
            lines = ["# Node.js Dependencies\n"]

            if "name" in pkg:
                lines.append(f"Package: {pkg['name']}\n")
            if "description" in pkg:
                lines.append(f"Description: {pkg['description']}\n")

            if "dependencies" in pkg:
                lines.append("\n## Dependencies:\n")
                for dep, ver in pkg["dependencies"].items():
                    lines.append(f"- {dep}: {ver}\n")

            if "devDependencies" in pkg:
                lines.append("\n## Dev Dependencies:\n")
                for dep, ver in list(pkg["devDependencies"].items())[:10]:
                    lines.append(f"- {dep}: {ver}\n")
                if len(pkg["devDependencies"]) > 10:
                    lines.append(f"- ... and {len(pkg['devDependencies']) - 10} more\n")

            if "scripts" in pkg:
                lines.append("\n## Available Scripts:\n")
                for script, cmd in pkg["scripts"].items():
                    lines.append(
                        f"- `npm run {script}`: {cmd[:50]}{'...' if len(cmd) > 50 else ''}\n"
                    )

            return "".join(lines)
        except Exception:
            return ""

    def _parse_go_mod(self, content: str) -> str:
        """Parse go.mod and return dependency summary."""
        lines = ["# Go Dependencies\n"]
        in_require = False
        deps = []

        for line in content.split("\n"):
            line = line.strip()
            if line.startswith("module "):
                lines.append(f"Module: {line[7:]}\n")
            elif line.startswith("go "):
                lines.append(f"Go version: {line[3:]}\n")
            elif line == "require (":
                in_require = True
            elif line == ")":
                in_require = False
            elif in_require and line:
                parts = line.split()
                if len(parts) >= 2:
                    deps.append(f"- {parts[0]}")

        if deps:
            lines.append("\n## Dependencies:\n")
            lines.extend([d + "\n" for d in deps[:20]])
            if len(deps) > 20:
                lines.append(f"- ... and {len(deps) - 20} more\n")

        return "".join(lines)

    def _parse_requirements(self, content: str) -> str:
        """Parse requirements.txt and return dependency summary."""
        lines = ["# Python Dependencies\n\n"]
        deps = []

        for line in content.split("\n"):
            line = line.strip()
            if line and not line.startswith("#") and not line.startswith("-"):
                deps.append(f"- {line.split('==')[0].split('>=')[0].split('<=')[0]}")

        if deps:
            lines.extend([d + "\n" for d in deps[:30]])
            if len(deps) > 30:
                lines.append(f"- ... and {len(deps) - 30} more\n")

        return "".join(lines)

    def _parse_pyproject(self, content: str) -> str:
        """Parse pyproject.toml and return summary."""
        lines = ["# Python Project (pyproject.toml)\n"]
        quote = '"'

        for line in content.split("\n"):
            if line.startswith("name = "):
                value = line.split("=")[1].strip().strip(quote)
                lines.append(f"Name: {value}\n")
            elif line.startswith("description = "):
                value = line.split("=")[1].strip().strip(quote)
                lines.append(f"Description: {value}\n")

        return "".join(lines) if len(lines) > 1 else ""

    def _extract_key_components(
        self, repo, repo_name: str, project_id: str
    ) -> List[Document]:
        """Extract key components (APIs, main classes) from source files."""
        documents = []

        api_patterns = [
            # Go API
            ("api/internal/http", "go", "API routes and handlers"),
            ("api/internal/handlers", "go", "HTTP handlers"),
            ("api/internal/storage", "go", "Data storage and models"),
            ("api/internal/models", "go", "Domain models"),
            ("api/internal/hub", "go", "Communication hub"),
            ("api/internal/services", "go", "Business logic services"),
            ("api/cmd", "go", "Main entry points"),
            # Python Backend
            ("back/src/agents", "py", "AI agents"),
            ("back/src/teams", "py", "Agent teams"),
            ("back/src/workflow", "py", "Workflow logic"),
            ("back/src/knowledge", "py", "Knowledge management"),
            ("back/src/tools", "py", "Agent tools"),
            ("back/src/server", "py", "Server implementation"),
            ("back/src/models", "py", "Data models"),
            # Frontend
            ("front/src/screens", "tsx", "App screens"),
            ("front/src/components", "tsx", "UI components"),
            ("front/src/api", "ts", "Frontend API client"),
            ("front/src/context", "tsx", "React context providers"),
            ("front/src/hooks", "ts", "Custom React hooks"),
            ("front/src/utils", "ts", "Utility functions"),
            ("front/src/services", "ts", "Frontend services"),
            # Root-level source files
            ("back/src", "py", "Backend core modules"),
            ("back", "py", "Backend entry point"),
            ("api", "go", "API root files"),
        ]

        for path, ext, description in api_patterns:
            try:
                contents = repo.get_contents(path)
                if not isinstance(contents, list):
                    contents = [contents]

                for item in contents:
                    if item.type == "file" and item.name.endswith(f".{ext}"):
                        try:
                            # Use decoded_content for better safety than base64
                            decoded = item.decoded_content.decode("utf-8")
                            summary = self._extract_file_summary(
                                decoded, ext, item.name
                            )
                            if summary:
                                documents.append(
                                    Document(
                                        content=f"# {description}: {item.name}\n\n{summary}",
                                        meta_data={
                                            "project_id": project_id,
                                            "doc_type": "components",
                                            "source": f"github://{repo_name}/{path}/{item.name}",
                                            "filename": item.name,
                                        },
                                    )
                                )
                                logger.debug(f"Indexed component: {path}/{item.name}")
                        except Exception as e:
                            logger.error(
                                f"Error extracting summary from {item.name}: {e}"
                            )
                            pass

            except GithubException:
                pass
            except Exception as e:
                logger.debug(f"Could not extract from {path}: {e}")

        return documents

    def _extract_file_summary(self, content: str, ext: str, filename: str) -> str:
        """Extract function/class signatures from a source file."""
        lines = []

        if ext == "go":
            # Special handling for models.go to include struct fields
            if "models.go" in filename.lower():
                import re

                # Match: type Name struct { ... }
                # Note: This is a simple regex that works for most Go model files
                struct_matches = re.finditer(
                    r"type\s+(\w+)\s+struct\s+\{([^}]+)\}", content
                )
                for match in struct_matches:
                    name = match.group(1)
                    fields_raw = match.group(2)
                    # Clean up fields: remove tags like `json:"..."`, remove comments, join lines
                    clean_fields = []
                    for f in fields_raw.split("\n"):
                        f = f.split("//")[0].split("/*")[0].strip()
                        if not f:
                            continue
                        # Remove json tags
                        f = re.sub(r"`[^`]+`", "", f).strip()
                        if f:
                            # Collapse multiple spaces
                            f = re.sub(r"\s+", " ", f)
                            clean_fields.append(f)

                    lines.append(
                        f"- `type {name} struct` {{ {', '.join(clean_fields[:15])} }}"
                    )

                # Also include regular signatures for anything missed
                if not lines:
                    for line in content.split("\n"):
                        line = line.strip()
                        if line.startswith("type ") and "struct" in line:
                            lines.append(f"- `{line.split('{')[0].strip()}`")

            else:
                # Standard signature extraction for Go files
                for line in content.split("\n"):
                    line = line.strip()
                    if line.startswith("func ") and "(" in line:
                        sig = line.split("{")[0].strip()
                        lines.append(f"- `{sig}`")
                    elif line.startswith("type ") and (
                        "struct" in line or "interface" in line
                    ):
                        lines.append(f"- `{line.split('{')[0].strip()}`")

        elif ext in ("py", "python"):
            for line in content.split("\n"):
                if line.startswith("def ") or line.startswith("async def "):
                    sig = line.rstrip(":").strip()
                    lines.append(f"- `{sig}`")
                elif line.startswith("class "):
                    sig = line.rstrip(":").strip()
                    lines.append(f"- `{sig}`")

        elif ext in ("ts", "tsx", "js", "jsx"):
            import re

            func_pattern = re.compile(r"(export\s+)?(async\s+)?function\s+(\w+)")
            const_pattern = re.compile(
                r"(export\s+)?const\s+(\w+)\s*[=:]\s*(async\s+)?\("
            )
            class_pattern = re.compile(r"(export\s+)?class\s+(\w+)")

            for line in content.split("\n"):
                if match := func_pattern.search(line):
                    lines.append(f"- `function {match.group(3)}()`")
                elif match := const_pattern.search(line):
                    lines.append(f"- `const {match.group(2)}`")
                elif match := class_pattern.search(line):
                    lines.append(f"- `class {match.group(2)}`")

        return "\n".join(lines[:20]) if lines else ""

    def delete_project_knowledge(self, project_id: str) -> None:
        """
        Delete all knowledge associated with a project.
        """
        logger.info(
            f"Deleting knowledge for user {self.user_id} (project: {project_id})"
        )
        self.knowledge.remove_vectors_by_metadata(
            metadata={"user_id": self.user_id, "project_id": project_id}
        )

    def delete_list_knowledge(self, list_id: str) -> None:
        """
        Delete all knowledge associated with a list.
        """
        logger.info(f"Deleting knowledge for user {self.user_id} (list: {list_id})")
        self.knowledge.remove_vectors_by_metadata(
            metadata={"user_id": self.user_id, "list_id": list_id}
        )

    def reindex_repository(
        self, repo_name: str, project_id: str, github_token: Optional[str] = None
    ) -> None:
        """
        Re-index repository: delete existing knowledge and re-ingest.
        """
        logger.info(f"Starting reindex for project {project_id} (repo: {repo_name})")
        self.delete_project_knowledge(project_id)
        self.ingest_repository(repo_name, project_id, github_token)
        logger.info(f"Reindex complete for project {project_id}")


# Alias for backward compatibility if needed, though we updated usage below
KnowledgeManager = ProjectKnowledgeManager


class KnowledgeSearchTool(Toolkit):
    """
    Tool for agents to search knowledge (project-specific or general).
    """

    def __init__(
        self,
        user_id: str,
        auth_token: Optional[str] = None,
        manager: Optional[ProjectKnowledgeManager] = None,
        list_id: Optional[str] = None,
    ):
        super().__init__(name="knowledge_search_tool")
        self.user_id = user_id
        self.auth_token = auth_token
        self.list_id = list_id

        if manager is None:
            try:
                manager = ProjectKnowledgeManager(user_id=user_id)
            except Exception as e:
                logger.warning(
                    f"Failed to initialize ProjectKnowledgeManager in tool: {e}"
                )
                self.manager = None
                self.register(self.list_projects)
                self.register(self.list_lists)
                return

        self.manager = manager
        self.register(self.search_knowledge)
        self.register(self.search_list_knowledge)
        self.register(self.list_projects)
        self.register(self.list_lists)
        if list_id:
            self.register(self.add_list_item)
            self.register(self.update_list_item)
            self.register(self.delete_list_item)

    def search_knowledge(self, query: str, project_id: Optional[str] = None) -> str:
        """
        Search for information in the project knowledge base.

        Args:
            query (str): Natural language query describing what you're looking for.
                         Be specific! Good examples:
                         - "How does authentication work?"
                         - "What API endpoints exist for users?"
                         - "Project directory structure"
                         - "Frontend navigation screens"
                         - "Go dependencies"
                         Bad examples (too vague):
                         - "code"
                         - "files"

            project_id (Optional[str]): The ID of the project to search in.
                                        - Get this from session context (session.context.project_id)
                                        - Use "*" to search across ALL projects
                                        - Leave None for general (non-project) knowledge

        Returns:
            str: Formatted search results with relevant code snippets and documentation.

        Knowledge Types Available (indexed per project):
            - docs: Full README.md, AGENTS.md content
            - structure: Project directory layout with descriptions
            - api: Endpoint definitions and routes
            - components: Key classes and function signatures
            - dependencies: Libraries and versions from package files

        Example Queries:
            - "project structure" -> Get directory layout
            - "api endpoints handlers" -> Find REST API routes
            - "react screens components" -> Find frontend components
            - "python dependencies agno" -> Find backend libraries
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

    def search_list_knowledge(self, list_id: str, query: str) -> str:
        """
        Search for information in a user list (facts, links, documents saved in that list).

        Use this when the user asks about "list X", "my saved links in list Y", or "what's in my list Z".
        Call list_lists() first to get list IDs and names if you don't know the list_id.

        Args:
            list_id (str): The ID of the list to search in (UUID from list_lists).
            query (str): Natural language query (e.g. "articles about Python", "saved recipes").

        Returns:
            str: Formatted search results from that list's RAG space.
        """
        if not self.manager:
            return "Error: ProjectKnowledgeManager is not initialized."

        try:
            results = self.manager.search(query=query, list_id=list_id)
            if not results:
                return f"No information found for query '{query}' in list {list_id}."

            formatted_results = []
            for doc in results:
                content = getattr(doc, "content", str(doc))
                formatted_results.append(f"---\n{content}\n---")

            return "\n".join(formatted_results)
        except Exception as e:
            logger.error(f"Error searching list knowledge: {e}")
            return f"Error occurred while searching list: {str(e)}"

    def list_lists(self) -> str:
        """
        List all available lists for the current user.

        Use this to discover list IDs and names when the user refers to "my list" or "saved links".
        Then use search_list_knowledge(list_id="<id>", query="...") to search within a list.

        Returns:
            str: A formatted list of lists with their IDs and names.
        """
        try:
            api_url = os.getenv("GO_API_URL", "http://localhost:8080")
            if not api_url.endswith("/api"):
                api_url = f"{api_url}/api"
            headers = {}
            if self.auth_token:
                headers["Authorization"] = f"Bearer {self.auth_token}"

            with httpx.Client(timeout=10.0) as client:
                response = client.get(f"{api_url}/lists", headers=headers)

                if response.status_code == 401:
                    return "Error: Not authorized. Please ensure you are logged in."

                if response.status_code != 200:
                    logger.error(
                        f"Failed to list lists: {response.status_code} - {response.text}"
                    )
                    return f"Error fetching lists: HTTP {response.status_code}"

                lists_data = response.json()
                if not lists_data:
                    return "No lists found. The user hasn't created any lists yet."

                lines = ["# Available Lists\n"]
                for lst in lists_data:
                    list_id = lst.get("id") or lst.get("ID") or "unknown"
                    name = lst.get("name") or lst.get("Name") or "Unnamed"
                    description = lst.get("description") or lst.get("Description") or ""
                    lines.append(f"## {name}")
                    lines.append(f"- **List ID**: `{list_id}`")
                    if description:
                        lines.append(f"- **Description**: {description}")
                    lines.append("")

                return "\n".join(lines)

        except httpx.TimeoutException:
            logger.error("Timeout while fetching lists")
            return "Error: Timeout while fetching lists. Please try again."
        except Exception as e:
            logger.error(f"Error listing lists: {e}")
            return f"Error listing lists: {str(e)}"

    def add_list_item(
        self,
        type: str,
        title: Optional[str] = None,
        content: Optional[str] = None,
        url: Optional[str] = None,
        list_id: Optional[str] = None,
    ) -> str:
        """
        Add an item to a list. Use when the user asks to save something.
        - type "fact": short note (default when user just wrote text, e.g. "add Atomic Heart").
        - type "link": only when user provided a URL (url required).
        - type "document": only when user attached a file or pasted long text as document.
        In list chat context, list_id can be omitted (uses current list).
        """
        lid = list_id or self.list_id
        if not lid:
            return "Error: list_id is required (or open a list chat)."
        if type not in ("fact", "link", "document"):
            return "Error: type must be fact, link, or document."
        if type == "link" and not url:
            return "Error: url is required for link type."
        if not content and not url:
            return "Error: content or url is required."
        try:
            api_url = os.getenv("GO_API_URL", "http://localhost:8080")
            if not api_url.endswith("/api"):
                api_url = f"{api_url}/api"
            headers = {"Content-Type": "application/json"}
            if self.auth_token:
                headers["Authorization"] = f"Bearer {self.auth_token}"
            body = {
                "type": type,
                "title": title or "",
                "content": content or "",
                "url": url or "",
            }
            with httpx.Client(timeout=15.0) as client:
                response = client.post(
                    f"{api_url}/lists/{lid}/items", json=body, headers=headers
                )
            if response.status_code == 401:
                return "Error: Not authorized. Please ensure you are logged in."
            if response.status_code not in (200, 201):
                return (
                    f"Error adding item: HTTP {response.status_code} - {response.text}"
                )
            data = response.json()
            item_id = data.get("id") or data.get("ID") or "saved"
            return f"Added item to list (id: {item_id})."
        except httpx.TimeoutException:
            return "Error: Timeout while calling API."
        except Exception as e:
            logger.error(f"Error adding list item: {e}")
            return f"Error: {e}"

    def update_list_item(
        self,
        item_id: str,
        title: Optional[str] = None,
        content: Optional[str] = None,
        url: Optional[str] = None,
        type: Optional[str] = None,
        list_id: Optional[str] = None,
    ) -> str:
        """
        Update an existing list item. Use when the user asks to edit an item.
        In list chat context, list_id can be omitted.
        """
        lid = list_id or self.list_id
        if not lid:
            return "Error: list_id is required (or open a list chat)."
        if not item_id:
            return "Error: item_id is required."
        try:
            api_url = os.getenv("GO_API_URL", "http://localhost:8080")
            if not api_url.endswith("/api"):
                api_url = f"{api_url}/api"
            headers = {"Content-Type": "application/json"}
            if self.auth_token:
                headers["Authorization"] = f"Bearer {self.auth_token}"
            body = {}
            if title is not None:
                body["title"] = title
            if content is not None:
                body["content"] = content
            if url is not None:
                body["url"] = url
            if type is not None:
                body["type"] = type
            if not body:
                return "No updates provided (title, content, url, or type)."
            with httpx.Client(timeout=15.0) as client:
                response = client.put(
                    f"{api_url}/lists/{lid}/items/{item_id}", json=body, headers=headers
                )
            if response.status_code == 401:
                return "Error: Not authorized."
            if response.status_code != 200:
                return f"Error updating item: HTTP {response.status_code} - {response.text}"
            return "Item updated."
        except Exception as e:
            logger.error(f"Error updating list item: {e}")
            return f"Error: {e}"

    def delete_list_item(self, item_id: str, list_id: Optional[str] = None) -> str:
        """
        Delete an item from a list. Use when the user asks to remove an item.
        In list chat context, list_id can be omitted.
        """
        lid = list_id or self.list_id
        if not lid:
            return "Error: list_id is required (or open a list chat)."
        if not item_id:
            return "Error: item_id is required."
        try:
            api_url = os.getenv("GO_API_URL", "http://localhost:8080")
            if not api_url.endswith("/api"):
                api_url = f"{api_url}/api"
            headers = {}
            if self.auth_token:
                headers["Authorization"] = f"Bearer {self.auth_token}"
            with httpx.Client(timeout=15.0) as client:
                response = client.delete(
                    f"{api_url}/lists/{lid}/items/{item_id}", headers=headers
                )
            if response.status_code == 401:
                return "Error: Not authorized."
            if response.status_code != 200:
                return f"Error deleting item: HTTP {response.status_code} - {response.text}"
            return "Item deleted."
        except Exception as e:
            logger.error(f"Error deleting list item: {e}")
            return f"Error: {e}"

    def list_projects(self) -> str:
        """
        List all available projects for the current user.

        Use this tool when you need to discover which projects exist and get their IDs.
        This is especially useful when the user asks about a project by name but you don't
        know its ID.

        Returns:
            str: A formatted list of projects with their IDs, names, descriptions, and repo URLs.

        Example Usage:
            - User asks: "What do you know about genie?"
            - Call list_projects() to find the project ID for "genie"
            - Then use search_knowledge(query="...", project_id="<found_id>")
        """
        try:
            api_url = os.getenv("GO_API_URL", "http://localhost:8080")
            headers = {}
            if self.auth_token:
                headers["Authorization"] = f"Bearer {self.auth_token}"

            with httpx.Client(timeout=10.0) as client:
                response = client.get(f"{api_url}/api/projects", headers=headers)

                if response.status_code == 401:
                    return "Error: Not authorized. Please ensure you are logged in."

                if response.status_code != 200:
                    logger.error(
                        f"Failed to list projects: {response.status_code} - {response.text}"
                    )
                    return f"Error fetching projects: HTTP {response.status_code}"

                projects = response.json()

                if not projects:
                    return "No projects found. The user hasn't added any projects yet."

                # Format projects list
                lines = ["# Available Projects\n"]
                for project in projects:
                    project_id = project.get("id") or project.get("ID") or "unknown"
                    name = project.get("name") or project.get("Name") or "Unnamed"
                    description = (
                        project.get("description")
                        or project.get("Description")
                        or "No description"
                    )
                    repo_url = (
                        project.get("repo_url") or project.get("Repository") or ""
                    )
                    status = project.get("status") or project.get("Status") or "unknown"

                    lines.append(f"## {name}")
                    lines.append(f"- **Project ID**: `{project_id}`")
                    lines.append(f"- **Description**: {description}")
                    if repo_url:
                        lines.append(f"- **Repository**: {repo_url}")
                    lines.append(f"- **Status**: {status}")
                    lines.append("")

                return "\n".join(lines)

        except httpx.TimeoutException:
            logger.error("Timeout while fetching projects list")
            return "Error: Timeout while fetching projects. Please try again."
        except Exception as e:
            logger.error(f"Error listing projects: {e}")
            return f"Error listing projects: {str(e)}"
