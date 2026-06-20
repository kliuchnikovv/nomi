import { commandsApi } from "../apiClient";
import type { CommandSpec } from "./types";

let cache: CommandSpec[] | null = null;
let inflight: Promise<CommandSpec[]> | null = null;

export const CommandRegistry = {
  async load(): Promise<CommandSpec[]> {
    if (cache) return cache;
    if (!inflight) {
      inflight = commandsApi
        .list()
        .then((res) => {
          cache = res?.commands ?? [];
          return cache;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  },

  invalidate(): void {
    cache = null;
    inflight = null;
  },

  list(): CommandSpec[] {
    return cache ?? [];
  },

  get(name: string): CommandSpec | undefined {
    return (cache ?? []).find((c) => c.name === name);
  },
};
