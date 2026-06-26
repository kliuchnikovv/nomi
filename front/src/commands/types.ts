export interface CommandSpec {
    name: string;
    title: string;
    description: string;
    /** Optional argument syntax shown as a hint, e.g. "<off|low|medium|high>". */
    usage?: string;
    requires: string[];
    missing: string[];
    args_schema: object; // JSON Schema 7
    surface: 'chat' | 'background' | 'both';
    /**
     * "agent" — Python-side Command (op=command_call, args form, integration
     *   requirements). Default when the server omits the field.
     * "slash" — power-user slash command parsed by redis_session before the
     *   agent runs (/help, /think, /reset, ...). Sent as plain text.
     */
    kind?: 'agent' | 'slash';
}

export interface CommandResult {
    ok: boolean;
    text: string;
    data: unknown;
    error: { code: string; message: string } | null;
    question: { question: string; options: string[] } | null;
}
