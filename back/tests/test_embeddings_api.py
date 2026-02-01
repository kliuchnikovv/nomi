import unittest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient

# Mock os.environ to set INTERNAL_API_KEY
with patch.dict(
    "os.environ", {"INTERNAL_API_KEY": "test-secret", "GOOGLE_API_KEY": "fake-key"}
):
    from app import app, container

client = TestClient(app)


class TestEmbeddingsAPI(unittest.TestCase):
    def setUp(self):
        # Mock the embedder in the container
        self.mock_embedder = MagicMock()
        # We set the private _embedder attribute to bypass lazy loading or overwrite it
        container._embedder = self.mock_embedder

        # Patch os.environ for the duration of the test
        self.env_patcher = patch.dict("os.environ", {"INTERNAL_API_KEY": "test-secret"})
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()

    def test_embeddings_unauthorized(self):
        response = client.post("/api/embeddings", json={"text": "hello"})
        self.assertEqual(response.status_code, 403)

    def test_embeddings_authorized_wrong_key(self):
        response = client.post(
            "/api/embeddings",
            json={"text": "hello"},
            headers={"X-Internal-Secret": "wrong-secret"},
        )
        self.assertEqual(response.status_code, 403)

    def test_embeddings_single_text(self):
        self.mock_embedder.async_get_embedding = AsyncMock(return_value=[0.1, 0.2, 0.3])

        response = client.post(
            "/api/embeddings",
            json={"text": "hello"},
            headers={"X-Internal-Secret": "test-secret"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"embedding": [0.1, 0.2, 0.3]})
        self.mock_embedder.async_get_embedding.assert_called_with("hello")

    def test_embeddings_batch_texts(self):
        # Mock return value for batch: (embeddings, usage)
        self.mock_embedder.async_get_embeddings_batch_and_usage = AsyncMock(
            return_value=([[0.1], [0.2]], None)
        )

        response = client.post(
            "/api/embeddings",
            json={"texts": ["hello", "world"]},
            headers={"X-Internal-Secret": "test-secret"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"embeddings": [[0.1], [0.2]]})
        self.mock_embedder.async_get_embeddings_batch_and_usage.assert_called_with(
            ["hello", "world"]
        )

    def test_embeddings_empty_batch(self):
        response = client.post(
            "/api/embeddings",
            json={"texts": []},
            headers={"X-Internal-Secret": "test-secret"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"embeddings": []})


if __name__ == "__main__":
    unittest.main()
