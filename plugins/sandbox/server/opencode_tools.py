"""
OpenCode tools for the server-side sandbox plugin.

Wraps the `opencode` CLI (https://opencode.ai) running headless inside the
per-user Railway sandbox. The user's own LLM key (BYOK) is provisioned into the
sandbox once (mirroring SandboxTools.ensure_git_auth) and opencode is driven via
`opencode run`. Exposed to the developer sub-agent as a single `run_opencode`
tool so the noisy CLI loop stays out of the lead agent's context.
"""

import hashlib
import json
import logging
import shlex
from typing import Any, Dict, Optional

from agno.tools import Toolkit

from plugins.sandbox.server.service import SandboxNotFoundError
from plugins.sandbox.server.tools import SandboxTools

logger = logging.getLogger(__name__)

# Provider → default opencode model id (provider/model). Used when the caller
# does not pass an explicit model. z.ai is wired as a custom provider (see below).
DEFAULT_MODELS = {
    "anthropic": "anthropic/claude-sonnet-4-20250514",
    "google": "google/gemini-2.5-pro",
    "openrouter": "openrouter/anthropic/claude-sonnet-4",
    "zai": "zai/glm-4.6",
}

# Order used to pick a default provider when the user did not mark one.
PROVIDER_PRIORITY = ["anthropic", "openrouter", "google", "zai"]

# z.ai GLM is OpenAI-compatible (same base_url the brain uses in agents/factory).
# Registered as a custom opencode provider since it is not in the default registry.
ZAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4"

# Providers opencode recognises out of the box — keyed straight into auth.json.
NATIVE_PROVIDERS = ("anthropic", "google", "openrouter")

# Install opencode to a known dir and ensure it is on PATH for `opencode run`.
_PATH_PREFIX = 'export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"'


class OpenCodeTools(Toolkit):
    """Drive the opencode CLI inside the sandbox using the user's BYOK key."""

    def __init__(
        self,
        sandbox_tools: SandboxTools,
        byok_keys: Optional[Dict[str, str]] = None,
        byok_default: str = "",
    ):
        super().__init__(name="opencode_tools")
        # Reuse the SAME SandboxTools instance (same per-user/project VM, cached
        # sandbox id, lifecycle/retry) the developer agent was built with.
        self._sb = sandbox_tools
        self._byok = {k: v for k, v in (byok_keys or {}).items() if v}
        self._default = byok_default if byok_default in self._byok else self._pick_default()
        # (sandbox_id, key fingerprint) last provisioned. None = not yet done; a
        # fresh VM (different id) or changed keys force re-provisioning.
        self._provisioned: Optional[tuple] = None
        self.register(self.run_opencode)

    def _pick_default(self) -> str:
        for p in PROVIDER_PRIORITY:
            if p in self._byok:
                return p
        return next(iter(self._byok), "")

    def _key_fingerprint(self) -> str:
        blob = json.dumps(self._byok, sort_keys=True).encode()
        return hashlib.sha256(blob).hexdigest()

    def _auth_json(self) -> Dict[str, Any]:
        """Build opencode's auth.json content from the configured BYOK keys."""
        auth: Dict[str, Any] = {}
        for prov in NATIVE_PROVIDERS:
            if self._byok.get(prov):
                auth[prov] = {"type": "api", "key": self._byok[prov]}
        if self._byok.get("zai"):
            auth["zai"] = {"type": "api", "key": self._byok["zai"]}
        return auth

    def _opencode_json(self) -> Optional[Dict[str, Any]]:
        """Custom-provider config (only z.ai needs one; it is not built in)."""
        if not self._byok.get("zai"):
            return None
        return {
            "$schema": "https://opencode.ai/config.json",
            "provider": {
                "zai": {
                    "npm": "@ai-sdk/openai-compatible",
                    "name": "Z.AI",
                    "options": {"baseURL": ZAI_BASE_URL},
                    "models": {"glm-4.6": {}, "glm-4.5": {}},
                }
            },
        }

    async def ensure_opencode(self) -> None:
        """Install opencode (once) and provision the BYOK auth config in the VM.

        Idempotent per (sandbox_id, key fingerprint): a fresh VM or changed keys
        re-provisions. Keys are written via the upload channel (HTTP body), never
        passed as command arguments, so they don't land in exec logs/argv.
        """
        if not self._byok:
            return
        sandbox_id = await self._sb._get_sandbox()
        fingerprint = (sandbox_id, self._key_fingerprint())
        if self._provisioned == fingerprint:
            return

        # Resolve $HOME so config lands in the right place regardless of the user.
        home_res = await self._sb._exec_with_retry(["sh", "-c", "echo $HOME"], timeout=15)
        home = (home_res.get("stdout") or "").strip() or "/root"

        # Install opencode if missing (persists on the VM, survives checkpoints).
        check = await self._sb._exec_with_retry(
            ["sh", "-c", "command -v opencode || true"], timeout=20
        )
        if not (check.get("stdout") or "").strip():
            logger.info("ensure_opencode: installing opencode CLI in sandbox")
            install = await self._sb._exec_with_retry(
                ["bash", "-c", "curl -fsSL https://opencode.ai/install | bash"],
                timeout=300,
            )
            if isinstance(install, dict) and install.get("exit_code") not in (0, None):
                # Fallback to npm if the install script failed.
                await self._sb._exec_with_retry(
                    ["bash", "-c", "npm install -g opencode-ai"], timeout=300
                )

        # Write auth config (no secrets in argv — content goes via upload_file).
        await self._sb._exec_with_retry(
            ["mkdir", "-p", f"{home}/.local/share/opencode", f"{home}/.config/opencode"],
            timeout=20,
        )
        await self._sb.upload_file(
            f"{home}/.local/share/opencode/auth.json",
            json.dumps(self._auth_json()),
        )
        opencode_json = self._opencode_json()
        if opencode_json is not None:
            await self._sb.upload_file(
                f"{home}/.config/opencode/opencode.json",
                json.dumps(opencode_json),
            )
        await self._sb._exec_with_retry(
            [
                "sh",
                "-c",
                f"chmod 600 {home}/.local/share/opencode/auth.json 2>/dev/null || true",
            ],
            timeout=15,
        )
        self._provisioned = fingerprint

    async def run_opencode(self, task: str, model: Optional[str] = None) -> Dict[str, Any]:
        """Run a coding task autonomously with the opencode CLI in the sandbox.

        opencode is an AI coding agent: give it a complete, self-contained task
        (what to build/change, in which directory/repo) and it will edit files and
        run commands on its own using your configured LLM key. Work happens in
        /workspace, which persists between calls. Returns opencode's stdout/stderr
        and exit_code (0 = success).

        Args:
            task: A complete natural-language description of the coding task.
            model: Optional opencode model id as "provider/model" (e.g.
                "anthropic/claude-sonnet-4-20250514"). Defaults to the user's
                preferred BYOK provider's model.

        Returns:
            Dict with stdout, stderr, and exit_code.
        """
        if not self._byok:
            return {
                "error": "No BYOK API key is configured. Ask the user to add an "
                "LLM provider key in Settings → BYOK before using opencode.",
                "exit_code": 1,
            }

        chosen = model or DEFAULT_MODELS.get(self._default)
        if not chosen:
            return {
                "error": f"No default model for provider '{self._default}'.",
                "exit_code": 1,
            }

        await self.ensure_opencode()

        run_cmd = (
            f"{_PATH_PREFIX}; cd /workspace && "
            f"opencode run -m {shlex.quote(chosen)} {shlex.quote(task)}"
        )
        try:
            return await self._sb._exec_with_retry(["sh", "-c", run_cmd], timeout=1200)
        except SandboxNotFoundError:
            # VM was recreated mid-run; provisioning is now stale.
            self._provisioned = None
            await self.ensure_opencode()
            return await self._sb._exec_with_retry(["sh", "-c", run_cmd], timeout=1200)
