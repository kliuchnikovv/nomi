# AgnoProject/src/rag_service.py

import os
import google.generativeai as genai
from lightrag.core import RAG, Component
from lightrag.components.vector_store import ChromaDB

# --- Настройка Gemini ---
# Убедитесь, что переменная окружения GOOGLE_API_KEY установлена
# Например: export GOOGLE_API_KEY="YOUR_GOOGLE_API_KEY"
try:
    api_key = os.environ["GOOGLE_API_KEY"]
    genai.configure(api_key=api_key)
except KeyError:
    raise ValueError("GOOGLE_API_KEY environment variable not set.")


# --- Шаг 2.1: Создаем кастомный Embedder для Gemini ---
class GeminiEmbedder(Component):
    def __init__(self, model_name: str = "text-embedding-004"):
        super().__init__()
        self.model_name = model_name

    def call(self, input: str) -> list[float]:
        """Превращает текст в вектор, используя Gemini."""
        if not input:
            # Модель не может обработать пустую строку
            return []
        result = genai.embed_content(model=self.model_name, content=input)
        return result['embedding']


# --- Шаг 2.2: Создаем кастомный Generator для Gemini ---
class GeminiGenerator(Component):
    def __init__(self, model_name: str = "gemini-1.5-pro-latest"):
        super().__init__()
        self.model = genai.GenerativeModel(model_name)

    def call(self, input: str) -> str:
        """Генерирует текст на основе промпта, используя Gemini."""
        response = self.model.generate_content(input)
        return response.text


# --- Шаг 3: Собираем RAG-пайплайн с новыми компонентами Gemini ---

# 1. Инициализируем наши кастомные компоненты
embedder = GeminiEmbedder()
generator = GeminiGenerator()

# 2. Векторная база данных остается прежней
vector_store = ChromaDB(path="./chroma_db")

# 3. Собираем пайплайн LightRAG с компонентами Gemini
rag_pipeline = RAG(
    embedder=embedder,
    vector_store=vector_store,
    generator=generator
)


# --- Функции для API остаются без изменений ---
def index_document(document_id: str, text: str, metadata: dict):
    """Индексирует один документ в векторной базе данных."""
    doc = {"id": document_id, "text": text, "metadata": metadata}
    rag_pipeline.index(documents=[doc])
    print(f"Indexed document with Gemini: {document_id}")

def query_rag(user_query: str) -> str:
    """Выполняет RAG-запрос, используя Gemini."""
    result = rag_pipeline.call(query=user_query)
    return result.data