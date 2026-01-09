
import sys
import os
sys.path.append(os.getcwd())

try:
    from agno.knowledge.document import Document
    print("Found Document in agno.knowledge.document")
    import inspect
    print("\n--- Document Signature ---")
    print(inspect.signature(Document))
    print("\n--- Document Annotations ---")
    print(Document.__annotations__)
    
    # Check if filters is a field
    doc = Document(content="test")
    print("\n--- Document Instance Fields ---")
    print(dir(doc))
    print(f"Has filters? {'filters' in dir(doc)}")
    print(f"Has name? {'name' in dir(doc)}")
except ImportError as e:
    print(f"ImportError: {e}")
except Exception as e:
    print(f"Error: {e}")
