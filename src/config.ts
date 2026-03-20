import { homedir } from "os";
import { join } from "path";

export interface StellarisMcpConfig {
  /** Path to Documents/Paradox Interactive/Stellaris/ */
  stellarisDocumentsPath: string;
  /** Path to Stellaris installation */
  stellarisInstallPath: string;
  /** Path to game.log */
  gameLogPath: string;
  /** Path to save games directory */
  saveGamesPath: string;
  /** Path to the mod directory in documents */
  modDocumentsPath: string;
  /** Active save game profile name */
  saveProfile: string;
  /** How often (in game months) to do a full state dump */
  fullDumpInterval: number;
}

export function loadConfig(): StellarisMcpConfig {
  const documentsPath =
    process.env.STELLARIS_DOCUMENTS_PATH ||
    join(homedir(), "Documents", "Paradox Interactive", "Stellaris");

  const installPath =
    process.env.STELLARIS_INSTALL_PATH ||
    "F:/SteamLibrary/steamapps/common/Stellaris";

  const saveProfile = process.env.STELLARIS_SAVE_PROFILE || "";

  return {
    stellarisDocumentsPath: documentsPath,
    stellarisInstallPath: installPath,
    gameLogPath: join(documentsPath, "logs", "game.log"),
    saveGamesPath: join(documentsPath, "save games"),
    modDocumentsPath: join(documentsPath, "mod"),
    saveProfile,
    fullDumpInterval: 1,
  };
}
