// A stand-in for Claude Code in stream-json mode (CC-19): it answers each user
// line with one result line and ends when its stdin ends, as the real one does.
// It needs no login, so the process test runs on any machine.
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message?.type !== "user") return;
  process.stdout.write(
    `${JSON.stringify({ type: "result", is_error: false, result: "ok" })}\n`,
  );
});
lines.on("close", () => process.exit(0));
