export interface CommandSpec {
  name: string;
  title: string;
  description: string;
  requires: string[];
  missing: string[];
  args_schema: object; // JSON Schema 7
  surface: "chat" | "background" | "both";
}

export interface CommandResult {
  ok: boolean;
  text: string;
  data: unknown;
  error: { code: string; message: string } | null;
  question: { question: string; options: string[] } | null;
}
