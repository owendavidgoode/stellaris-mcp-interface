import type { GameState, LogGameState } from "../parser/types.js";
import { parseSaveFile, findLatestSave } from "../parser/save-parser.js";
import type { LogWatcher } from "../watcher/log-watcher.js";
import type { StellarisMcpConfig } from "../config.js";

/**
 * Get the current game state from the best available source.
 * Prefers log data (more recent) but falls back to save parsing.
 */
export async function getGameState(
  config: StellarisMcpConfig,
  logWatcher: LogWatcher
): Promise<{ source: string; state: GameState | LogGameState | null }> {
  // Try log watcher first (most recent data)
  const logState = logWatcher.latestState;
  if (logState && logState.date) {
    return { source: "game_log", state: logState };
  }

  // Fall back to latest save file
  return getGameStateFromSave(config);
}

export async function getGameStateFromSave(
  config: StellarisMcpConfig
): Promise<{ source: string; state: GameState | null }> {
  const savePath = await findLatestSave(
    config.saveGamesPath,
    config.saveProfile
  );

  if (!savePath) {
    return { source: "none", state: null };
  }

  try {
    const state = await parseSaveFile(savePath);
    return { source: `save_file:${savePath}`, state };
  } catch (error) {
    return {
      source: "error",
      state: null,
    };
  }
}

/**
 * Format game state for display to the AI
 */
export function formatGameState(
  state: GameState | LogGameState | null,
  source: string
): string {
  if (!state) {
    return `No game state available (source: ${source}). Is Stellaris running with the AI Player mod enabled?`;
  }

  if ("meta" in state) {
    return formatFullGameState(state);
  }

  return formatLogState(state);
}

function formatFullGameState(state: GameState): string {
  const { meta, player, countries, wars } = state;
  const lines: string[] = [];

  lines.push(`# Stellaris Game State`);
  lines.push(`**Date:** ${meta.date} | **Version:** ${meta.version} | **Empire:** ${player.name}`);
  lines.push("");

  // Resources
  lines.push("## Resources");
  lines.push("| Resource | Stockpile | Monthly Income |");
  lines.push("|----------|-----------|----------------|");
  const importantResources = [
    "energy", "minerals", "food", "consumer_goods", "alloys",
    "influence", "unity",
  ] as const;
  for (const r of importantResources) {
    const stock = player.resources[r];
    const inc = player.resourceIncome[r];
    if (stock > 0 || inc !== 0) {
      lines.push(
        `| ${r} | ${stock.toFixed(0)} | ${inc >= 0 ? "+" : ""}${inc.toFixed(1)} |`
      );
    }
  }
  lines.push("");

  // Research
  lines.push("## Research");
  const { technologies } = player;
  lines.push(
    `- **Physics:** ${technologies.physics.current || "none"} (${technologies.physics.progress.toFixed(0)})`
  );
  lines.push(
    `- **Society:** ${technologies.society.current || "none"} (${technologies.society.progress.toFixed(0)})`
  );
  lines.push(
    `- **Engineering:** ${technologies.engineering.current || "none"} (${technologies.engineering.progress.toFixed(0)})`
  );
  lines.push(`- **Completed:** ${technologies.completed.length} technologies`);
  lines.push("");

  // Planets
  lines.push(`## Planets (${player.planets.length})`);
  for (const p of player.planets) {
    lines.push(
      `- **${p.name}** (${p.planetClass}, size ${p.size}): ${p.pops} pops, stability ${p.stability.toFixed(0)}, crime ${p.crime.toFixed(0)}, free jobs ${p.freeJobs}`
    );
  }
  lines.push("");

  // Fleets
  lines.push(
    `## Fleets (${player.fleets.length}) - Navy: ${player.navySize}/${player.navyCap}`
  );
  for (const f of player.fleets) {
    if (f.militaryPower > 0) {
      lines.push(
        `- **${f.name}**: ${f.ships} ships, ${f.militaryPower.toFixed(0)} power${f.mia ? " [MIA]" : ""}`
      );
    }
  }
  lines.push("");

  // Diplomacy
  if (countries.length > 0) {
    lines.push(`## Known Empires (${countries.length})`);
    for (const c of countries.slice(0, 15)) {
      const tags: string[] = [];
      if (c.isRival) tags.push("RIVAL");
      if (c.hasDefensivePact) tags.push("DEF_PACT");
      if (c.isAtWar) tags.push("AT_WAR");
      if (c.hasFederation) tags.push("FEDERATION");
      lines.push(
        `- **${c.name}** (${c.type}): opinion ${c.opinion}, mil ${c.militaryPower.toFixed(0)}${tags.length ? " [" + tags.join(", ") + "]" : ""}`
      );
    }
    lines.push("");
  }

  // Wars
  if (wars.length > 0) {
    lines.push("## Active Wars");
    for (const w of wars) {
      lines.push(`- **${w.name}**: ${w.warGoal} (started ${w.startDate})`);
    }
  }

  return lines.join("\n");
}

function formatLogState(state: LogGameState): string {
  const lines: string[] = [];
  lines.push(`# Game State (from log)`);
  lines.push(`**Date:** ${state.date}`);
  lines.push("");

  if (state.summary) {
    lines.push("## Summary");
    lines.push(`- Planets: ${state.summary.numPlanets}`);
    lines.push(`- Pops: ${state.summary.numPops}`);
    lines.push(`- Navy Cap: ${state.summary.navyCap}`);
    lines.push(`- Fleet Power: ${state.summary.fleetPower}`);
    lines.push("");
  }

  if (state.resources) {
    lines.push("## Resources");
    lines.push("| Resource | Stockpile | Income |");
    lines.push("|----------|-----------|--------|");
    for (const [k, v] of Object.entries(state.resources)) {
      const inc = state.resourceIncome?.[k as keyof typeof state.resourceIncome] ?? 0;
      lines.push(`| ${k} | ${v} | ${inc >= 0 ? "+" : ""}${inc} |`);
    }
    lines.push("");
  }

  if (state.planets && state.planets.length > 0) {
    lines.push(`## Planets (${state.planets.length})`);
    for (const p of state.planets) {
      lines.push(
        `- **${p.name}** (${p.planetClass}): ${p.pops} pops, stability ${p.stability}`
      );
    }
    lines.push("");
  }

  if (state.fleets && state.fleets.length > 0) {
    lines.push(`## Fleets (${state.fleets.length})`);
    for (const f of state.fleets) {
      lines.push(`- **${f.name}**: ${f.ships} ships, ${f.militaryPower} power`);
    }
  }

  return lines.join("\n");
}
