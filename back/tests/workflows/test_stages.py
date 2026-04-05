import json
from unittest.mock import patch
from src.workflows.planning import _run_extract_stage, _run_recon_stage
from src.workflows.models import StageResult


# ── EXTRACT ──────────────────────────────────────────────────────────────────

SAMPLE_TASKS = [
    {"id": "t1", "title": "Встреча в 14:00", "location": None},
    {"id": "t2", "title": "Зал", "location": None},
    {"id": "t3", "title": "Ужин дома", "location": None},
]

EXTRACT_LLM_RESPONSE = json.dumps({
    "tasks": [
        {"id": "t1", "time_hint": "14:00", "location": "office", "context_type": "place", "constraints": None},
        {"id": "t2", "time_hint": None, "location": "gym", "context_type": "place", "constraints": None},
        {"id": "t3", "time_hint": None, "location": "home", "context_type": "home", "constraints": "evening"},
    ],
    "pending_questions": ["What time is your gym session?"],
})


def test_extract_returns_stage_result():
    with patch("src.workflows.planning._run_agent_text", return_value=EXTRACT_LLM_RESPONSE):
        result = _run_extract_stage(SAMPLE_TASKS, {})
    assert isinstance(result, StageResult)
    assert len(result.output["extracted_tasks"]) == 3


def test_extract_captures_pending_questions():
    with patch("src.workflows.planning._run_agent_text", return_value=EXTRACT_LLM_RESPONSE):
        result = _run_extract_stage(SAMPLE_TASKS, {})
    assert result.pending_questions == ["What time is your gym session?"]
    assert result.is_complete is False


def test_extract_no_questions_when_all_known():
    full_response = json.dumps({
        "tasks": [{"id": "t1", "time_hint": "14:00", "location": "office", "context_type": "place", "constraints": None}],
        "pending_questions": [],
    })
    with patch("src.workflows.planning._run_agent_text", return_value=full_response):
        result = _run_extract_stage(SAMPLE_TASKS[:1], {})
    assert result.pending_questions == []
    assert result.is_complete is True


def test_extract_graceful_fallback_on_bad_json():
    with patch("src.workflows.planning._run_agent_text", return_value="not json at all"):
        result = _run_extract_stage(SAMPLE_TASKS, {})
    assert isinstance(result, StageResult)
    assert result.output["extracted_tasks"] == SAMPLE_TASKS
    assert result.is_complete is False


# ── RECON ─────────────────────────────────────────────────────────────────────

EXTRACTED_TASKS = [
    {"id": "t1", "time_hint": "14:00", "location": "office", "context_type": "place"},
    {"id": "t2", "time_hint": None, "location": "gym", "context_type": "place"},
    {"id": "t3", "time_hint": None, "location": "home", "context_type": "home"},
]


def test_recon_geocodes_non_home_locations():
    with patch("src.workflows.planning.ors_client.geocode", return_value=(37.6, 55.7)) as mock_geo, \
         patch("src.workflows.planning.search_place_hours", return_value="9am-9pm"):
        result = _run_recon_stage(EXTRACTED_TASKS, "2026-04-05", "car")
    # "home" is skipped, "office" and "gym" are geocoded
    assert mock_geo.call_count == 2
    assert "office" in result.output["locations"]
    assert "gym" in result.output["locations"]
    assert "home" not in result.output["locations"]


def test_recon_asks_transport_when_none():
    with patch("src.workflows.planning.ors_client.geocode", return_value=None), \
         patch("src.workflows.planning.search_place_hours", return_value=""):
        result = _run_recon_stage(EXTRACTED_TASKS, "2026-04-05", transport_mode=None)
    assert len(result.pending_questions) == 1
    assert "передвигаться" in result.pending_questions[0]
    assert result.is_complete is False


def test_recon_complete_when_transport_known():
    with patch("src.workflows.planning.ors_client.geocode", return_value=(37.6, 55.7)), \
         patch("src.workflows.planning.search_place_hours", return_value=""):
        result = _run_recon_stage(EXTRACTED_TASKS, "2026-04-05", "walking")
    assert result.is_complete is True
    assert result.pending_questions == []
