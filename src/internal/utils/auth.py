from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

def load_creds(profile_id: str) -> Credentials:
    # достаём из твоего хранилища: access, refresh, scopes, token_uri, client_id, client_secret
    data = token_store.get(profile_id)
    creds = Credentials(**data)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        token_store.update(profile_id, creds)  # сохранить новый access_token/expiry
    return creds