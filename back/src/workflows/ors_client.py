"""OpenRouteService client for geocoding and routing."""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)

ORS_BASE = "https://api.openrouteservice.org"


def geocode(address: str) -> tuple[float, float] | None:
    """Geocode an address string to (lon, lat).

    Returns None if no API key is set or if the address cannot be resolved.
    """
    api_key = os.getenv("ORS_API_KEY", "")
    if not api_key:
        logger.debug("[ORS] ORS_API_KEY not set, skipping geocode for %r", address)
        return None

    try:
        resp = httpx.get(
            f"{ORS_BASE}/geocode/search",
            params={"api_key": api_key, "text": address, "size": 1},
            timeout=10,
        )
        resp.raise_for_status()
        features = resp.json().get("features", [])
        if not features:
            return None
        coords = features[0]["geometry"]["coordinates"]  # [lon, lat]
        return (float(coords[0]), float(coords[1]))
    except Exception as exc:
        logger.warning("[ORS] Geocode failed for %r: %s", address, exc)
        return None


def get_travel_time(
    origin: tuple[float, float],
    destination: tuple[float, float],
    profile: str = "foot-walking",
) -> int:
    """Get travel time in minutes between two (lon, lat) coordinates.

    profile options: "foot-walking", "driving-car", "cycling-regular"
    Returns 30 as fallback if the request fails or returns no routes.
    """
    api_key = os.getenv("ORS_API_KEY", "")

    try:
        resp = httpx.post(
            f"{ORS_BASE}/v2/directions/{profile}",
            headers={"Authorization": api_key},
            json={"coordinates": [list(origin), list(destination)]},
            timeout=15,
        )
        resp.raise_for_status()
        routes = resp.json().get("routes", [])
        if not routes:
            return 30
        duration_sec = routes[0]["summary"]["duration"]
        return max(1, round(duration_sec / 60))
    except Exception as exc:
        logger.warning("[ORS] Routing failed (%s → %s, %s): %s", origin, destination, profile, exc)
        return 30
