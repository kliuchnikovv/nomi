import time
from unittest.mock import MagicMock, patch

import pytest
from httpx import Response

from back.src.rag_service import (
    RAGCallResult,
    RemoteLightRAG,
    index_document,
    query_rag,
)


@pytest.fixture
def rag_service():
    """Fixture to create an instance of RemoteLightRAG for testing."""
    return RemoteLightRAG(base_url="http://fake-rag-api:9621")


# region RemoteLightRAG Class Tests


def test_remote_light_rag_post(rag_service):
    """Test the internal _post method to ensure it calls httpx.post correctly."""
    with patch("httpx.post") as mock_post:
        mock_response = MagicMock(spec=Response)
        mock_response.raise_for_status.return_value = None
        mock_post.return_value = mock_response

        payload = {"key": "value"}
        rag_service._post("/test-path", json=payload)

        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        assert args[0] == "http://fake-rag-api:9621/test-path"
        assert kwargs["json"] == payload
        assert "Content-Type" in kwargs["headers"]


def test_remote_light_rag_get(rag_service):
    """Test the internal _get method to ensure it calls httpx.get correctly."""
    with patch("httpx.get") as mock_get:
        mock_response = MagicMock(spec=Response)
        mock_response.raise_for_status.return_value = None
        mock_get.return_value = mock_response

        rag_service._get("/test-path")

        mock_get.assert_called_once()
        args, kwargs = mock_get.call_args
        assert args[0] == "http://fake-rag-api:9621/test-path"
        assert kwargs["headers"] is not None


@patch("time.sleep", return_value=None)
def test_wait_for_track_success(mock_sleep, rag_service):
    """Test _wait_for_track successfully retrieves a document ID."""
    mock_get = MagicMock()
    # Simulate polling: first response is pending, second is complete
    mock_get.side_effect = [
        MagicMock(
            spec=Response, json=lambda: {"status": "processing", "documents": []}
        ),
        MagicMock(
            spec=Response,
            json=lambda: {
                "status": "completed",
                "documents": [{"id": "doc123"}],
            },
        ),
    ]
    rag_service._get = mock_get

    result = rag_service._wait_for_track("track123")

    assert result == "doc123"
    assert mock_get.call_count == 2
    mock_sleep.assert_called_once()


@patch("time.monotonic")
@patch("time.sleep", return_value=None)
def test_wait_for_track_timeout(mock_sleep, mock_monotonic, rag_service):
    """Test _wait_for_track returns None after a timeout."""
    # Simulate time passing to trigger the timeout
    mock_monotonic.side_effect = [
        time.monotonic(),
        time.monotonic() + 31,
    ]  # TRACK_TIMEOUT is 30
    mock_get = MagicMock(
        return_value=MagicMock(
            spec=Response, json=lambda: {"status": "processing", "documents": []}
        )
    )
    rag_service._get = mock_get

    result = rag_service._wait_for_track("track123")

    assert result is None
    mock_get.assert_called_once()  # Called once before timeout


def test_wait_for_track_no_id(rag_service):
    """Test _wait_for_track returns None immediately if no track_id is provided."""
    result = rag_service._wait_for_track("")
    assert result is None


def test_index_documents(rag_service):
    """Test the index method to ensure it processes documents and tracks them."""
    with patch.object(rag_service, "_post") as mock_post, patch.object(
        rag_service, "_wait_for_track"
    ) as mock_wait:
        # Mock the response from the initial POST to /documents/text
        mock_post.return_value.json.return_value = {"track_id": "trackxyz"}
        mock_wait.return_value = "doc-indexed-123"

        documents = [
            {"id": "doc1", "text": "This is a test document.", "metadata": {"project": "A"}},
            {"id": "doc2", "text": ""},  # This document should be skipped
            {"id": "doc3", "text": "Another test document."},
        ]

        rag_service.index(documents)

        assert mock_post.call_count == 2
        # Check first call
        args1, kwargs1 = mock_post.call_args_list[0]
        assert args1[0] == "/documents/text"
        assert kwargs1["json"]["text"] == "This is a test document."
        assert kwargs1["json"]["file_source"] == "doc1"
        assert kwargs1["json"]["metadata"] == {"project": "A"}

        # Check second call (doc2 is skipped)
        args2, kwargs2 = mock_post.call_args_list[1]
        assert args2[0] == "/documents/text"
        assert kwargs2["json"]["text"] == "Another test document."
        assert "metadata" not in kwargs2["json"] # No metadata for doc3

        assert mock_wait.call_count == 2
        mock_wait.assert_called_with("trackxyz")


def test_call_with_dict_response(rag_service):
    """Test the call method with a standard dictionary response."""
    with patch.object(rag_service, "_post") as mock_post:
        raw_response = {"response": "This is the answer.", "context": "some context"}
        mock_post.return_value.json.return_value = raw_response

        result = rag_service.call("What is the meaning of life?")

        assert isinstance(result, RAGCallResult)
        assert result.data == "This is the answer."
        assert result.raw == raw_response
        mock_post.assert_called_once_with(
            "/query", json={"query": "What is the meaning of life?", "mode": "hybrid"}
        )


def test_call_with_list_response(rag_service):
    """Test the call method with a list of objects response."""
    with patch.object(rag_service, "_post") as mock_post:
        raw_response = [
            {"content": "Part one of the answer."},
            {"response": "Part two of the answer."},
            "A simple string part.",
            {"other": "ignored"},
        ]
        mock_post.return_value.json.return_value = raw_response

        result = rag_service.call("Tell me a story.")

        expected_data = (
            "Part one of the answer.\\n\\nPart two of the answer.\\n\\nA simple string part."
        )
        assert result.data == expected_data
        assert result.raw == raw_response


def test_call_with_unstructured_response(rag_service):
    """Test the call method with an unexpected response format."""
    with patch.object(rag_service, "_post") as mock_post:
        raw_response = {"unexpected": "format"}
        mock_post.return_value.json.return_value = raw_response

        result = rag_service.call("Anything?")

        assert result.data == str(raw_response)
        assert result.raw == raw_response


# endregion

# region Module-Level Function Tests


@patch("back.src.rag_service.rag_pipeline")
def test_index_document_wrapper(mock_rag_pipeline):
    """Test the index_document function to ensure it calls the pipeline correctly."""
    doc_id = "doc-abc"
    text = "Some content here."
    metadata = {"source": "test"}

    index_document(doc_id, text, metadata)

    mock_rag_pipeline.index.assert_called_once_with(
        [{"id": doc_id, "text": text, "metadata": metadata}]
    )


@patch("back.src.rag_service.rag_pipeline")
def test_query_rag_wrapper(mock_rag_pipeline):
    """Test the query_rag function to ensure it calls the pipeline and returns data."""
    mock_rag_pipeline.call.return_value = RAGCallResult(
        data="The final answer.", raw={}
    )

    user_query = "What is the answer?"
    result = query_rag(user_query)

    assert result == "The final answer."
    mock_rag_pipeline.call.assert_called_once_with(user_query)


# endregion