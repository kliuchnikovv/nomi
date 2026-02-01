import unittest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

# Mock settings before importing app
with patch.dict(
    "os.environ",
    {
        "DB_DSN": "postgresql://user:pass@localhost:5432/db",
        "INTERNAL_API_KEY": "test-secret",
        "GO_API_URL": "http://localhost:8080",
    },
):
    from src.server.webhooks import router

from fastapi import FastAPI

app = FastAPI()
app.include_router(router)

client = TestClient(app)


class TestJulesWebhook(unittest.TestCase):
    @patch("src.server.webhooks.engine")
    @patch("requests.patch")
    def test_handle_jules_webhook_success(self, mock_patch, mock_engine):
        # Mock DB connection
        mock_conn = MagicMock()
        mock_engine.connect.return_value.__enter__.return_value = mock_conn

        # Mock API Response
        mock_patch.return_value.status_code = 200

        payload = {
            "event": "SESSION_COMPLETED",
            "sessionId": "sessions/123",
            "labels": {"task_id": "test-uuid-123"},
            "artifacts": [
                {"type": "pull_request", "url": "https://github.com/owner/repo/pull/1"}
            ],
        }

        with patch.dict(
            "os.environ",
            {"INTERNAL_API_KEY": "test-secret", "GO_API_URL": "http://localhost:8080"},
        ):
            response = client.post("/webhooks/jules", json=payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": "processed",
                "task_id": "test-uuid-123",
                "pr_url": "https://github.com/owner/repo/pull/1",
            },
        )

    @patch("src.server.webhooks.engine")
    def test_handle_jules_webhook_ignored(self, mock_engine):
        payload = {
            "event": "SESSION_FAILED",
            "sessionId": "sessions/123",
            "labels": {"task_id": "test-uuid-123"},
        }

        response = client.post("/webhooks/jules", json=payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(), {"status": "ignored", "event": "SESSION_FAILED"}
        )
        mock_engine.connect.assert_not_called()

    def test_handle_jules_webhook_missing_task_id(self):
        payload = {
            "event": "SESSION_COMPLETED",
            "sessionId": "sessions/123",
            "labels": {},  # Missing task_id
        }

        response = client.post("/webhooks/jules", json=payload)

        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
