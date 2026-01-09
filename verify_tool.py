
import sys
import os

# Add src to path
sys.path.append(os.path.abspath("back"))

from src.rag_service import KnowledgeSearchTool

def test_tool_registration():
    # Pass a dummy manager if possible, or expect manager initialization to fail
    tool = KnowledgeSearchTool(user_id="test-user", auth_token="test-token")
    
    # Check Agno Toolkit registered functions
    # Based on KnowledgeSearchTool.__init__, it calls self.register()
    functions = [f.name for f in tool.functions.values()]
    print(f"Registered functions: {functions}")
    
    if "list_projects" in functions:
        print("SUCCESS: list_projects tool is registered in self.functions.")
    else:
        print("FAILURE: list_projects tool is NOT registered in self.functions.")
        sys.exit(1)

    # Check the attribute exists
    if hasattr(tool, "list_projects"):
        print("SUCCESS: list_projects method exists on the tool instance.")
    else:
        print("FAILURE: list_projects method does NOT exist.")
        sys.exit(1)

if __name__ == "__main__":
    test_tool_registration()
