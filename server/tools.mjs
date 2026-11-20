import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const bundledTools = process.env.HIGHLIGHTAI_FFMPEG_DIR;

export function tool(command) {
  if (!bundledTools) return command;
  const candidate = path.join(bundledTools, process.platform === "win32" ? `${command}.exe` : command);
  return existsSync(candidate) ? candidate : command;
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool(command), args, { windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else if (options.signal?.aborted) reject(new DOMException("Operation cancelled", "AbortError"));
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-1200)}`));
    });
  });
}
