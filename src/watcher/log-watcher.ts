import { watch, open, FileHandle } from "fs/promises";
import { stat } from "fs/promises";
import { parseLogContent } from "../parser/log-parser.js";
import type { LogGameState } from "../parser/types.js";

export class LogWatcher {
  private running = false;
  private currentState: LogGameState | null = null;
  private lastSize = 0;
  private buffer = "";

  constructor(private logPath: string) {}

  get latestState(): LogGameState | null {
    return this.currentState;
  }

  async start(): Promise<void> {
    this.running = true;
    // Read existing content first
    await this.readFull();
    // Then start watching for changes
    this.watchLoop();
  }

  stop(): void {
    this.running = false;
  }

  private async readFull(): Promise<void> {
    try {
      const { readFile } = await import("fs/promises");
      const content = await readFile(this.logPath, "utf-8");
      this.buffer = content;
      this.lastSize = Buffer.byteLength(content, "utf-8");
      this.currentState = parseLogContent(content);
    } catch {
      // File may not exist yet
    }
  }

  private async watchLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.checkForUpdates();
      } catch {
        // Ignore errors, retry next cycle
      }
      await sleep(2000); // Check every 2 seconds
    }
  }

  private async checkForUpdates(): Promise<void> {
    try {
      const s = await stat(this.logPath);
      if (s.size === this.lastSize) return;

      if (s.size < this.lastSize) {
        // File was truncated (game restart), read from beginning
        this.buffer = "";
        this.lastSize = 0;
      }

      // Read only new content
      let fh: FileHandle | null = null;
      try {
        fh = await open(this.logPath, "r");
        const newBuf = Buffer.alloc(s.size - this.lastSize);
        await fh.read(newBuf, 0, newBuf.length, this.lastSize);
        const newContent = newBuf.toString("utf-8");
        this.buffer += newContent;
        this.lastSize = s.size;

        // Re-parse if we got new AI_ lines
        if (newContent.includes("AI_")) {
          this.currentState = parseLogContent(this.buffer);
        }
      } finally {
        if (fh) await fh.close();
      }
    } catch {
      // File might not exist or be locked
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
