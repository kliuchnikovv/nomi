from unittest.mock import patch, MagicMock
import httpx
from src.workflows import ors_client


def _mock_geocode_response():
    return {
        "features": [
            {
                "geometry": {"coordinates": [37.617, 55.755]},
                "properties": {"label": "Moscow, Russia"},
            }
        ]
    }


def _mock_directions_response():
    return {
        "routes": [
            {
                "summary": {"duration": 1500.0, "distance": 8000.0}
            }
        ]
    }


def test_geocode_returns_lon_lat():
    mock_resp = MagicMock()
    mock_resp.json.return_value = _mock_geocode_response()
    mock_resp.raise_for_status = MagicMock()

    with patch("src.workflows.ors_client.httpx.get", return_value=mock_resp):
        with patch.dict("os.environ", {"ORS_API_KEY": "test-key"}):
            result = ors_client.geocode("Moscow")

    assert result == (37.617, 55.755)


def test_geocode_returns_none_when_no_features():
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"features": []}
    mock_resp.raise_for_status = MagicMock()

    with patch("src.workflows.ors_client.httpx.get", return_value=mock_resp):
        with patch.dict("os.environ", {"ORS_API_KEY": "test-key"}):
            result = ors_client.geocode("nowhere")

    assert result is None


def test_geocode_returns_none_without_api_key():
    with patch.dict("os.environ", {}, clear=True):
        result = ors_client.geocode("Moscow")
    assert result is None


def test_get_travel_time_returns_minutes():
    mock_resp = MagicMock()
    mock_resp.json.return_value = _mock_directions_response()
    mock_resp.raise_for_status = MagicMock()

    with patch("src.workflows.ors_client.httpx.post", return_value=mock_resp):
        with patch.dict("os.environ", {"ORS_API_KEY": "test-key"}):
            result = ors_client.get_travel_time(
                (37.617, 55.755), (37.620, 55.760), "foot-walking"
            )

    assert result == 25  # 1500 sec / 60 = 25 min


def test_get_travel_time_fallback_on_empty_routes():
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"routes": []}
    mock_resp.raise_for_status = MagicMock()

    with patch("src.workflows.ors_client.httpx.post", return_value=mock_resp):
        with patch.dict("os.environ", {"ORS_API_KEY": "test-key"}):
            result = ors_client.get_travel_time((0.0, 0.0), (1.0, 1.0))

    assert result == 30  # fallback default


def test_get_travel_time_returns_30_without_api_key():
    with patch.dict("os.environ", {}, clear=True):
        result = ors_client.get_travel_time((0.0, 0.0), (1.0, 1.0))
    assert result == 30


def test_geocode_returns_none_on_http_error():
    with patch("src.workflows.ors_client.httpx.get", side_effect=httpx.ConnectError("connection refused")):
        with patch.dict("os.environ", {"ORS_API_KEY": "test-key"}):
            result = ors_client.geocode("Moscow")
    assert result is None


def test_get_travel_time_returns_30_on_http_error():
    with patch("src.workflows.ors_client.httpx.post", side_effect=httpx.ConnectError("connection refused")):
        with patch.dict("os.environ", {"ORS_API_KEY": "test-key"}):
            result = ors_client.get_travel_time((0.0, 0.0), (1.0, 1.0))
    assert result == 30
