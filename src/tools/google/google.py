from agno.tools import Toolkit

from src.internal.store.token import TokenStorePG


class GoogleTools(Toolkit):
    def __init__(self,
        token_store: TokenStorePG,
    ):
        super().__init__()

