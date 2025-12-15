from typing import Optional, Any

from agno.tools import Toolkit
from agno.utils.log import logger

try:
    from duckduckgo_search import DDGS
except ImportError:
    try:
        from ddgs import DDGS
    except ImportError:
        logger.error("`duckduckgo-search` not installed")
        raise ImportError("`duckduckgo-search` not installed")

class DuckDuckGoTools(Toolkit):
    def __init__(
        self,
        news: bool = False,
        fixed_max_results: Optional[int] = None,
        headers: Optional[Any] = None,
        proxy: Optional[str] = None,
        proxies: Optional[Any] = None,
        timeout: Optional[int] = None,
    ):
        super().__init__(name="duckduckgo_search")

        self.news = news
        self.fixed_max_results = fixed_max_results
        self.headers = headers
        self.proxy = proxy
        self.proxies = proxies
        self.timeout = timeout
        self.ddgs = DDGS(headers=headers, proxy=proxy, proxies=proxies, timeout=timeout)

        self.register(self.duckduckgo_search)
        if self.news:
            self.register(self.duckduckgo_news)

    def duckduckgo_search(self, query: str, max_results: int = 5) -> str:
        """Use this function to search DuckDuckGo for a query.

        Args:
            query (str): The query to search for.
            max_results (int): The maximum number of results to return.

        Returns:
            str: The result of the search.
        """
        if self.fixed_max_results:
            max_results = self.fixed_max_results

        return str(list(self.ddgs.text(query, max_results=max_results)))

    def duckduckgo_news(self, query: str, max_results: int = 5) -> str:
        """Use this function to search DuckDuckGo News for a query.

        Args:
            query (str): The query to search for.
            max_results (int): The maximum number of results to return.

        Returns:
            str: The result of the search.
        """
        if self.fixed_max_results:
            max_results = self.fixed_max_results

        return str(list(self.ddgs.news(query, max_results=max_results)))
