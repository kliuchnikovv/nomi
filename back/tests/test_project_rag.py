import unittest
from unittest.mock import MagicMock, patch
# Adjusted import to match the new source import style, assuming PYTHONPATH set
from src.rag_service import ProjectKnowledgeManager, ProjectSearchTool

class TestProjectRAG(unittest.TestCase):

    @patch("src.rag_service.build_vector_db")
    @patch("src.rag_service.Knowledge")
    def test_add_document_adds_project_id(self, mock_knowledge_cls, mock_build_db):
        """Test that adding a document automatically injects the project_id into metadata."""
        # Setup mocks
        mock_db = MagicMock()
        mock_build_db.return_value = mock_db
        mock_knowledge = MagicMock()
        mock_knowledge_cls.return_value = mock_knowledge

        # Initialize manager
        manager = ProjectKnowledgeManager(db_url="mock://")

        # Action
        project_id = "proj_123"
        content = "Important project info"
        initial_metadata = {"author": "me"}

        manager.add_document_to_project(project_id, content, metadata=initial_metadata)

        # Verify
        mock_knowledge.load_text.assert_called_once()
        call_args = mock_knowledge.load_text.call_args

        # Check arguments (text=content, meta_data=...)
        # Note: we used meta_data keyword in our implementation
        self.assertEqual(call_args.kwargs["text"], content)
        expected_metadata = {"author": "me", "project_id": project_id}
        self.assertEqual(call_args.kwargs["meta_data"], expected_metadata)

    @patch("src.rag_service.build_vector_db")
    @patch("src.rag_service.Knowledge")
    def test_search_filters_by_project_id(self, mock_knowledge_cls, mock_build_db):
        """Test that searching includes the project_id filter."""
        # Setup mocks
        mock_knowledge = MagicMock()
        mock_knowledge_cls.return_value = mock_knowledge

        manager = ProjectKnowledgeManager(db_url="mock://")

        # Action
        project_id = "proj_456"
        query = "find me something"

        manager.search_project(project_id, query)

        # Verify
        mock_knowledge.search.assert_called_once()
        call_args = mock_knowledge.search.call_args

        self.assertEqual(call_args.kwargs["query"], query)
        self.assertEqual(call_args.kwargs["filter"], {"project_id": project_id})

    def test_tool_delegation(self):
        """Test that the ProjectSearchTool delegates to the manager correctly."""
        mock_manager = MagicMock()
        mock_doc = MagicMock()
        mock_doc.content = "Found result"
        mock_manager.search_project.return_value = [mock_doc]

        tool = ProjectSearchTool(manager=mock_manager)

        result = tool.search_project_knowledge("p1", "q1")

        mock_manager.search_project.assert_called_with("p1", "q1")
        self.assertIn("Found result", result)

    def test_tool_no_results(self):
        """Test tool behavior when no results found."""
        mock_manager = MagicMock()
        mock_manager.search_project.return_value = []

        tool = ProjectSearchTool(manager=mock_manager)

        result = tool.search_project_knowledge("p1", "q1")

        self.assertIn("No information found", result)

if __name__ == "__main__":
    unittest.main()
