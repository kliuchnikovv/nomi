# from google.genai.live import AsyncSession
# from google.oauth2.credentials import Credentials
# from google.auth.transport.requests import Request
# import time

# async def build_google_creds(store, session: AsyncSession, profile_id: str, account_email: str):
#     # Expect the store to return a dict with token data. Remote store ignores account_email.
#     data = await store.get_payload(session, "google", profile_id)
#     creds = Credentials(
#         token=data["access_token"],
#         refresh_token=data["refresh_token"],
#         token_uri=data["token_uri"],
#         client_id=data["client_id"],
#         client_secret=data["client_secret"],
#         scopes=data["scopes"] or ["https://www.googleapis.com/auth/gmail.readonly"]
#     )
#     if (data["expiry_epoch"] - int(time.time())) < 60 and data.get("refresh_token"):
#         # локальный refresh без гонок желательно оборачивать в лок
#         creds.refresh(Request())
#         # If rotate_access is available on the store, persist the new access token
#         rotate = getattr(store, "rotate_access", None)
#         if callable(rotate):
#             await rotate(session, "google", profile_id, account_email, creds.token, int(creds.expiry.timestamp()))
#     return creds
