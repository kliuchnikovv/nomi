#!/usr/bin/env python3
"""
Test script to demonstrate RAG logging functionality.
This script shows how the logging works when:
1. Creating UserScopedKnowledge
2. Storing documents (automatic fact storage)
3. Searching knowledge (automatic search)
"""
import logging
import os
import sys

# Add src to path BEFORE other imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

# Now import from src (after sys.path is modified)
from src.knowledge.factory import build_vector_db  # noqa: E402
from src.knowledge.user_knowledge import UserScopedKnowledge  # noqa: E402
from agno.knowledge.document import Document  # noqa: E402

# Setup logging to see our new log messages
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)


def main():
    print("=" * 80)
    print("RAG Logging Demo")
    print("=" * 80)
    print()
    
    # Step 1: Create vector DB
    print("Step 1: Creating Vector DB...")
    try:
        vector_db = build_vector_db()
        print("✓ Vector DB created successfully\n")
    except Exception as e:
        print(f"✗ Failed to create Vector DB: {e}")
        print("Make sure DB_DSN and GOOGLE_API_KEY environment variables are set")
        return
    
    # Step 2: Create UserScopedKnowledge
    print("Step 2: Creating UserScopedKnowledge...")
    user_id = "test-user-123"
    knowledge = UserScopedKnowledge(
        user_id=user_id,
        vector_db=vector_db,
        min_similarity_threshold=0.6
    )
    print(f"✓ UserScopedKnowledge created for user_id={user_id}\n")
    
    # Step 3: Store some documents (simulating automatic fact storage)
    print("Step 3: Storing documents (simulating automatic fact storage)...")
    documents = [
        Document(
            content="User prefers meetings after 11 AM",
            meta_data={"category": "preferences", "source": "conversation"}
        ),
        Document(
            content="User is working on Genie project with Python and Go",
            meta_data={"category": "projects", "source": "conversation"}
        ),
        Document(
            content="User loves coffee and drinks it every morning",
            meta_data={"category": "habits", "source": "conversation"}
        ),
    ]
    
    try:
        knowledge.load_documents(documents)
        print("✓ Documents stored successfully\n")
    except Exception as e:
        print(f"✗ Failed to store documents: {e}\n")
    
    # Step 4: Search knowledge (simulating automatic search)
    print("Step 4: Searching knowledge (simulating automatic search)...")
    queries = [
        "What are user's meeting preferences?",
        "What projects is the user working on?",
        "Tell me about chebureki",  # Should find nothing relevant
    ]
    
    for query in queries:
        print(f"\nQuery: '{query}'")
        try:
            results = knowledge.search(query, max_results=3)
            print(f"Found {len(results)} relevant results")
            for idx, doc in enumerate(results, 1):
                content = getattr(doc, "content", "")
                preview = content[:80] if content else "(empty)"
                print(f"  {idx}. {preview}")
        except Exception as e:
            print(f"✗ Search failed: {e}")
    
    print("\n" + "=" * 80)
    print("Demo complete! Check the logs above to see the detailed RAG logging.")
    print("=" * 80)


if __name__ == "__main__":
    main()
