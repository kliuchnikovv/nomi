import unittest
from unittest.mock import MagicMock, patch, ANY
import json
import os
from fastapi.testclient import TestClient

# Mock settings before importing app
with patch.dict("os.environ", {
    "DB_DSN": "postgresql://user:pass@localhost:5432/db",
    "INTERNAL_API_KEY": "test-secret",
    "GO_API_URL": "http://localhost:8080"
}):
    from src.server.webhooks import router, JulesWebhookPayload

# Create a dummy app to mount the router
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
                {
                    "type": "pull_request",
                    "url": "https://github.com/owner/repo/pull/1"
                }
            ]
        }

        # Ensure environment variable is read correctly inside the function
        # because the module level default might have been captured differently
        with patch.dict("os.environ", {"INTERNAL_API_KEY": "test-secret", "GO_API_URL": "http://localhost:8080"}):
            response = client.post("/webhooks/jules", json=payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "processed", "task_id": "test-uuid-123"})

        # Verify DB Update (Artifacts)
        mock_conn.execute.assert_called_once()
        args, kwargs = mock_conn.execute.call_args
        if len(args) > 1:
            params = args[1]
        else:
            params = args[0]

        self.assertEqual(params['task_id'], "test-uuid-123")
        jules_data = json.loads(params['jules_data'])
        self.assertEqual(jules_data['pr_url'], "https://github.com/owner/repo/pull/1")

        # Verify API Call (Status)
        # Note: The code in webhooks.py uses os.getenv("INTERNAL_API_KEY", "jules-secret-key")
        # Since os.environ was patched at module level import, it should work.
        # But if the default value "jules-secret-key" was somehow used, let's debug.
        # The failure message says Actual used "jules-secret-key".
        # This implies os.getenv returned None or the default.
        # It seems the module import happened before the patch context in the test file?
        # No, the patch context wraps the import.
        # However, if webhooks.py calls os.getenv inside the function, it should see the current env.
        # If it defines a global or default arg, it might be stale.
        # Looking at webhooks.py:
        # internal_secret = os.getenv("INTERNAL_API_KEY", "jules-secret-key") inside handle_jules_webhook

        # Let's verify what the test is seeing.
        mock_patch.assert_called_once_with(
            "http://localhost:8080/api/project-tasks/test-uuid-123/status",
            json={"status": "REVIEW"},
            headers={"X-Internal-Secret": "test-secret"}
        )

    @patch("src.server.webhooks.engine")
    def test_handle_jules_webhook_ignored(self, mock_engine):
        payload = {
            "event": "SESSION_FAILED",
            "sessionId": "sessions/123",
            "labels": {"task_id": "test-uuid-123"}
        }

        response = client.post("/webhooks/jules", json=payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ignored", "reason": "not completed"})
        mock_engine.connect.assert_not_called()

    def test_handle_jules_webhook_missing_task_id(self):
        payload = {
            "event": "SESSION_COMPLETED",
            "sessionId": "sessions/123",
            "labels": {} # Missing task_id
        }

        response = client.post("/webhooks/jules", json=payload)

        self.assertEqual(response.status_code, 400)

if __name__ == "__main__":
    unittest.main()
