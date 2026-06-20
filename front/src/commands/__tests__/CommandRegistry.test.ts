import { CommandRegistry } from "../CommandRegistry";
import { commandsApi } from "../../apiClient";

jest.mock("../../apiClient", () => ({
  commandsApi: { list: jest.fn() },
}));

describe("CommandRegistry", () => {
  beforeEach(() => {
    CommandRegistry.invalidate();
    (commandsApi.list as jest.Mock).mockClear();
    (commandsApi.list as jest.Mock).mockResolvedValue({
      commands: [
        {
          name: "memory.note",
          title: "Save note",
          description: "d",
          requires: [],
          missing: [],
          args_schema: { type: "object", properties: {} },
          surface: "chat",
        },
      ],
    });
  });

  it("memoizes after first load", async () => {
    await CommandRegistry.load();
    await CommandRegistry.load();
    expect(commandsApi.list).toHaveBeenCalledTimes(1);
  });

  it("invalidate forces refetch", async () => {
    await CommandRegistry.load();
    CommandRegistry.invalidate();
    await CommandRegistry.load();
    expect(commandsApi.list).toHaveBeenCalledTimes(2);
  });

  it("get returns undefined for unknown name", async () => {
    await CommandRegistry.load();
    expect(CommandRegistry.get("nope")).toBeUndefined();
    expect(CommandRegistry.get("memory.note")?.title).toBe("Save note");
  });
});
