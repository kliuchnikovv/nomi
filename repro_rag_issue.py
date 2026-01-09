
import os
import logging
import sys

# Add back/ to python path so we can import src
sys.path.append(os.path.join(os.getcwd(), 'back'))

from src.rag_service import ProjectKnowledgeManager

# Setup basic logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("repro_rag")

def run_repro():
    project_id = "repro-proj-001"
    
    # 1. Ingest as a "system" user (simulating the background worker)
    system_user_id = "system-worker"
    logger.info(f"--- Ingesting as {system_user_id} ---")
    
    try:
        sys_manager = ProjectKnowledgeManager(user_id=system_user_id)
        
        # Add a unique document
        doc_content = f"This is a critical architecture document for {project_id}. SecretCode: X99."
        sys_manager.add_document(content=doc_content, project_id=project_id, metadata={"type": "spec"})
        logger.info("Document added successfully.")
        
    except Exception as e:
        logger.error(f"Failed to ingest: {e}")
        return

    # 2. Search as a "real" user
    real_user_id = "real-user-123"
    logger.info(f"--- Searching as {real_user_id} ---")
    
    try:
        user_manager = ProjectKnowledgeManager(user_id=real_user_id)
        
        query = "SecretCode"
        results = user_manager.search(query=query, project_id=project_id)
        
        if results:
            logger.info(f"SUCCESS: Found {len(results)} documents.")
            for doc in results:
                print(f"Match: {doc.content}")
        else:
            logger.error("FAILURE: No documents found! (This confirms the bug if ingestion worked)")
            
    except Exception as e:
        logger.error(f"Search failed with error: {e}")

if __name__ == "__main__":
    # Check env vars
    db_dsn = os.getenv("DB_DSN")
    google_api_key = os.getenv("GOOGLE_API_KEY")
    
    if not db_dsn:
        print("DB_DSN not set.")
        db_dsn = input("Enter DB_DSN (e.g. postgresql://user:pass@host:5432/db): ").strip()
        os.environ["DB_DSN"] = db_dsn
        
    if not google_api_key:
        print("GOOGLE_API_KEY not set.")
        google_api_key = input("Enter GOOGLE_API_KEY: ").strip()
        os.environ["GOOGLE_API_KEY"] = google_api_key
        
    if not os.getenv("DB_DSN") or not os.getenv("GOOGLE_API_KEY"):
         print("Missing required environment variables. Exiting.")
         sys.exit(1)

    run_repro()
