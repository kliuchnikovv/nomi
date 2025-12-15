from agno.tools import Toolkit
from pydantic import BaseModel

class MemoryCard(BaseModel):
    fact: str
    importance: int  # 1-10 scale

class MemoryWriter(Toolkit):
    name = "memory_writer"
    description = "Writes memory cards to the database"

    async def run(self, cards: list[MemoryCard]):
        # Assuming the agent provides a DB connection via self.agent.db
        for card in cards:
            await self.agent.db.execute(
                "INSERT INTO memory (fact, importance) VALUES ($1, $2)",
                card.fact,
                card.importance,
            )
