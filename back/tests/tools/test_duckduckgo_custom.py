from unittest.mock import MagicMock, patch


class TestDuckDuckGoTools:
    @patch("src.tools.duckduckgo_custom.DDGS")
    def test_initialization_default(self, mock_ddgs):
        from src.tools.duckduckgo_custom import DuckDuckGoTools

        tools = DuckDuckGoTools()
        assert tools.name == "web_search"
        assert tools.fixed_max_results is None
        mock_ddgs.assert_called_once()

    @patch("src.tools.duckduckgo_custom.DDGS")
    def test_initialization_with_params(self, mock_ddgs):
        from src.tools.duckduckgo_custom import DuckDuckGoTools

        tools = DuckDuckGoTools(
            news=True,
            fixed_max_results=10,
            proxy="http://proxy.com",
            timeout=30,
        )
        assert tools.news is True
        assert tools.fixed_max_results == 10
        assert tools.proxy == "http://proxy.com"
        assert tools.timeout == 30
        mock_ddgs.assert_called_once_with(proxy="http://proxy.com", timeout=30)

    @patch("src.tools.duckduckgo_custom.DDGS")
    def test_search_uses_fixed_max_results(self, mock_ddgs):
        from src.tools.duckduckgo_custom import DuckDuckGoTools

        mock_ddgs_instance = MagicMock()
        mock_ddgs.return_value = mock_ddgs_instance
        mock_ddgs_instance.text.return_value = [{"title": "Result"}]

        tools = DuckDuckGoTools(fixed_max_results=5)
        tools.duckduckgo_search("test query", max_results=10)

        mock_ddgs_instance.text.assert_called_once_with("test query", max_results=5)

    @patch("src.tools.duckduckgo_custom.DDGS")
    def test_search_uses_max_results_param(self, mock_ddgs):
        from src.tools.duckduckgo_custom import DuckDuckGoTools

        mock_ddgs_instance = MagicMock()
        mock_ddgs.return_value = mock_ddgs_instance
        mock_ddgs_instance.text.return_value = [{"title": "Result"}]

        tools = DuckDuckGoTools()
        tools.duckduckgo_search("test query", max_results=3)

        mock_ddgs_instance.text.assert_called_once_with("test query", max_results=3)

    @patch("src.tools.duckduckgo_custom.DDGS")
    def test_search_returns_string(self, mock_ddgs):
        from src.tools.duckduckgo_custom import DuckDuckGoTools

        mock_ddgs_instance = MagicMock()
        mock_ddgs.return_value = mock_ddgs_instance
        mock_ddgs_instance.text.return_value = [
            {"title": "Test Result", "url": "http://example.com"}
        ]

        tools = DuckDuckGoTools()
        result = tools.duckduckgo_search("test query")

        assert isinstance(result, str)

    @patch("src.tools.duckduckgo_custom.DDGS")
    def test_news_registers_duckduckgo_news(self, mock_ddgs):
        from src.tools.duckduckgo_custom import DuckDuckGoTools

        tools = DuckDuckGoTools(news=True)
        assert hasattr(tools, "duckduckgo_news")

    @patch("src.tools.duckduckgo_custom.DDGS")
    def test_news_search(self, mock_ddgs):
        from src.tools.duckduckgo_custom import DuckDuckGoTools

        mock_ddgs_instance = MagicMock()
        mock_ddgs.return_value = mock_ddgs_instance
        mock_ddgs_instance.news.return_value = [{"title": "News Result"}]

        tools = DuckDuckGoTools(news=True)
        tools.duckduckgo_news("test query", max_results=5)

        mock_ddgs_instance.news.assert_called_once_with("test query", max_results=5)
