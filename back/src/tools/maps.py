"""MapsTool — route building and place search via Apple Maps URL scheme."""
from __future__ import annotations

import json
import logging
import math
from urllib.parse import quote_plus

import requests
from agno.tools import Toolkit

from src.workflows import ors_client

logger = logging.getLogger(__name__)

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_NOMINATIM_GEOCODE_URL = "https://nominatim.openstreetmap.org/search"
_NOMINATIM_HEADERS = {"User-Agent": "Genie-AI/1.0"}


def _nominatim_geocode(address: str) -> tuple[float, float] | None:
    """Geocode an address via Nominatim (lon, lat). Used as fallback when ORS is unavailable."""
    try:
        resp = requests.get(
            _NOMINATIM_GEOCODE_URL,
            params={"q": address, "limit": 1, "format": "json"},
            headers=_NOMINATIM_HEADERS,
            timeout=8,
        )
        resp.raise_for_status()
        results = resp.json()
        if not results:
            return None
        return (float(results[0]["lon"]), float(results[0]["lat"]))
    except Exception as exc:
        logger.warning("[MapsTool] Nominatim geocode fallback failed for %r: %s", address, exc)
        return None


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return distance in metres between two lat/lon points."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _encode_stop(s: str) -> str:
    """Encode a stop name for Apple Maps URLs (spaces as +)."""
    return quote_plus(s)


def _distance_label(metres: float) -> str:
    if metres < 1000:
        return f"{int(metres)}м"
    return f"{metres / 1000:.1f}км"


class MapsTool(Toolkit):
    """Toolkit for building Apple Maps routes and searching nearby places."""

    def __init__(self) -> None:
        super().__init__(name="maps")
        self.register(self.open_route)
        self.register(self.search_places)

    def open_route(self, stops: list[str], mode: str = "driving") -> str:
        """Build a navigation route and return an "Open in Maps" button for the user.

        Call this whenever the user asks for directions, a route, or how to get somewhere.
        The result includes an action button that opens Apple Maps directly — always call
        this tool instead of describing the route in plain text.

        Args:
            stops: List of address/place name strings to navigate through (1–10 items).
                   Route starts from the user's current location automatically.
            mode: Travel mode — "driving", "walking", or "cycling".

        Returns:
            JSON string: {"text": "...", "actions": [{"command": "open_maps", "label": "...", "url": "maps://..."}]}
        """
        if not stops:
            return json.dumps({"text": "Не указаны остановки маршрута.", "actions": []})

        encoded = [_encode_stop(s) for s in stops]
        # No saddr — Apple Maps defaults to current location as starting point.
        url = f"maps://?daddr={'+to:'.join(encoded)}"

        mode_labels = {"driving": "на машине", "walking": "пешком", "cycling": "на велосипеде"}
        mode_label = mode_labels.get(mode, mode)
        route_text = " → ".join(stops)
        text = f"Маршрут {mode_label}: {route_text}"

        return json.dumps({
            "text": text,
            "actions": [
                {"command": "open_maps", "label": "Открыть маршрут в Maps", "url": url},
            ],
        }, ensure_ascii=False)

    def search_places(self, query: str, near: str, radius_km: float = 3.0) -> str:
        """Search for nearby places and return a list with "Open in Maps" buttons.

        Call this whenever the user asks to find nearby places — stores, cafés, pharmacies,
        restaurants, gyms, etc. This returns action buttons the user can tap to open each
        place in Apple Maps. Always use this tool instead of listing places as plain text.

        Args:
            query: What to search for (e.g. "Lidl", "supermarket", "coffee shop", "pharmacy").
            near: The reference location — use the user's current location if known,
                  otherwise a landmark or city they mentioned (e.g. "Sant Estació, Barcelona").
            radius_km: Search radius in kilometres (default 3.0).

        Returns:
            JSON string: {"text": "...", "actions": [...]} where each action has an
            "Open in Maps" button for that specific place.
        """
        near_coords: tuple[float, float] | None = None
        try:
            near_coords = ors_client.geocode(near)
        except Exception as exc:
            logger.warning("[MapsTool] ORS geocode failed for %r: %s", near, exc)

        # Fall back to Nominatim geocoding if ORS is unavailable or returned nothing
        if not near_coords:
            near_coords = _nominatim_geocode(near)
            if near_coords:
                logger.info("[MapsTool] Used Nominatim geocode fallback for %r", near)

        params: dict = {
            "q": query,
            "limit": 5,
            "format": "json",
            "addressdetails": 1,
        }

        if near_coords:
            lon, lat = near_coords  # ors_client.geocode returns (lon, lat)
            deg = radius_km / 111.0  # rough degrees per km
            params["viewbox"] = f"{lon - deg},{lat + deg},{lon + deg},{lat - deg}"
            params["bounded"] = 1

        try:
            resp = requests.get(_NOMINATIM_URL, params=params, headers=_NOMINATIM_HEADERS, timeout=8)
            resp.raise_for_status()
            results = resp.json()
        except Exception as exc:
            logger.warning("[MapsTool] Nominatim request failed: %s", exc)
            return json.dumps({"text": f"Ошибка поиска: {exc}", "actions": []}, ensure_ascii=False)

        if not results:
            return json.dumps(
                {"text": f"Ничего не найдено по запросу «{query}» рядом с {near}.", "actions": []},
                ensure_ascii=False,
            )

        actions = []
        for place in results:
            display = place.get("display_name", "")
            # Take first two comma-parts as the short name
            parts = [p.strip() for p in display.split(",")]
            short_name = ", ".join(parts[:2]) if len(parts) >= 2 else display

            place_lat = float(place.get("lat", 0))
            place_lon = float(place.get("lon", 0))

            dist_suffix = ""
            if near_coords:
                dist_m = _haversine_m(near_coords[1], near_coords[0], place_lat, place_lon)
                dist_suffix = f" ({_distance_label(dist_m)})"

            label = f"{short_name}{dist_suffix}"
            # Use exact coordinates so Apple Maps opens the precise Nominatim result
            # rather than re-geocoding the address string (which can return a different place).
            url = f"maps://?daddr={place_lat},{place_lon}"
            actions.append({"command": "open_maps", "label": label, "url": url})

        text = f"Ближайшие «{query}» рядом с {near}:"
        return json.dumps({"text": text, "actions": actions}, ensure_ascii=False)
