import { watch } from "chokidar";
import { join } from "path";
import type { FSWatcher } from "chokidar";

export type SaveCallback = (savePath: string) => void;

export class SaveWatcher {
  private watcher: FSWatcher | null = null;
  private callbacks: SaveCallback[] = [];
  private lastSavePath: string | null = null;

  constructor(
    private saveDir: string,
    private profile?: string
  ) {}

  get latestSave(): string | null {
    return this.lastSavePath;
  }

  onNewSave(callback: SaveCallback): void {
    this.callbacks.push(callback);
  }

  start(): void {
    const watchDir = this.profile
      ? join(this.saveDir, this.profile)
      : this.saveDir;

    this.watcher = watch(join(watchDir, "*.sav"), {
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 500,
      },
    });

    this.watcher.on("add", (path) => this.handleNewSave(path));
    this.watcher.on("change", (path) => this.handleNewSave(path));
  }

  private handleNewSave(path: string): void {
    this.lastSavePath = path;
    for (const cb of this.callbacks) {
      cb(path);
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
