/**
 * Test script - parse the existing save file and print results
 * Run with: npm run test:parser
 */
import { parseSaveFile, findLatestSave } from "./save-parser.js";
import { formatGameState } from "../tools/get-game-state.js";
import { homedir } from "os";
import { join } from "path";

async function main() {
  const saveDir = join(
    homedir(),
    "Documents",
    "Paradox Interactive",
    "Stellaris",
    "save games"
  );

  console.log("Looking for save files in:", saveDir);

  // Try all profiles
  const { readdir, stat } = await import("fs/promises");
  const entries = await readdir(saveDir);

  for (const entry of entries) {
    const entryPath = join(saveDir, entry);
    const s = await stat(entryPath);
    if (!s.isDirectory()) continue;

    const savePath = await findLatestSave(saveDir, entry);
    if (!savePath) {
      console.log(`Profile "${entry}": no save files found`);
      continue;
    }

    console.log(`\nProfile "${entry}": parsing ${savePath}...`);
    try {
      const state = await parseSaveFile(savePath);
      console.log(formatGameState(state, `save:${savePath}`));
    } catch (error) {
      console.error(`Error parsing ${savePath}:`, error);
    }
  }
}

main().catch(console.error);
