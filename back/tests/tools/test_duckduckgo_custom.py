
import unittest
from unittest.mock import patch, MagicMock
from src.tools.duckduckgo_custom import DuckDuckGoTools

class TestDuckDuckGoSearch(unittest.TestCase):

    @patch('src.tools.duckduckgo_custom.DDGS')
    def test_duckduckgo_search_successful(self, MockDDGS):
        """Test a successful search call."""
        # Arrange
        mock_instance = MockDDGS.return_value
        mock_results = [{'title': 'Result 1', 'href': 'https://example.com/1', 'body': 'This is result 1.'}]
        mock_instance.text.return_value = mock_results

        ddg_tools = DuckDuckGoTools()

        # Act
        result = ddg_tools.duckduckgo_search("test query")

        # Assert
        self.assertEqual(result, str(mock_results))
        mock_instance.text.assert_called_once_with("test query", max_results=5)

    @patch('src.tools.duckduckgo_custom.DDGS')
    def test_duckduckgo_search_api_error(self, MockDDGS):
        """Test the function's behavior when the API raises an exception."""
        # Arrange
        mock_instance = MockDDGS.return_value
        error_message = "API connection failed"
        mock_instance.text.side_effect = Exception(error_message)

        ddg_tools = DuckDuckGoTools()

        # Act
        result = ddg_tools.duckduckgo_search("test query")

        # Assert
        self.assertEqual(result, f"An error occurred: {error_message}")
        mock_instance.text.assert_called_once_with("test query", max_results=5)

    @patch('src.tools.duckduckgo_custom.DDGS')
    def test_duckduckgo_search_no_results(self, MockDDGS):
        """Test the function's behavior when the API returns no results."""
        # Arrange
        mock_instance = MockDDGS.return_value
        mock_instance.text.return_value = []

        ddg_tools = DuckDuckGoTools()

        # Act
        result = ddg_tools.duckduckgo_search("test query")

        # Assert
        self.assertEqual(result, "No results found.")
        mock_instance.text.assert_called_once_with("test query", max_results=5)

    @patch('src.tools.duckduckgo_custom.DDGS')
    def test_duckduckgo_news_successful(self, MockDDGS):
        """Test a successful news search call."""
        # Arrange
        mock_instance = MockDDGS.return_value
        mock_results = [{'title': 'News 1', 'href': 'https://example.com/news/1', 'body': 'This is news 1.'}]
        mock_instance.news.return_value = mock_results

        ddg_tools = DuckDuckGoTools(news=True)

        # Act
        result = ddg_tools.duckduckgo_news("test query")

        # Assert
        self.assertEqual(result, str(mock_results))
        mock_instance.news.assert_called_once_with("test query", max_results=5)

    @patch('src.tools.duckduckgo_custom.DDGS')
    def test_duckduckgo_news_api_error(self, MockDDGS):
        """Test the news function's behavior when the API raises an exception."""
        # Arrange
        mock_instance = MockDDGS.return_value
        error_message = "API connection failed"
        mock_instance.news.side_effect = Exception(error_message)

        ddg_tools = DuckDuckGoTools(news=True)

        # Act
        result = ddg_tools.duckduckgo_news("test query")

        # Assert
        self.assertEqual(result, f"An error occurred: {error_message}")
        mock_instance.news.assert_called_once_with("test query", max_results=5)

    @patch('src.tools.duckduckgo_custom.DDGS')
    def test_duckduckgo_news_no_results(self, MockDDGS):
        """Test the news function's behavior when the API returns no results."""
        # Arrange
        mock_instance = MockDDGS.return_value
        mock_instance.news.return_value = []

        ddg_tools = DuckDuckGoTools(news=True)

        # Act
        result = ddg_tools.duckduckgo_news("test query")

        # Assert
        self.assertEqual(result, "No results found.")
        mock_instance.news.assert_called_once_with("test query", max_results=5)

if __name__ == '__main__':
    unittest.main()
