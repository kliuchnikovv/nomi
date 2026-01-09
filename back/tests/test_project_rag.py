import unittest
from unittest.mock import MagicMock, patch
# Adjusted import to match the new source import style, assuming PYTHONPATH set
from src.rag_service import KnowledgeManager, KnowledgeSearchTool

class TestProjectRAG(unittest.TestCase):

    @patch("src.rag_service.build_vector_db")
    @patch("src.rag_service.UserScopedKnowledge")
    def test_add_document_project_scope(self, mock_knowledge_cls, mock_build_db):
        """Test adding document with specific project scope."""
        # Setup mocks
        mock_knowledge = MagicMock()
        mock_knowledge_cls.return_value = mock_knowledge

        manager = KnowledgeManager(user_id="user_123", db_url="mock://")

        # Action
        project_id = "proj_A"
        content = "Project A secret"

        manager.add_document(content, project_id=project_id)

        # Verify
        mock_knowledge.load_text.assert_called_once()
        call_args = mock_knowledge.load_text.call_args

        self.assertEqual(call_args.kwargs["text"], content)
        self.assertEqual(call_args.kwargs["meta_data"]["project_id"], project_id)

    @patch("src.rag_service.build_vector_db")
    @patch("src.rag_service.UserScopedKnowledge")
    def test_add_document_general_scope(self, mock_knowledge_cls, mock_build_db):
        """Test adding document with general scope (no project_id)."""
        mock_knowledge = MagicMock()
        mock_knowledge_cls.return_value = mock_knowledge

        manager = KnowledgeManager(user_id="user_123", db_url="mock://")

        # Action
        content = "General knowledge"
        manager.add_document(content) # No project_id

        # Verify
        call_args = mock_knowledge.load_text.call_args
        self.assertEqual(call_args.kwargs["meta_data"]["project_id"], "general")

    @patch("src.rag_service.build_vector_db")
    @patch("src.rag_service.Knowledge")
    @patch("src.rag_service.UserScopedKnowledge")
    def test_search_filters(self, mock_user_knowledge_cls, mock_knowledge_cls, mock_build_db):
        """Test search filters for project and general scopes."""
        mock_user_knowledge = MagicMock()
        mock_user_knowledge_cls.return_value = mock_user_knowledge
        
        mock_knowledge = MagicMock()
        mock_knowledge_cls.return_value = mock_knowledge

        manager = KnowledgeManager(user_id="user_123", db_url="mock://")

        # Test Project Search (uses base_knowledge which is Knowledge)
        manager.search("query", project_id="proj_A")
        mock_knowledge.search.assert_called_with(query="query", max_results=5, filters={"project_id": "proj_A"})

        # Test General Search (uses knowledge which is UserScopedKnowledge)
        manager.search("query", project_id=None)
        mock_user_knowledge.search.assert_called_with(query="query", max_results=5, filters={"project_id": "general"})

    def test_tool_delegation(self):
        """Test tool delegates with correct IDs."""
        mock_manager = MagicMock()
        mock_doc = MagicMock()
        mock_doc.content = "Found it"
        mock_manager.search.return_value = [mock_doc]

        tool = KnowledgeSearchTool(user_id="u1", manager=mock_manager)

        # Test specific project
        tool.search_knowledge("q1", project_id="p1")
        mock_manager.search.assert_called_with(query="q1", project_id="p1")

        # Test general
        tool.search_knowledge("q2")
        mock_manager.search.assert_called_with(query="q2", project_id=None)

if __name__ == "__main__":
    unittest.main()
