import logging
from agno.knowledge import Knowledge
import inspect

def check_signature():
    try:
        sig = inspect.signature(Knowledge.search)
        print(f"Knowledge.search signature: {sig}")
    except Exception as e:
        print(f"Error checking signature: {e}")

if __name__ == "__main__":
    check_signature()
