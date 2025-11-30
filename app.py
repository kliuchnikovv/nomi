# AgnoProject/app.py

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from src.rag_service import index_document, query_rag # Импортируем наши функции
import os # Для доступа к переменным окружения, если нужно

app = FastAPI()

# Модели данных для API-запросов
class IndexRequest(BaseModel):
    document_id: str
    text: str
    metadata: dict = {}

class QueryRequest(BaseModel):
    query: str

@app.post("/index")
def handle_index(request: IndexRequest):
    """
    Эндпоинт для индексации документа.
    Принимает документ и добавляет его в векторную базу данных.
    """
    try:
        index_document(request.document_id, request.text, request.metadata)
        return {"status": "success", "document_id": request.document_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to index document: {e}")

@app.post("/query")
def handle_query(request: QueryRequest):
    """
    Эндпоинт для выполнения RAG-запроса.
    Принимает запрос пользователя и возвращает ответ LLM, обогащенный контекстом.
    """
    try:
        answer = query_rag(request.query)
        return {"answer": answer}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process query: {e}")

# Если в вашем app.py есть еще маршруты, они должны остаться здесь.
# Например:
# @app.get("/")
# def read_root():
#     return {"Hello": "World"}