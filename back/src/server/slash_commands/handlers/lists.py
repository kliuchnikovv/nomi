"""/list — manage per-user named lists (groceries, todos…).

Subcommands (the list name is a single word, no spaces):

    /list                       show all lists
    /list <name>                show one list's items
    /list add <name> <item>     append an item (creates the list if needed)
    /list rm <name> <n|text>    remove an item by 1-based index or text match
    /list del <name>            delete a list entirely
    /list clear <name>          empty a list (keep it)

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
    "  /list add <name> <item>   add an item\n"
    "  /list rm <name> <n|text>  remove an item\n"
    "  /list del <name>          delete a list\n"
    "  /list clear <name>        empty a list"
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


async def handle(ctx: SlashCommandContext, args: str) -> None:
    if not ctx.user_id:
        await ctx.send_text("Lists need a signed-in user.")
        return

    user_id = ctx.user_id
    verb, rest = _split_first(args)
    verb_lower = verb.lower()

    # /list — show all lists
    if not verb:
        lists = await _lists.get_lists(user_id)
        if not lists:
            await ctx.send_text("No lists yet. Add one with: /list add <name> <item>")
            return
        lines = ["Your lists:"]
        for entry in lists:
            lines.append(f"  • {entry['name']} ({entry['count']})")
        await ctx.send_text("\n".join(lines))
        return

    # /list add <name> <item>
    if verb_lower == "add":
        name, item = _split_first(rest)
        if not name or not item:
            await ctx.send_text("Usage: /list add <name> <item>")
            return
        data = await _lists.add_item(user_id, name, item)
        await ctx.send_text(f"Added to '{name}': {item} (now {data['count']} items)")
        return

    # /list rm <name> <n|text>
    if verb_lower in _REMOVE_VERBS:
        name, ref = _split_first(rest)
        if not name or not ref:
            await ctx.send_text("Usage: /list rm <name> <number|text>")
            return
        removed, data = await _lists.remove_item(user_id, name, ref)
        if data is None:
            await ctx.send_text(f"No list named '{name}'.")
        elif removed is None:
            await ctx.send_text(f"Nothing matching '{ref}' in '{name}'.")
        else:
            await ctx.send_text(
                f"Removed from '{name}': {removed} (now {data['count']} items)"
            )
        return

    # /list del <name>
    if verb_lower in _DELETE_VERBS:
        name, _ = _split_first(rest)
        if not name:
            await ctx.send_text("Usage: /list del <name>")
            return
        deleted = await _lists.delete_list(user_id, name)
        if deleted:
            await ctx.send_text(f"Deleted list '{name}'.")
        else:
            await ctx.send_text(f"No list named '{name}'.")
        return

    # /list clear <name>
    if verb_lower == "clear":
        name, _ = _split_first(rest)
        if not name:
            await ctx.send_text("Usage: /list clear <name>")
            return
        cleared = await _lists.clear_list(user_id, name)
        if cleared:
            await ctx.send_text(f"Cleared '{name}'.")
        else:
            await ctx.send_text(f"No list named '{name}'.")
        return

    # Otherwise treat the whole args as a list name to show.
    data = await _lists.get_list(user_id, args.strip())
    if data is None:
        await ctx.send_text(f"No list named '{args.strip()}'.\n\n{_USAGE}")
        return
    await ctx.send_text(_format_list(data))


def register() -> None:
    _register(
        CommandSpec(
            name="list",
            summary="manage named lists",
            usage="[<name>|add <name> <item>|rm <name> <n>|del <name>|clear <name>]",
            handler=handle,
        )
    )
