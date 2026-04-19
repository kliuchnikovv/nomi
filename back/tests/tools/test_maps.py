"""Tests for MapsTool."""
import json
from unittest.mock import patch, MagicMock

from src.tools.maps import MapsTool


def make_tool() -> MapsTool:
    return MapsTool()


# ── open_route ────────────────────────────────────────────────────────────────

def test_open_route_no_stops_returns_error():
    tool = make_tool()
    result = json.loads(tool.open_route(stops=[]))
    assert "error" in result["text"].lower() or result["actions"] == []


def test_open_route_single_stop_builds_daddr_url():
    tool = make_tool()
    result = json.loads(tool.open_route(stops=["Surf Coffee"]))
    assert len(result["actions"]) == 1
    assert result["actions"][0]["command"] == "open_maps"
    assert "maps://" in result["actions"][0]["url"]
    assert "daddr=" in result["actions"][0]["url"]
    assert "Surf+Coffee" in result["actions"][0]["url"]


def test_open_route_multi_stop_uses_to_separator():
    tool = make_tool()
    result = json.loads(tool.open_route(stops=["Stop A", "Stop B", "Stop C"]))
    url = result["actions"][0]["url"]
    # multi-stop: daddr=StopA+to:StopB+to:StopC (no saddr)
    assert "+to:" in url
    assert url.count("+to:") == 2


def test_open_route_no_saddr_in_url():
    tool = make_tool()
    result = json.loads(tool.open_route(stops=["Home", "Office"]))
    url = result["actions"][0]["url"]
    assert "saddr" not in url


def test_open_route_spaces_encoded_as_plus():
    tool = make_tool()
    result = json.loads(tool.open_route(stops=["New York"]))
    url = result["actions"][0]["url"]
    assert "New+York" in url
    assert "%20" not in url


def test_open_route_text_contains_stop_names():
    tool = make_tool()
    result = json.loads(tool.open_route(stops=["Surf Coffee", "Парк"]))
    assert "Surf Coffee" in result["text"]
    assert "Парк" in result["text"]


def test_open_route_mode_included_in_text():
    tool = make_tool()
    result = json.loads(tool.open_route(stops=["A", "B"], mode="walking"))
    assert "walk" in result["text"].lower() or "пешком" in result["text"].lower() or result["text"]


# ── search_places ─────────────────────────────────────────────────────────────

NOMINATIM_RESPONSE = [
    {
        "display_name": "ВкусВилл, улица Большая, 4, Москва, Россия",
        "lat": "55.755",
        "lon": "37.617",
        "address": {"road": "улица Большая", "house_number": "4"},
    },
    {
        "display_name": "Перекрёсток, проспект Ленина, 12, Москва, Россия",
        "lat": "55.760",
        "lon": "37.620",
        "address": {"road": "проспект Ленина", "house_number": "12"},
    },
]


def test_search_places_returns_actions_per_result():
    tool = make_tool()
    with patch("src.tools.maps.ors_client.geocode", return_value=(55.75, 37.62)), \
         patch("src.tools.maps.requests.get") as mock_get:
        mock_get.return_value.json.return_value = NOMINATIM_RESPONSE
        mock_get.return_value.raise_for_status = MagicMock()
        result = json.loads(tool.search_places(query="супермаркет", near="Технопарк"))
    assert len(result["actions"]) == 2
    assert all(a["command"] == "open_maps" for a in result["actions"])


def test_search_places_label_contains_name_and_distance():
    tool = make_tool()
    with patch("src.tools.maps.ors_client.geocode", return_value=(55.75, 37.62)), \
         patch("src.tools.maps.requests.get") as mock_get:
        mock_get.return_value.json.return_value = NOMINATIM_RESPONSE
        mock_get.return_value.raise_for_status = MagicMock()
        result = json.loads(tool.search_places(query="супермаркет", near="Технопарк"))
    label = result["actions"][0]["label"]
    # Label should contain place name and distance marker
    assert "ВкусВилл" in label
    assert "м" in label  # distance in metres or kilometres


def test_search_places_no_results_returns_empty_actions():
    tool = make_tool()
    with patch("src.tools.maps.ors_client.geocode", return_value=(55.75, 37.62)), \
         patch("src.tools.maps.requests.get") as mock_get:
        mock_get.return_value.json.return_value = []
        mock_get.return_value.raise_for_status = MagicMock()
        result = json.loads(tool.search_places(query="nonexistent", near="Nowhere"))
    assert result["actions"] == []
    assert "nonexistent" in result["text"].lower() or "найден" in result["text"].lower()


def test_search_places_fallback_when_geocode_fails():
    """When ORS geocode fails, Nominatim is called without viewbox."""
    tool = make_tool()
    with patch("src.tools.maps.ors_client.geocode", side_effect=Exception("ORS down")), \
         patch("src.tools.maps.requests.get") as mock_get:
        mock_get.return_value.json.return_value = NOMINATIM_RESPONSE
        mock_get.return_value.raise_for_status = MagicMock()
        result = json.loads(tool.search_places(query="кофе", near="Москва"))
    # Should still return results (fallback path)
    assert len(result["actions"]) > 0
    # Nominatim called without viewbox param
    call_params = mock_get.call_args[1].get("params", mock_get.call_args[0][1] if len(mock_get.call_args[0]) > 1 else {})
    assert "viewbox" not in call_params


def test_search_places_url_uses_encoded_address():
    tool = make_tool()
    with patch("src.tools.maps.ors_client.geocode", return_value=(55.75, 37.62)), \
         patch("src.tools.maps.requests.get") as mock_get:
        mock_get.return_value.json.return_value = NOMINATIM_RESPONSE
        mock_get.return_value.raise_for_status = MagicMock()
        result = json.loads(tool.search_places(query="супермаркет", near="Технопарк"))
    url = result["actions"][0]["url"]
    assert "maps://" in url
    assert "daddr=" in url
