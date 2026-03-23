"""Simple tool functions for the Day Planner workflow using DuckDuckGo search."""

import logging

logger = logging.getLogger(__name__)


def _ddg_search(query: str) -> str:
    """Run a DuckDuckGo search and return results as a string."""
    try:
        try:
            from duckduckgo_search import DDGS
        except ImportError:
            from ddgs import DDGS  # type: ignore[no-redef]

        ddgs = DDGS()
        results = list(ddgs.text(query, max_results=3))
        if not results:
            return f"No results found for: {query}"
        lines = []
        for r in results:
            title = r.get("title", "")
            body = r.get("body", "")
            href = r.get("href", "")
            lines.append(f"- {title}: {body} ({href})")
        return "\n".join(lines)
    except Exception as exc:
        logger.warning("[PlanningTools] Search failed for %r: %s", query, exc)
        return f"Search unavailable: {exc}"


def search_route_time(origin: str, destination: str) -> str:
    """Search for estimated travel time between two locations.

    Args:
        origin: Starting location.
        destination: Destination location.

    Returns:
        Search results with estimated travel time as a string.
    """
    query = f"travel time from {origin} to {destination} by public transport"
    return _ddg_search(query)


def search_place_hours(place_name: str, date: str) -> str:
    """Search for opening hours of a place on a given date.

    Args:
        place_name: Name of the place to search for.
        date: Date string (e.g. "2024-03-23" or "Monday").

    Returns:
        Search results with opening hours as a string.
    """
    query = f"{place_name} opening hours {date}"
    return _ddg_search(query)


def search_weather(location: str, date: str) -> str:
    """Search for weather forecast for a location on a given date.

    Args:
        location: Location to check weather for.
        date: Date string (e.g. "2024-03-23" or "tomorrow").

    Returns:
        Search results with weather forecast as a string.
    """
    query = f"weather {location} {date}"
    return _ddg_search(query)
