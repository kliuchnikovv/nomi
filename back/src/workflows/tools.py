"""DDG search helpers for the day planner workflow."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

try:
    from duckduckgo_search import DDGS
except ImportError:
    from ddgs import DDGS  # type: ignore[no-redef]


def _ddg_search(query: str) -> str:
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=3))
        if not results:
            return f"No results for: {query}"
        lines = [f"- {r.get('title', '')}: {r.get('body', '')} ({r.get('href', '')})" for r in results]
        return "\n".join(lines)
    except Exception as exc:
        logger.warning("[PlannerTools] DDG search failed for %r: %s", query, exc)
        return f"Search unavailable: {exc}"


def search_place_hours(place_name: str, date: str) -> str:
    """Search opening hours for a place on a given date."""
    return _ddg_search(f"{place_name} opening hours {date}")


def search_weather(location: str, date: str) -> str:
    """Search weather forecast for a location on a given date."""
    return _ddg_search(f"weather {location} {date}")


def search_route_time_text(origin: str, destination: str) -> str:
    """DDG fallback for travel time when ORS coords are unavailable."""
    return _ddg_search(f"travel time from {origin} to {destination}")
