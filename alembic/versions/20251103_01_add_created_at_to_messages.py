"""add created_at to messages if missing

Revision ID: add_created_at_to_messages
Revises: 
Create Date: 2025-11-03
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_created_at_to_messages'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use IF NOT EXISTS to be safe on existing installations
    op.execute(
        sa.text("ALTER TABLE IF EXISTS messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()")
    )
    # Optional: index for ordering/filtering by chat
    op.execute(
        sa.text("CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages (chat_id, created_at)")
    )


def downgrade() -> None:
    # Non-destructive downgrade (keep column)
    pass

