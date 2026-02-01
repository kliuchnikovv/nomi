import unittest
from unittest.mock import MagicMock

from src.rag_service import KnowledgeManager, KnowledgeSearchTool


def _unwrap(agent):
    """Unwrap AgentRunWrapper to get the inner agent for isinstance checks."""
    return getattr(agent, "_agent", agent)


class TestProjectRAG(unittest.TestCase):
    def test_add_document_project_scope(self):
        """Test adding document with specific project scope."""
        mock_knowledge = MagicMock()
        manager = KnowledgeManager(user_id="user_123", knowledge=mock_knowledge)

        project_id = "proj_A"
        content = "Project A secret"
        manager.add_document(content, project_id=project_id)

        mock_knowledge.insert.assert_called_once()
        call_kw = mock_knowledge.insert.call_args[1]
        self.assertEqual(call_kw["text_content"], content)
        self.assertEqual(call_kw["metadata"]["project_id"], project_id)
        self.assertEqual(call_kw["metadata"]["user_id"], "user_123")

    def test_add_document_general_scope(self):
        """Test adding document with general scope (no project_id)."""
        mock_knowledge = MagicMock()
        manager = KnowledgeManager(user_id="user_123", knowledge=mock_knowledge)

        content = "General knowledge"
        manager.add_document(content)

        call_kw = mock_knowledge.insert.call_args[1]
        self.assertEqual(call_kw["metadata"]["project_id"], "general")
        self.assertEqual(call_kw["metadata"]["user_id"], "user_123")

    def test_search_filters(self):
        """Test search filters for project and general scopes."""
        mock_knowledge = MagicMock()
        manager = KnowledgeManager(user_id="user_123", knowledge=mock_knowledge)

        manager.search("query", project_id="proj_A")
        mock_knowledge.search.assert_called_with(
            query="query", max_results=5, filters={"user_id": "user_123", "project_id": "proj_A"}
        )

        manager.search("query", project_id=None)
        mock_knowledge.search.assert_called_with(
            query="query", max_results=5, filters={"user_id": "user_123", "project_id": "general"}
        )

    def test_tool_delegation(self):
        """Test tool delegates with correct IDs."""
        mock_manager = MagicMock()
        mock_doc = MagicMock()
        mock_doc.content = "Found it"
        mock_manager.search.return_value = [mock_doc]

        tool = KnowledgeSearchTool(user_id="u1", manager=mock_manager)

        tool.search_knowledge("q1", project_id="p1")
        mock_manager.search.assert_called_with(query="q1", project_id="p1")

        tool.search_knowledge("q2")
        mock_manager.search.assert_called_with(query="q2", project_id=None)


if __name__ == "__main__":
    unittest.main()
