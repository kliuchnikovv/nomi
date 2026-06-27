"""/list — manage per-user named lists (groceries, todos, movies…).

Two equivalent surfaces (the list name is a single word, no spaces):

    /list                       show all lists
    /list <name>                show one list's items
    /list.add <name> <item>     append an item (creates the list if needed)
    /list.rm  <name> <n|text>   remove an item by 1-based index or text match
    /list.del <name>            delete a list entirely
    /list.clear <name>          empty a list (keep it)

The dotted sub-commands each get their own autocomplete entry + usage hint on
the client. The bare ``/list`` also accepts the verbs inline (``/list add …``)
for convenience, so both styles work.

Data is stored per user (see src/storage/user_lists.py) so lists are shared
across all of the user's chats. The same store is exposed to the agent via
ListsTools, so the model can read/modify these lists from normal messages.
"""

from __future__ import annotations

from src.server.slash_commands.registry import (
    CommandSpec,
    SlashCommandContext,
    register as _register,
)
from src.storage import user_lists as _lists

_USAGE = (
    "Usage:\n"
    "  /list                     show all lists\n"
    "  /list <name>              show a list\n"
    "  /list.add <name> <item>   add an item\n"
    "  /list.rm <name> <n|text>  remove an item\n"
    "  /list.del <name>          delete a list\n"
    "  /list.clear <name>        empty a list"
)

_REMOVE_VERBS = {"rm", "remove"}
_DELETE_VERBS = {"del", "delete"}


def _split_first(text: str) -> tuple[str, str]:
    """Split ``text`` into (first_token, remainder)."""
    parts = text.strip().split(None, 1)
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1].strip()


def _format_list(data: dict) -> str:
    name = data["name"]
    items = data["items"]
    if not items:
        return f"'{name}' is empty."
    lines = [f"{name}:"]
    for i, item in enumerate(items, start=1):
        lines.append(f"  {i}. {item}")
    return "\n".join(lines)


# ── Operations (shared by the bare /list verbs and the dotted sub-commands) ──


async def _op_show_all(ctx: SlashCommandContext, user_id: str) -> None:
    lists = await _lists.get_lists(user_id)
    if not lists:
        await ctx.send_text("No lists yet. Add one with: /list.add <name> <item>")
        return
    lines = ["Your lists:"]
    for entry in lists:
        lines.append(f"  • {entry['name']} ({entry['count']})")
    await ctx.send_text("\n".join(lines))


async def _op_show_one(ctx: SlashCommandContext, user_id: str, name: str) -> None:
    data = await _lists.get_list(user_id, name)
    if data is None:
        await ctx.send_text(f"No list named '{name}'.\n\n{_USAGE}")
        return
    await ctx.send_text(_format_list(data))


async def _op_add(ctx: SlashCommandContext, user_id: str, rest: str) -> None:
    name, item = _split_first(rest)
    if not name or not item:
        await ctx.send_text("Usage: /list.add <name> <item>")
        return
    data = await _lists.add_item(user_id, name, item)
    await ctx.send_text(f"Added to '{name}': {item} (now {data['count']} items)")


async def _op_rm(ctx: SlashCommandContext, user_id: str, rest: str) -> None:
    name, ref = _split_first(rest)
    if not name or not ref:
        await ctx.send_text("Usage: /list.rm <name> <number|text>")
        return
    removed, data = await _lists.remove_item(user_id, name, ref)
    if data is None:
        await ctx.send_text(f"No list named '{name}'.")
    elif removed is None:
        await ctx.send_text(f"Nothing matching '{ref}' in '{name}'.")
    else:
        await ctx.send_text(f"Removed from '{name}': {removed} (now {data['count']} items)")


async def _op_del(ctx: SlashCommandContext, user_id: str, rest: str) -> None:
    name, _ = _split_first(rest)
    if not name:
        await ctx.send_text("Usage: /list.del <name>")
        return
    deleted = await _lists.delete_list(user_id, name)
    await ctx.send_text(
        f"Deleted list '{name}'." if deleted else f"No list named '{name}'."
    )


async def _op_clear(ctx: SlashCommandContext, user_id: str, rest: str) -> None:
    name, _ = _split_first(rest)
    if not name:
        await ctx.send_text("Usage: /list.clear <name>")
        return
    cleared = await _lists.clear_list(user_id, name)
    await ctx.send_text(
        f"Cleared '{name}'." if cleared else f"No list named '{name}'."
    )


# ── Command handlers ─────────────────────────────────────────────────────────


async def handle(ctx: SlashCommandContext, args: str) -> None:
    """``/list`` — show all, show one (``/list <name>``), or verbs inline."""
    if not ctx.user_id:
        await ctx.send_text("Lists need a signed-in user.")
        return
    user_id = ctx.user_id
    verb, rest = _split_first(args)
    verb_lower = verb.lower()

    if not verb:
        await _op_show_all(ctx, user_id)
    elif verb_lower == "add":
        await _op_add(ctx, user_id, rest)
    elif verb_lower in _REMOVE_VERBS:
        await _op_rm(ctx, user_id, rest)
    elif verb_lower in _DELETE_VERBS:
        await _op_del(ctx, user_id, rest)
    elif verb_lower == "clear":
        await _op_clear(ctx, user_id, rest)
    else:
        await _op_show_one(ctx, user_id, args.strip())


def _require_user(ctx: SlashCommandContext) -> str | None:
    if not ctx.user_id:
        return None
    return ctx.user_id


async def handle_add(ctx: SlashCommandContext, args: str) -> None:
    user_id = _require_user(ctx)
    if user_id is None:
        await ctx.send_text("Lists need a signed-in user.")
        return
    await _op_add(ctx, user_id, args)


async def handle_rm(ctx: SlashCommandContext, args: str) -> None:
    user_id = _require_user(ctx)
    if user_id is None:
        await ctx.send_text("Lists need a signed-in user.")
        return
    await _op_rm(ctx, user_id, args)


async def handle_del(ctx: SlashCommandContext, args: str) -> None:
    user_id = _require_user(ctx)
    if user_id is None:
        await ctx.send_text("Lists need a signed-in user.")
        return
    await _op_del(ctx, user_id, args)


async def handle_clear(ctx: SlashCommandContext, args: str) -> None:
    user_id = _require_user(ctx)
    if user_id is None:
        await ctx.send_text("Lists need a signed-in user.")
        return
    await _op_clear(ctx, user_id, args)


def register() -> None:
    _register(
        CommandSpec(
            name="list",
            summary="show your named lists",
            usage="[<name>]",
            handler=handle,
        )
    )
    _register(
        CommandSpec(
            name="list.add",
            summary="add an item to a list",
            usage="<name> <item>",
            handler=handle_add,
        )
    )
    _register(
        CommandSpec(
            name="list.rm",
            summary="remove an item from a list",
            usage="<name> <number|text>",
            handler=handle_rm,
        )
    )
    _register(
        CommandSpec(
            name="list.del",
            summary="delete a list",
            usage="<name>",
            handler=handle_del,
        )
    )
    _register(
        CommandSpec(
            name="list.clear",
            summary="empty a list",
            usage="<name>",
            handler=handle_clear,
        )
    )
