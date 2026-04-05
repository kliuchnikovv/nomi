from src.workflows.models import PlanStatus, StageResult, Cluster, TravelBlock


def test_plan_status_values():
    assert PlanStatus.EXTRACT == "extract"
    assert PlanStatus.RECON == "recon"
    assert PlanStatus.CLUSTER == "cluster"
    assert PlanStatus.ROUTE == "route"
    assert PlanStatus.BUILD == "build"
    assert PlanStatus.REVIEW == "review"
    assert PlanStatus.ITERATE == "iterate"
    assert PlanStatus.CLARIFYING == "_clarifying"


def test_stage_result_defaults():
    r = StageResult(output={"key": "val"})
    assert r.pending_questions == []
    assert r.is_complete is True


def test_travel_block():
    tb = TravelBlock(
        from_location="gym",
        to_location="office",
        duration_min=25,
        mode="driving-car",
        title="Выдвинуться в office",
        insert_before_cluster_index=1,
    )
    assert tb.duration_min == 25
