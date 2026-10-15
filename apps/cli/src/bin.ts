// The entry of the installed package (dist/8n8.mjs). node:sqlite still prints an
// experimental warning; only that one is dropped, every other warning is printed.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (
    warning.name === "ExperimentalWarning" &&
    warning.message.includes("SQLite")
  ) {
    return;
  }
  console.warn(`${warning.name}: ${warning.message}`);
});

// cli.mjs is a second bundle (installed.ts), loaded only now: bundled into this file,
// its node:sqlite import would be hoisted above the filter.
const cli = "./cli.mjs";
await import(cli);

export {};
