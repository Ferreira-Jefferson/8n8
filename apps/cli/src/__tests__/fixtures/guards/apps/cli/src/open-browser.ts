// Fixture of guards.test.ts: the one file allowed to start processes (DIST-23).
import { spawn } from "node:child_process";

export const start = spawn;
