import type { CommandResult } from "./types";

type SendFn = (frame: {
  kind: "signal";
  op: "command_call";
  payload: { name: string; args: object };
}) => Promise<number>;

type AwaitResultFn = (frameId: number) => Promise<CommandResult>;

export async function runCommand(
  name: string,
  args: object,
  deps: { send: SendFn; awaitResult: AwaitResultFn },
): Promise<CommandResult> {
  const id = await deps.send({
    kind: "signal",
    op: "command_call",
    payload: { name, args },
  });
  return deps.awaitResult(id);
}
