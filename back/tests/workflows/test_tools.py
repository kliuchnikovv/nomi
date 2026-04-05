from unittest.mock import patch, MagicMock
from src.workflows.tools import search_place_hours, search_weather, search_route_time_text


def _mock_ddg(results):
    mock_ddgs = MagicMock()
    mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
    mock_ddgs.__exit__ = MagicMock(return_value=False)
    mock_ddgs.text.return_value = results
    return mock_ddgs


def test_search_place_hours_returns_string():
    results = [{"title": "Gym", "body": "Open 8am-10pm", "href": "http://x.com"}]
    mock_ddgs_instance = _mock_ddg(results)
    with patch("src.workflows.tools.DDGS", return_value=mock_ddgs_instance):
        out = search_place_hours("Gold's Gym", "Monday")
    assert "8am" in out
    mock_ddgs_instance.text.assert_called_once_with("Gold's Gym opening hours Monday", max_results=3)


def test_search_weather_returns_string():
    results = [{"title": "Weather", "body": "Sunny 20C", "href": "http://x.com"}]
    mock_ddgs_instance = _mock_ddg(results)
    with patch("src.workflows.tools.DDGS", return_value=mock_ddgs_instance):
        out = search_weather("Moscow", "2026-04-05")
    assert "Sunny" in out
    mock_ddgs_instance.text.assert_called_once_with("weather Moscow 2026-04-05", max_results=3)


def test_search_route_time_text_returns_string():
    results = [{"title": "Route", "body": "25 minutes by car", "href": "http://x.com"}]
    mock_ddgs_instance = _mock_ddg(results)
    with patch("src.workflows.tools.DDGS", return_value=mock_ddgs_instance):
        out = search_route_time_text("gym", "office")
    assert "25" in out
    mock_ddgs_instance.text.assert_called_once_with("travel time from gym to office", max_results=3)
