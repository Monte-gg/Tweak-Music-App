import { spawn } from "node:child_process";
import { resolve } from "node:path";

const children = [
  spawn(
    process.execPath,
    [resolve("node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"],
    { stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    [
      resolve("node_modules/tsx/dist/cli.mjs"),
      "watch",
      "server/index.ts",
    ],
    { stdio: "inherit" },
  ),
];

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) {
    return;
  }
  stopping = true;
  process.exitCode = exitCode;
  children.forEach((child) => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  });
}

for (const child of children) {
  child.on("error", (error) => {
    console.error("A Tweak development service could not start.", error);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) {
      stop(code ?? 1);
    }
  });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
