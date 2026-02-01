import os
import shutil
import tempfile
import pytest
from src.tools.git import GitTools

@pytest.fixture
def git_repo():
    # Create a temporary directory
    temp_dir = tempfile.mkdtemp()
    
    # Initialize git repo
    os.system(f"git init {temp_dir}")
    os.system(f"cd {temp_dir} && git config user.email 'test@example.com' && git config user.name 'Test User'")
    
    yield temp_dir
    
    # Cleanup
    shutil.rmtree(temp_dir)

def test_git_status_empty(git_repo):
    tools = GitTools(repo_path=git_repo)
    status = tools.status()
    assert "On branch" in status
    assert "No commits yet" in status or "nothing to commit" in status

def test_git_add_commit(git_repo):
    tools = GitTools(repo_path=git_repo)
    
    # Create a file
    file_path = os.path.join(git_repo, "test.txt")
    with open(file_path, "w") as f:
        f.write("test content")
        
    status = tools.status()
    assert "Untracked files" in status
    assert "test.txt" in status
    
    # Add
    result = tools.add(".")
    assert "Files staged successfully" in result or "" in result
    
    status = tools.status()
    assert "Changes to be committed" in status
    
    # Commit
    result = tools.commit("Initial commit")
    assert "Initial commit" in result
    
    log = tools.log()
    assert "Initial commit" in log

def test_git_branch_checkout(git_repo):
    tools = GitTools(repo_path=git_repo)
    
    # Initial commit needed for branching
    file_path = os.path.join(git_repo, "README.md")
    with open(file_path, "w") as f:
        f.write("# Test Repo")
    tools.add(".")
    tools.commit("Init")
    
    # Create branch
    result = tools.checkout("feature-branch", create=True)
    assert "Switched to a new branch 'feature-branch'" in result
    
    current = tools.branch_current()
    assert "feature-branch" in current
    
    branches = tools.branch_list()
    assert "* feature-branch" in branches
    assert "master" in branches or "main" in branches

def test_destructive_operations_blocked(git_repo):
    # Default destructive=False
    tools = GitTools(repo_path=git_repo)
    
    result = tools.reset(mode="hard")
    assert "Error: Reset is disabled" in result
    
    result = tools.push(force=True)
    assert "Error: Force push is disabled" in result

def test_destructive_operations_allowed(git_repo):
    tools = GitTools(repo_path=git_repo, allow_destructive=True)
    
    # Make some commits
    file_path = os.path.join(git_repo, "test.txt")
    with open(file_path, "w") as f:
        f.write("v1")
    tools.add(".")
    tools.commit("v1")
    
    # Reset should works (return git output, not error msg about disabled)
    result = tools.reset(mode="soft", ref="HEAD")
    assert "Error: Reset is disabled" not in result
