"""Fixtures for the end-to-end regression suite.

By default the suite brings the whole stack up via docker-compose with
``BRAIN_TEST_MODE=1`` (the stub-brain), runs against it, and tears it down. For
fast local iteration against an already-running stack, set:

    E2E_NO_COMPOSE=1            # skip compose bring-up/tear-down
    E2E_BASE_URL=http://...     # where the Go API lives (default :8080)

The stack MUST run with BRAIN_TEST_MODE=1 for these tests to pass — the magic
inputs (__e2e_echo__, __e2e_tool__, __e2e_error__, __e2e_task__) only produce
deterministic output in stub mode.
"""

import os
import subprocess
import time
import uuid
from pathlib import Path

import httpx
import pytest
import pytest_asyncio

REPO_ROOT = Path(__file__).resolve().parent.parent
COMPOSE_FILES = ["-f", "docker-compose.yml", "-f", "docker-compose.e2e.yml"]
HEALTH_TIMEOUT_S = 180
HEALTH_POLL_S = 2.0


def _base_url() -> str:
    return os.getenv("E2E_BASE_URL", "http://localhost:8080").rstrip("/")


def _compose(*args: str) -> None:
    subprocess.run(
        ["docker", "compose", *COMPOSE_FILES, *args],
        cwd=REPO_ROOT,
        check=True,
    )


def _wait_healthy(base_url: str) -> None:
    deadline = time.monotonic() + HEALTH_TIMEOUT_S
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            resp = httpx.get(f"{base_url}/health", timeout=5.0)
            if resp.status_code == 200:
                return
        except Exception as exc:  # noqa: BLE001 — keep polling until deadline
            last_err = exc
        time.sleep(HEALTH_POLL_S)
    raise RuntimeError(
        f"Go API at {base_url}/health never became healthy "
        f"within {HEALTH_TIMEOUT_S}s (last error: {last_err})"
    )


@pytest.fixture(scope="session")
def base_url() -> str:
    return _base_url()


@pytest.fixture(scope="session", autouse=True)
def stack(base_url: str):
    """Bring the full stack up (stub-brain mode) for the test session."""
    manage = os.getenv("E2E_NO_COMPOSE") != "1"
    if manage:
        _compose("up", "-d", "--build")
    try:
        _wait_healthy(base_url)
        yield
    finally:
        if manage:
            # Dump logs to stdout so CI artifacts capture failures, then tear down.
            subprocess.run(
                ["docker", "compose", *COMPOSE_FILES, "logs", "--no-color"],
                cwd=REPO_ROOT,
                check=False,
            )
            _compose("down", "-v")


@pytest_asyncio.fixture
async def auth(base_url: str):
    """Register a fresh user and return its token + id + auth headers."""
    email = f"e2e+{uuid.uuid4().hex}@example.com"
    async with httpx.AsyncClient(base_url=base_url, timeout=15.0) as client:
        resp = await client.post(
            "/api/auth/register",
            json={"email": email, "password": "Password123!", "name": "e2e"},
        )
        resp.raise_for_status()
        body = resp.json()
    token = body["token"]
    user_id = body["user"]["id"]
    return {
        "token": token,
        "user_id": user_id,
        "email": email,
        "headers": {"Authorization": f"Bearer {token}"},
    }


@pytest_asyncio.fixture
async def api(base_url: str, auth: dict):
    """Authenticated httpx client for REST calls."""
    async with httpx.AsyncClient(
        base_url=base_url, headers=auth["headers"], timeout=30.0
    ) as client:
        yield client
