# from agno.agent import Agent
# from agno.db import BaseDb
# from agno.models.base import Model
# from src.tools.google_maps import GoogleMapsTool

# name = "Google Maps Agent"
# description = "You are equipped with Google Maps tool to extract place ID"

# class GoogleMapsAgent(Agent):
#     def __init__(
#         self,
#         model: Model,
#         api_key: str,
#         db: BaseDb | None = None,
#         debug_mode: bool = False,
#     ):
#         super().__init__(
#             db=db,
#             name=name,
#             model=model,
#             description=description,
#             debug_mode=debug_mode,
#             tools=[
#                 GoogleMapsTool(api_key=api_key),
#             ],
#         )
