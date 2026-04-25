import json
from unittest.mock import patch
from src.workflows.planning import _run_extract_stage, _run_recon_stage, _run_cluster_stage, _run_route_stage, _run_build_stage
from src.workflows.models import StageResult


# ── EXTRACT ──────────────────────────────────────────────────────────────────

SAMPLE_TASKS = [
    {"id": "t1", "title": "Meeting at 14:00", "location": None},
    {"id": "t2", "title": "Gym", "location": None},
    {"id": "t3", "title": "Dinner at home", "location": None},
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
         patch("src.workflows.planning.search_place_hours", return_value="9am-9pm"), \
         patch("src.workflows.planning.search_transport_news", return_value=""), \
         patch("src.workflows.planning.search_city_events", return_value=""):
        result = _run_recon_stage(EXTRACTED_TASKS, "2026-04-05", "car")
    # "home" is skipped, "office" and "gym" are geocoded
    assert mock_geo.call_count == 2
    assert "office" in result.output["locations"]
    assert "gym" in result.output["locations"]
    assert "home" not in result.output["locations"]


def test_recon_asks_transport_when_none():
    with patch("src.workflows.planning.ors_client.geocode", return_value=None), \
         patch("src.workflows.planning.search_place_hours", return_value=""), \
         patch("src.workflows.planning.search_transport_news", return_value=""), \
         patch("src.workflows.planning.search_city_events", return_value=""):
        result = _run_recon_stage(EXTRACTED_TASKS, "2026-04-05", transport_mode=None)
    assert len(result.pending_questions) == 1
    assert "travel" in result.pending_questions[0].lower()
    assert result.is_complete is False


def test_recon_complete_when_transport_known():
    with patch("src.workflows.planning.ors_client.geocode", return_value=(37.6, 55.7)), \
         patch("src.workflows.planning.search_place_hours", return_value=""), \
         patch("src.workflows.planning.search_transport_news", return_value=""), \
         patch("src.workflows.planning.search_city_events", return_value=""):
        result = _run_recon_stage(EXTRACTED_TASKS, "2026-04-05", "walking")
    assert result.is_complete is True
    assert result.pending_questions == []


# ── CLUSTER ───────────────────────────────────────────────────────────────────

EXTRACTED_FOR_CLUSTER = [
    {"id": "t1", "time_hint": "09:00", "location": "home", "context_type": "home"},
    {"id": "t2", "time_hint": None, "location": "gym", "context_type": "place"},
    {"id": "t3", "time_hint": "14:00", "location": "office", "context_type": "place"},
    {"id": "t4", "time_hint": None, "location": "home", "context_type": "home"},
]

CLUSTER_LLM_RESPONSE = json.dumps({
    "clusters": [
        {"location": "home", "context_type": "home", "task_ids": ["t1"]},
        {"location": "gym", "context_type": "place", "task_ids": ["t2"]},
        {"location": "office", "context_type": "place", "task_ids": ["t3"]},
        {"location": "home", "context_type": "home", "task_ids": ["t4"]},
    ],
    "pending_questions": [],
})

LOCATIONS = {
    "gym": {"coords": (37.60, 55.75), "hours": "7am-10pm"},
    "office": {"coords": (37.62, 55.76), "hours": "9am-6pm"},
    "home": {"coords": (37.61, 55.74), "hours": ""},
}


def test_cluster_returns_ordered_clusters():
    with patch("src.workflows.planning._run_agent_text", return_value=CLUSTER_LLM_RESPONSE):
        result = _run_cluster_stage(EXTRACTED_FOR_CLUSTER, LOCATIONS)
    assert len(result.output["clusters"]) == 4
    assert result.output["clusters"][0]["location"] == "home"


def test_cluster_fallback_one_cluster_per_task():
    with patch("src.workflows.planning._run_agent_text", return_value="bad json"):
        result = _run_cluster_stage(EXTRACTED_FOR_CLUSTER, LOCATIONS)
    assert len(result.output["clusters"]) == len(EXTRACTED_FOR_CLUSTER)


# ── ROUTE ─────────────────────────────────────────────────────────────────────

CLUSTERS = [
    {"location": "home", "context_type": "home", "task_ids": ["t1"]},
    {"location": "gym", "context_type": "place", "task_ids": ["t2"]},
    {"location": "office", "context_type": "place", "task_ids": ["t3"]},
    {"location": "home", "context_type": "home", "task_ids": ["t4"]},
]


def test_route_creates_travel_blocks_between_clusters():
    with patch("src.workflows.planning.ors_client.get_travel_time", return_value=20):
        result = _run_route_stage(CLUSTERS, LOCATIONS, "car")
    # home→gym, gym→office, office→home — 3 travel blocks
    assert len(result.output["travel_blocks"]) == 3


def test_route_skips_same_location_clusters():
    same_loc = [
        {"location": "office", "context_type": "place", "task_ids": ["t1"]},
        {"location": "office", "context_type": "place", "task_ids": ["t2"]},
    ]
    with patch("src.workflows.planning.ors_client.get_travel_time", return_value=5):
        result = _run_route_stage(same_loc, LOCATIONS, "walking")
    assert len(result.output["travel_blocks"]) == 0


def test_route_uses_ddg_fallback_when_no_coords():
    no_coords = {"office": {"coords": None, "hours": ""}}
    clusters_no_coords = [
        {"location": "home", "context_type": "home", "task_ids": ["t1"]},
        {"location": "office", "context_type": "place", "task_ids": ["t2"]},
    ]
    with patch("src.workflows.planning.search_route_time_text", return_value="about 20 minutes"), \
         patch("src.workflows.planning._run_agent_text", return_value="20"):
        result = _run_route_stage(clusters_no_coords, no_coords, "car")
    assert result.output["travel_blocks"][0]["duration_min"] == 20


def test_route_travel_block_title_format():
    with patch("src.workflows.planning.ors_client.get_travel_time", return_value=25):
        result = _run_route_stage(CLUSTERS[:2], LOCATIONS, "walking")
    block = result.output["travel_blocks"][0]
    assert "gym" in block["title"].lower() or "gym" in block["to_location"]


# ── BUILD ─────────────────────────────────────────────────────────────────────

BUILD_LLM_RESPONSE = json.dumps({
    "patches": [
        {"op": "add_item", "item": {"id": "travel-1", "text": "Head to gym", "depth": 0, "checked": False, "chips": []}},
        {"op": "add_chip", "item_id": "t1", "chip": {"type": "time", "value": "09:00-09:30", "id": "c1"}},
        {"op": "add_chip", "item_id": "t2", "chip": {"type": "time", "value": "10:00-11:00", "id": "c2"}},
        {"op": "reorder_items", "ids": ["t1", "travel-1", "t2"]},
    ],
    "summary": "Added times and travel task",
})


def test_build_stores_patches_in_output():
    with patch("src.workflows.planning._run_agent_text", return_value=BUILD_LLM_RESPONSE):
        result = _run_build_stage(
            tasks=EXTRACTED_FOR_CLUSTER,
            clusters=CLUSTERS,
            travel_blocks=[{"title": "Head to gym", "from_location": "home", "to_location": "gym", "duration_min": 20, "mode": "foot-walking", "insert_before_cluster_index": 1}],
            locations=LOCATIONS,
            planning_date="2026-04-05",
            timezone="Europe/Moscow",
        )
    assert "patches" in result.output
    assert len(result.output["patches"]) == 4
    assert result.output["summary"] == "Added times and travel task"


def test_build_returns_empty_patches_on_bad_json():
    with patch("src.workflows.planning._run_agent_text", return_value="not json"):
        result = _run_build_stage(
            tasks=EXTRACTED_FOR_CLUSTER,
            clusters=CLUSTERS,
            travel_blocks=[],
            locations=LOCATIONS,
            planning_date="2026-04-05",
            timezone="UTC",
        )
    assert result.output.get("patches") == []


# ── RECON with user_location ──────────────────────────────────────────────────

def test_recon_geocodes_user_location_as_origin():
    with patch("src.workflows.planning.ors_client.geocode", return_value=(37.6, 55.7)) as mock_geo, \
         patch("src.workflows.planning.search_place_hours", return_value=""), \
         patch("src.workflows.planning.search_transport_news", return_value=""), \
         patch("src.workflows.planning.search_city_events", return_value=""):
        result = _run_recon_stage(EXTRACTED_TASKS, "2026-04-05", "walking", user_location="Москва")
    locations = result.output["locations"]
    assert "__origin__" in locations
    assert locations["__origin__"]["coords"] == (37.6, 55.7)


def test_recon_skips_origin_when_user_location_is_none():
    with patch("src.workflows.planning.ors_client.geocode", return_value=(37.6, 55.7)), \
         patch("src.workflows.planning.search_place_hours", return_value=""), \
         patch("src.workflows.planning.search_transport_news", return_value=""), \
         patch("src.workflows.planning.search_city_events", return_value=""):
        result = _run_recon_stage(EXTRACTED_TASKS, "2026-04-05", "walking", user_location=None)
    assert "__origin__" not in result.output["locations"]


def test_recon_continues_without_origin_when_geocode_fails():
    def geocode_side_effect(loc):
        if loc == "Москва":
            raise RuntimeError("ORS down")
        return (37.6, 55.7)

    with patch("src.workflows.planning.ors_client.geocode", side_effect=geocode_side_effect), \
         patch("src.workflows.planning.search_place_hours", return_value=""), \
         patch("src.workflows.planning.search_transport_news", return_value=""), \
         patch("src.workflows.planning.search_city_events", return_value=""):
        result = _run_recon_stage(EXTRACTED_TASKS, "2026-04-05", "walking", user_location="Москва")
    assert "__origin__" not in result.output["locations"]
    assert "office" in result.output["locations"]


# ── ROUTE with __origin__ ─────────────────────────────────────────────────────

LOCATIONS_WITH_ORIGIN = {
    "__origin__": {"coords": (37.60, 55.70), "hours": ""},
    "gym": {"coords": (37.65, 55.75), "hours": "7am-10pm"},
    "office": {"coords": (37.66, 55.76), "hours": "9am-6pm"},
    "home": {"coords": (37.61, 55.74), "hours": ""},
}


def test_route_prepends_origin_to_first_cluster_when_origin_present():
    with patch("src.workflows.planning.ors_client.get_travel_time", return_value=15):
        result = _run_route_stage(CLUSTERS[:2], LOCATIONS_WITH_ORIGIN, "walking")
    blocks = result.output["travel_blocks"]
    first = blocks[0]
    assert first["from_location"] == "__origin__"
    assert first["to_location"] == CLUSTERS[0]["location"]


def test_route_no_origin_leg_when_origin_absent():
    with patch("src.workflows.planning.ors_client.get_travel_time", return_value=15):
        result = _run_route_stage(CLUSTERS[:2], LOCATIONS, "walking")
    blocks = result.output["travel_blocks"]
    assert all(b["from_location"] != "__origin__" for b in blocks)


def test_route_origin_leg_skipped_when_first_cluster_same_as_origin():
    clusters_from_origin = [
        {"location": "__origin__", "context_type": "home", "task_ids": ["t0"]},
        {"location": "gym", "context_type": "place", "task_ids": ["t1"]},
    ]
    with patch("src.workflows.planning.ors_client.get_travel_time", return_value=20):
        result = _run_route_stage(clusters_from_origin, LOCATIONS_WITH_ORIGIN, "walking")
    blocks = result.output["travel_blocks"]
    assert not any(b["from_location"] == "__origin__" and b["to_location"] == "__origin__" for b in blocks)
