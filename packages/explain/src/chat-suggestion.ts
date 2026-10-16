import type { ChatSuggestion, LineRange } from "@8n8/model";
import { suggestionSchema } from "./schema";

const MAX_COMMAND_CHARS = 300;
const MAX_REASON_CHARS = 600;

/** A suggestion the model wrote, or the screen sent: whole, with a line inside the node. Anything else is nothing (a bad suggestion never spoils the answer). */
export function acceptSuggestion(
  raw: unknown,
  range: LineRange,
): ChatSuggestion | undefined {
  const parsed = suggestionSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const command = parsed.data.command.trim();
  const reason = parsed.data.reason.trim();
  const { line, severity } = parsed.data;
  if (command === "" || reason === "") return undefined;
  if (command.length > MAX_COMMAND_CHARS || reason.length > MAX_REASON_CHARS) {
    return undefined;
  }
  if (line < range.start || line > range.end) return undefined;
  return { command, reason, line, severity };
}
