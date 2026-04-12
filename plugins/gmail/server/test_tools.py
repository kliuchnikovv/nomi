"""
Simple test script for GmailTools plugin.
Run from the repo root: python -m plugins.gmail.server.test_tools
"""

import sys
import os

# Ensure the repo root is on sys.path so package imports work
_repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from plugins.gmail.server.tools import GmailTools, build

def test_gmail_tools_basic():
    """Test basic GmailTools functionality without real credentials."""
    print("=" * 60)
    print("Testing GmailTools (without real credentials)")
    print("=" * 60)

    # Create instance with fake token (will fail on API calls, but structure is correct)
    tools = GmailTools(
        access_token="fake_test_token",
        refresh_token=None,
        client_id="test_client",
        client_secret="test_secret"
    )

    print(f"\n✓ GmailTools instance created successfully")
    print(f"  Name: {tools.name}")
    print(f"  Access token set: {bool(tools.access_token)}")

    # Check that all expected methods exist
    expected_methods = ['get_recent_emails', 'search_emails', 'get_email', 'send_email', 'reply_email', 'create_draft']
    for method in expected_methods:
        if hasattr(tools, method) and callable(getattr(tools, method)):
            print(f"  ✓ Method '{method}' exists and is callable")
        else:
            print(f"  ✗ Method '{method}' is missing or not callable")
            return False

    # Test that methods are synchronous (not async)
    import inspect
    for method in expected_methods:
        method_obj = getattr(tools, method)
        if inspect.iscoroutinefunction(method_obj):
            print(f"  ✗ Method '{method}' is async (should be sync)")
            return False
        else:
            print(f"  ✓ Method '{method}' is synchronous")

    return True


def test_build_function():
    """Test the build() function from the plugin."""
    print("\n" + "=" * 60)
    print("Testing build() function")
    print("=" * 60)

    # Test with various credential formats
    test_cases = [
        {
            "name": "Simple access token",
            "params": {"access_token": "test_token"}
        },
        {
            "name": "With refresh token",
            "params": {
                "access_token": "test_token",
                "refresh_token": "test_refresh",
                "client_id": "test_client",
                "client_secret": "test_secret"
            }
        },
        {
            "name": "Nested creds dict",
            "params": {
                "creds": {
                    "access_token": "test_token",
                    "refresh_token": "test_refresh"
                }
            }
        }
    ]

    for test_case in test_cases:
        try:
            tools = build(test_case["params"])
            print(f"\n✓ {test_case['name']}: build() succeeded")
            print(f"  Access token set: {bool(tools.access_token)}")
        except Exception as e:
            print(f"\n✗ {test_case['name']}: build() failed with {e}")
            return False

    # Test error handling
    try:
        build({})  # No access_token
        print("\n✗ build() should raise error without access_token")
        return False
    except ValueError as e:
        print(f"\n✓ build() correctly raises ValueError without access_token")

    return True


def test_sync_wrapper():
    """Test that the sync wrapper for async operations works."""
    print("\n" + "=" * 60)
    print("Testing sync wrapper for async operations")
    print("=" * 60)

    tools = GmailTools(
        access_token="fake_token",
        refresh_token=None,
        client_id=None,
        client_secret=None
    )

    # Test that _make_request method exists and is sync
    if hasattr(tools, '_make_request') and callable(tools._make_request):
        print("✓ _make_request() method exists and is callable")

        # Test that _async_make_request is also present
        if hasattr(tools, '_async_make_request') and callable(tools._async_make_request):
            print("✓ _async_make_request() method exists (internal async version)")
        else:
            print("✗ _async_make_request() method is missing")
            return False
    else:
        print("✗ _make_request() method is missing")
        return False

    return True


def main():
    """Run all tests."""
    print("\n🔧 GmailTools Plugin Test Suite\n")

    all_passed = True

    # Test 1: Basic instantiation
    if not test_gmail_tools_basic():
        all_passed = False

    # Test 2: Build function
    if not test_build_function():
        all_passed = False

    # Test 3: Sync wrapper
    if not test_sync_wrapper():
        all_passed = False

    # Summary
    print("\n" + "=" * 60)
    if all_passed:
        print("✅ All tests passed!")
        print("=" * 60)
        return 0
    else:
        print("❌ Some tests failed!")
        print("=" * 60)
        return 1


if __name__ == "__main__":
    sys.exit(main())
