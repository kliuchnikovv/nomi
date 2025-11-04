from __future__ import annotations

import uuid
import os, json, time, secrets

from dataclasses import dataclass
from typing import Optional, Sequence
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine, AsyncSession
from sqlalchemy.orm import registry
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from sqlalchemy import (
    text, Column, Table, String, ARRAY,
    TIMESTAMP, Integer, LargeBinary
)

mapper_registry = registry()
metadata = mapper_registry.metadata

oauth_tokens = Table(
    "oauth_tokens", metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("profile_id", String, nullable=False),
    Column("provider", String, nullable=False),
    Column("account_email", String, nullable=False),
    Column("external_user_id", String, nullable=False),
    Column("scopes", ARRAY(String), nullable=False),
    Column("token_encrypted", LargeBinary, nullable=False),
    Column("created_at", TIMESTAMP(timezone=True), nullable=False),
    Column("updated_at", TIMESTAMP(timezone=True), nullable=False),
    Column("version", Integer, nullable=False),
    Column("deleted_at", TIMESTAMP(timezone=True)),
)

audit_security = Table(
    "audit_security", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("profile_id", String),
    Column("provider", String),
    Column("action", String, nullable=False),
    Column("token_id", UUID(as_uuid=True)),
    Column("at", TIMESTAMP(timezone=True), nullable=False),
    Column("meta", String),  # jsonb, но для простоты вставляем через ::jsonb
)

integration_logs = Table(
    "integration_logs", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("profile_id", String, nullable=False),
    Column("provider", String, nullable=False),
    Column("agent_id", String, nullable=False),
    Column("action", String, nullable=False),
    Column("timestamp", TIMESTAMP(timezone=True), nullable=False),
    Column("details", String), # JSONB
)

# Processed Kafka messages for effectively-once semantics
from sqlalchemy import UniqueConstraint
kafka_processed_messages = Table(
    "kafka_processed_messages", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("topic", String, nullable=False),
    Column("partition", Integer, nullable=False),
    Column("offset", Integer, nullable=False),
    Column("message_key", String),
    Column("message_id", String),
    Column("processed_at", TIMESTAMP(timezone=True), nullable=False, server_default=text("now()")),
    UniqueConstraint("topic", "partition", "offset", name="uq_kafka_position"),
    UniqueConstraint("message_id", name="uq_kafka_message_id"),
)


# ---------- Crypto (envelope AES-GCM) ----------

class EnvelopeCrypto:
    """
    KEK (ключ-обёртка) берём из ENV: AGNO_TOKEN_KEK (base64/hex не нужен; требуем 32 сырых байта в env через os.urandom().hex()).
    Формат blob: [2 bytes len(wdek) | wrapped_dek | 12b nonce | ciphertext]
    """
    def __init__(self, kek: bytes):
        if len(kek) not in (16, 24, 32):
            raise ValueError("KEK must be 16/24/32 bytes")
        self.kek = kek

    def _wrap_dek(self, dek: bytes) -> bytes:
        aead = AESGCM(self.kek)
        nonce = secrets.token_bytes(12)
        return nonce + aead.encrypt(nonce, dek, b"wrap1")

    def _unwrap_dek(self, wrapped: bytes) -> bytes:
        aead = AESGCM(self.kek)
        nonce, ct = wrapped[:12], wrapped[12:]
        return aead.decrypt(nonce, ct, b"wrap1")

    def encrypt_blob(self, payload: dict) -> bytes:
        dek = AESGCM.generate_key(bit_length=256)
        aead = AESGCM(dek)
        nonce = secrets.token_bytes(12)
        pt = json.dumps(payload, separators=(",", ":")).encode()
        ct = aead.encrypt(nonce, pt, b"v1")
        wdek = self._wrap_dek(dek)
        return len(wdek).to_bytes(2, "big") + wdek + nonce + ct

    def decrypt_blob(self, blob: bytes) -> dict:
        L = int.from_bytes(blob[:2], "big")
        wdek = blob[2:2+L]
        nonce = blob[2+L:2+L+12]
        ct = blob[2+L+12:]
        dek = self._unwrap_dek(wdek)
        aead = AESGCM(dek)
        pt = aead.decrypt(nonce, ct, b"v1")
        return json.loads(pt)

# ---------- API ----------

@dataclass
class TokenRecord:
    profile_id: str
    provider: str            # "google"
    account_email: str
    external_user_id: str
    scopes: Sequence[str]
    access_token: str
    refresh_token: Optional[str]
    expiry_epoch: int
    token_uri: str
    client_id: str
    client_secret: str

class TokenStorePG:
    def __init__(self, engine: AsyncEngine, kek_env: str = "AGNO_TOKEN_KEK"):
        self.engine = engine
        raw = os.environ.get(kek_env)
        if not raw:
            raise RuntimeError(f"{kek_env} is not set")
        # ожидаем hex-строку (удобно хранить)
        kek = bytes.fromhex(raw.strip())
        self.crypto = EnvelopeCrypto(kek)

    # ---------- helpers ----------
    def _pack(self, rec: TokenRecord) -> bytes:
        return self.crypto.encrypt_blob({
            "access_token": rec.access_token,
            "refresh_token": rec.refresh_token,
            "expiry_epoch": rec.expiry_epoch,
            "token_uri": rec.token_uri,
            "client_id": rec.client_id,
            "client_secret": rec.client_secret,
            "scopes": list(rec.scopes),
        })

    # ---------- CRUD ----------
    async def upsert(self, session: AsyncSession, rec: TokenRecord) -> str:
        blob = self._pack(rec)
        scopes = list(dict.fromkeys(rec.scopes))  # уникализируем, сохраним порядок
        q = text("""
        INSERT INTO oauth_tokens
          (id, profile_id, provider, account_email, external_user_id, scopes, token_encrypted,
           created_at, updated_at, version)
        VALUES (:id, :profile_id, :provider, :account_email, :external_user_id, :scopes, :blob, now(), now(), 0)
        ON CONFLICT (provider, profile_id, account_email)
          WHERE deleted_at IS NULL
        DO UPDATE SET
          token_encrypted = EXCLUDED.token_encrypted,
          scopes          = EXCLUDED.scopes,
          updated_at      = now(),
          version         = oauth_tokens.version + 1
        RETURNING id::text
        """
        )
        row = await session.execute(q, {
            "id": uuid.uuid4(),
            "profile_id": rec.profile_id,
            "provider": rec.provider,
            "account_email": rec.account_email,
            "external_user_id": rec.external_user_id,
            "scopes": scopes,
            "blob": blob,
        })
        token_id = row.scalar_one()
        await session.execute(
            text("""INSERT INTO audit_security (profile_id, provider, action, token_id, meta)
                    VALUES (:p, :r, 'UPSERT', :tid, CAST(:m AS JSONB))"""),
            {"p": rec.profile_id, "r": rec.provider, "tid": token_id,
             "m": json.dumps({"account_email": rec.account_email})}
        )
        return token_id

    async def get_payload(self, session: AsyncSession, provider: str, profile_id: str) -> dict:
        row = await session.execute(
            text("""SELECT id::text, token_encrypted FROM oauth_tokens
                    WHERE provider=:pr AND profile_id=:pf AND deleted_at IS NULL"""),
            {"pr": provider, "pf": profile_id}
        )
        r = row.first()
        if not r:
            raise KeyError("Token not found")
        token_id, blob = r
        payload = self.crypto.decrypt_blob(blob)
        await session.execute(
            text("""INSERT INTO audit_security (profile_id, provider, action, token_id, meta)
                    VALUES (:p,:r,'READ',:tid, '{}'::jsonb)"""),
            {"p": profile_id, "r": provider, "tid": token_id}
        )
        return payload

    async def rotate_access(self, session: AsyncSession, provider: str, profile_id: str, account_email: str,
                            new_access: str, new_expiry_epoch: int):
        # читаем -> изменяем -> пишем
        row = await session.execute(
            text("""SELECT id::text, token_encrypted, version FROM oauth_tokens
                    WHERE provider=:pr AND profile_id=:pf AND account_email=:em AND deleted_at IS NULL
                    FOR UPDATE"""),  # реентерабельный лок под транзакцией
            {"pr": provider, "pf": profile_id, "em": account_email}
        )
        r = row.first()
        if not r: raise KeyError("Token not found")
        token_id, blob, ver = r
        data = self.crypto.decrypt_blob(blob)
        data["access_token"] = new_access
        data["expiry_epoch"] = new_expiry_epoch
        new_blob = self.crypto.encrypt_blob(data)

        await session.execute(
            text("""UPDATE oauth_tokens
                    SET token_encrypted=:b, updated_at=now(), version=version+1
                    WHERE id=:id AND version=:ver"""),
            {"b": new_blob, "id": token_id, "ver": ver}
        )
        await session.execute(
            text("""INSERT INTO audit_security (profile_id, provider, action, token_id, meta)
                    VALUES (:p, :r, 'ROTATE', :tid, CAST(:m AS JSONB))"""),
            {"p": profile_id, "r": provider, "tid": token_id,
             "m": json.dumps({"what": "access"})}
        )

    async def revoke(self, session: AsyncSession, provider: str, profile_id: str):
        await session.execute(
            text("""UPDATE oauth_tokens
                    SET deleted_at = now(), version = version+1
                    WHERE provider=:pr AND profile_id=:pf AND deleted_at IS NULL"""),
            {"pr": provider, "pf": profile_id}
        )
        await session.execute(
            text("""INSERT INTO audit_security (profile_id, provider, action)
                    VALUES (:p, :r, 'REVOKE')"""),
            {"p": profile_id, "r": provider}
        )
        await session.commit()

    # ---------- «рефреш-лок» для гонок ----------
    async def lock_for_refresh(self, session: AsyncSession, provider: str, profile_id: str, account_email: str) -> tuple[str, dict]:
        """
        Захватывает строку на refresh (SELECT ... FOR UPDATE SKIP LOCKED) и возвращает (token_id, payload).
        Если кто-то уже обновляет — вернётся пусто (None, None).
        """
        row = await session.execute(
            text("""SELECT id::text, token_encrypted FROM oauth_tokens
                    WHERE provider=:pr AND profile_id=:pf AND account_email=:em AND deleted_at IS NULL
                    FOR UPDATE SKIP LOCKED"""),
            {"pr": provider, "pf": profile_id, "em": account_email}
        )
        r = row.first()
        if not r:
            return None, None
        token_id, blob = r
        payload = self.crypto.decrypt_blob(blob)
        return token_id, payload

    async def write_after_refresh(self, session: AsyncSession, token_id: str, payload: dict):
        new_blob = self.crypto.encrypt_blob(payload)
        await session.execute(
            text("""UPDATE oauth_tokens SET token_encrypted=:b, updated_at=now(), version=version+1 WHERE id=:id"""),
            {"b": new_blob, "id": token_id}
        )
        await session.execute(
            text("""INSERT INTO audit_security (action, token_id, meta)
                    VALUES ('REFRESH', :tid, CAST(:m AS JSONB))"""),
            {"tid": token_id, "m": json.dumps({"ok": True})}
        )
    
    async def log_action(self, session: AsyncSession, profile_id: str, provider: str, agent_id: str, action: str, details: dict):
        await session.execute(
            text("""INSERT INTO integration_logs (profile_id, provider, agent_id, action, timestamp, details)
                    VALUES (:profile_id, :provider, :agent_id, :action, now(), CAST(:details AS JSONB))"""),
            {
                "profile_id": profile_id,
                "provider": provider,
                "agent_id": agent_id,
                "action": action,
                "details": json.dumps(details)
            }
        )

    async def get_logs(self, session: AsyncSession, profile_id: str, provider: str, limit: int = 50) -> list:
        q = await session.execute(
            text("""SELECT agent_id, action, timestamp, details FROM integration_logs
                    WHERE profile_id = :profile_id AND provider = :provider
                    ORDER BY timestamp DESC
                    LIMIT :limit"""),
            {"profile_id": profile_id, "provider": provider, "limit": limit}
        )
        return q.fetchall()


# ---------- Google Credentials helper ----------

async def build_google_creds(
    store: TokenStorePG,
    session: AsyncSession,
    profile_id: str,
    account_email: str,
    default_scopes: Optional[Sequence[str]] = None
) -> Credentials:
    data = await store.get_payload(session, "google", profile_id, account_email)
    scopes = data.get("scopes") or list(default_scopes or [])
    creds = Credentials(
        token=data["access_token"],
        refresh_token=data.get("refresh_token"),
        token_uri=data["token_uri"],
        client_id=data["client_id"],
        client_secret=data["client_secret"],
        scopes=scopes,
    )
    # Если скоро протухнет — попробуем рефреш в одиночку
    if data.get("refresh_token") and (data["expiry_epoch"] - int(time.time())) < 60:
        # Берём строгий лок, чтобы избежать гонок
        tid, locked_payload = await store.lock_for_refresh(session, "google", profile_id, account_email)
        if tid:
            try:
                creds.refresh(Request())
                locked_payload["access_token"] = creds.token
                locked_payload["expiry_epoch"] = int(creds.expiry.timestamp())
                await store.write_after_refresh(session, tid, locked_payload)
            except Exception:
                # не удалось — пусть вызывающая сторона решит, переавторизовывать ли
                pass
    return creds

# ---------- Engine factory ----------

def make_engine(dsn: str) -> AsyncEngine:
    # пример dsn: "postgresql+asyncpg://user:pass@host:5432/db"
    return create_async_engine(dsn, pool_size=5, max_overflow=5, pool_pre_ping=True)
