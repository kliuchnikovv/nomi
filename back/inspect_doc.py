
import os
import sys

# Add current directory to path just in case
sys.path.append(os.getcwd())

try:
    from agno.knowledge import Knowledge
    from agno.utils.log import logger
    # Try different locations for Document
    try:
        from agno.document import Document
        print("Document found in agno.document")
    except ImportError:
        try:
            from agno.schema import Document
            print("Document found in agno.schema")
        except ImportError:
            print("Could not import Document directly")
            import agno
            print(f"Agno dir: {dir(agno)}")

    # If we found Document, print its help/dir
    if 'Document' in locals():
        print("\n--- Document Help ---")
        # print(help(Document)) # help() might be too long
        import inspect
        print(inspect.signature(Document))
        print(Document.__annotations__)
except ImportError as e:
    print(f"ImportError: {e}")
    # checking where agno might be
    import site
    print(f"Site packages: {site.getsitepackages()}")
