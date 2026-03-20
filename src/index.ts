#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { parseSaveFile, findLatestSave } from "./parser/save-parser.js";
import { parseGameLog } from "./parser/log-parser.js";
import { LogWatcher } from "./watcher/log-watcher.js";
import { SaveWatcher } from "./watcher/save-watcher.js";
import { CommandWriter } from "./commands/command-writer.js";
import {
  getGameState,
  getGameStateFromSave,
  formatGameState,
} from "./tools/get-game-state.js";
import type { GameState, Resources } from "./parser/types.js";
import { RESOURCE_KEYS } from "./parser/types.js";

const config = loadConfig();
const logWatcher = new LogWatcher(config.gameLogPath);
const saveWatcher = new SaveWatcher(config.saveGamesPath, config.saveProfile);
const commandWriter = new CommandWriter(config.stellarisDocumentsPath);

const server = new McpServer({
  name: "stellaris-ai",
  version: "0.1.0",
});

// ─── Tool: get_game_state ───────────────────────────────────────
server.tool(
  "get_game_state",
  "Get the complete current game state from Stellaris (resources, planets, fleets, tech, diplomacy). Parses the latest save file or reads real-time log data from the mod.",
  {
    source: z
      .enum(["auto", "save", "log"])
      .optional()
      .describe("Data source: auto (best available), save (parse .sav file), log (real-time mod log)"),
    save_profile: z
      .string()
      .optional()
      .describe("Save game profile folder name (e.g. 'ia')"),
  },
  async ({ source, save_profile }) => {
    const effectiveConfig = save_profile
      ? { ...config, saveProfile: save_profile }
      : config;

    let result;
    if (source === "save") {
      result = await getGameStateFromSave(effectiveConfig);
    } else if (source === "log") {
      const logState = logWatcher.latestState;
      result = { source: "game_log", state: logState };
    } else {
      result = await getGameState(effectiveConfig, logWatcher);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatGameState(result.state, result.source),
        },
      ],
    };
  }
);

// ─── Tool: get_resources ────────────────────────────────────────
server.tool(
  "get_resources",
  "Get current resource stockpiles and monthly income for the player's empire.",
  {
    save_profile: z.string().optional(),
  },
  async ({ save_profile }) => {
    const effectiveConfig = save_profile
      ? { ...config, saveProfile: save_profile }
      : config;

    const { state } = await getGameState(effectiveConfig, logWatcher);
    if (!state) {
      return { content: [{ type: "text" as const, text: "No game state available." }] };
    }

    let text: string;
    if ("player" in state) {
      const { resources, resourceIncome } = state.player;
      const lines = ["# Resources\n| Resource | Stockpile | Monthly |", "|----------|-----------|---------|"];
      for (const k of RESOURCE_KEYS) {
        const s = resources[k];
        const i = resourceIncome[k];
        if (s > 0 || i !== 0) {
          lines.push(`| ${k} | ${s.toFixed(0)} | ${i >= 0 ? "+" : ""}${i.toFixed(1)} |`);
        }
      }
      text = lines.join("\n");
    } else {
      text = "Resource data from log:\n" + JSON.stringify(state.resources, null, 2);
    }

    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool: get_planets ──────────────────────────────────────────
server.tool(
  "get_planets",
  "Get details about all owned planets (pops, buildings, districts, stability, jobs).",
  {
    save_profile: z.string().optional(),
  },
  async ({ save_profile }) => {
    const effectiveConfig = save_profile
      ? { ...config, saveProfile: save_profile }
      : config;

    const { state } = await getGameState(effectiveConfig, logWatcher);
    if (!state) {
      return { content: [{ type: "text" as const, text: "No game state available." }] };
    }

    let text: string;
    if ("player" in state) {
      const planets = state.player.planets;
      const lines = [`# Owned Planets (${planets.length})\n`];
      for (const p of planets) {
        lines.push(`## ${p.name} (ID: ${p.id})`);
        lines.push(`- Class: ${p.planetClass}, Size: ${p.size}`);
        lines.push(`- Pops: ${p.pops}, Stability: ${p.stability.toFixed(1)}, Crime: ${p.crime.toFixed(1)}`);
        lines.push(`- Housing: ${p.housing.toFixed(0)} (free: ${p.freeHousing}), Free Jobs: ${p.freeJobs}`);
        lines.push(`- Designation: ${p.designation || "none"}`);
        if (p.buildings.length > 0) {
          lines.push(`- Buildings: ${p.buildings.join(", ")}`);
        }
        if (Object.keys(p.districts).length > 0) {
          const distStr = Object.entries(p.districts)
            .map(([k, v]) => `${k}×${v}`)
            .join(", ");
          lines.push(`- Districts: ${distStr}`);
        }
        lines.push("");
      }
      text = lines.join("\n");
    } else {
      text = JSON.stringify(state.planets, null, 2);
    }

    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool: get_fleets ───────────────────────────────────────────
server.tool(
  "get_fleets",
  "Get details about all owned fleets (ships, power, location).",
  {
    save_profile: z.string().optional(),
  },
  async ({ save_profile }) => {
    const effectiveConfig = save_profile
      ? { ...config, saveProfile: save_profile }
      : config;

    const { state } = await getGameState(effectiveConfig, logWatcher);
    if (!state) {
      return { content: [{ type: "text" as const, text: "No game state available." }] };
    }

    let text: string;
    if ("player" in state) {
      const { fleets, navySize, navyCap } = state.player;
      const military = fleets.filter((f) => f.militaryPower > 0);
      const civilian = fleets.filter((f) => f.militaryPower === 0);

      const lines = [`# Fleets - Navy: ${navySize}/${navyCap}\n`];
      lines.push(`## Military Fleets (${military.length})`);
      for (const f of military) {
        lines.push(`- **${f.name}** (ID: ${f.id}): ${f.ships} ships, ${f.militaryPower.toFixed(0)} power, location: ${f.location || "unknown"}${f.mia ? " [MIA]" : ""}`);
      }
      lines.push(`\n## Civilian Fleets (${civilian.length})`);
      for (const f of civilian) {
        lines.push(`- **${f.name}** (ID: ${f.id}): ${f.ships} ships`);
      }
      text = lines.join("\n");
    } else {
      text = JSON.stringify(state.fleets, null, 2);
    }

    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool: get_technologies ─────────────────────────────────────
server.tool(
  "get_technologies",
  "Get current research status and completed technologies.",
  {
    save_profile: z.string().optional(),
  },
  async ({ save_profile }) => {
    const effectiveConfig = save_profile
      ? { ...config, saveProfile: save_profile }
      : config;

    const { state } = await getGameState(effectiveConfig, logWatcher);
    if (!state || !("player" in state)) {
      return { content: [{ type: "text" as const, text: "No tech data available." }] };
    }

    const { technologies } = state.player;
    const lines = [
      "# Research Status\n",
      `## Currently Researching`,
      `- **Physics:** ${technologies.physics.current || "none"} (progress: ${technologies.physics.progress.toFixed(0)})`,
      `- **Society:** ${technologies.society.current || "none"} (progress: ${technologies.society.progress.toFixed(0)})`,
      `- **Engineering:** ${technologies.engineering.current || "none"} (progress: ${technologies.engineering.progress.toFixed(0)})`,
      "",
      `## Completed Technologies (${technologies.completed.length})`,
      technologies.completed.join(", "),
    ];

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ─── Tool: get_diplomacy ────────────────────────────────────────
server.tool(
  "get_diplomacy",
  "Get diplomatic relations with all known empires (opinion, rivalries, pacts, wars).",
  {
    save_profile: z.string().optional(),
  },
  async ({ save_profile }) => {
    const effectiveConfig = save_profile
      ? { ...config, saveProfile: save_profile }
      : config;

    const { state } = await getGameState(effectiveConfig, logWatcher);
    if (!state) {
      return { content: [{ type: "text" as const, text: "No diplomacy data available." }] };
    }

    let text: string;
    if ("countries" in state && state.countries) {
      const lines = [`# Diplomatic Relations\n`];
      for (const c of state.countries) {
        const tags: string[] = [];
        if (c.isRival) tags.push("RIVAL");
        if (c.hasDefensivePact) tags.push("DEFENSIVE PACT");
        if (c.hasFederation) tags.push("FEDERATION");
        if (c.isAtWar) tags.push("AT WAR");
        lines.push(`## ${c.name} (${c.type})`);
        lines.push(`- Government: ${c.government}`);
        lines.push(`- Ethics: ${c.ethics.join(", ")}`);
        lines.push(`- Opinion: ${c.opinion} | Attitude: ${c.attitude}`);
        lines.push(`- Military: ${c.militaryPower.toFixed(0)} | Tech: ${c.techPower.toFixed(0)} | Economy: ${c.economyPower.toFixed(0)}`);
        lines.push(`- Planets: ${c.numPlanets} | Pops: ${c.numPops}`);
        if (tags.length) lines.push(`- Status: ${tags.join(", ")}`);
        lines.push("");
      }

      if (state.wars && state.wars.length > 0) {
        lines.push("## Active Wars");
        for (const w of state.wars) {
          lines.push(`- **${w.name}**: ${w.warGoal} (started ${w.startDate})`);
        }
      }

      text = lines.join("\n");
    } else {
      text = JSON.stringify(state, null, 2);
    }

    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool: execute_command ──────────────────────────────────────
server.tool(
  "execute_command",
  "Queue a console command for Stellaris. Commands are written to ai_commands.txt, which must be executed in-game via `run ai_commands.txt` in the console (~).",
  {
    command: z.string().describe("Console command to execute (e.g. 'cash 1000', 'research_technology tech_lasers_2')"),
  },
  async ({ command }) => {
    commandWriter.queueCommand(command);
    const result = await commandWriter.flush();
    return { content: [{ type: "text" as const, text: result }] };
  }
);

// ─── Tool: execute_effect ───────────────────────────────────────
server.tool(
  "execute_effect",
  "Queue a PDXScript effect command. Wraps the effect in `effect { ... }` syntax. Written to ai_commands.txt for execution via console.",
  {
    effect: z.string().describe("PDXScript effect code (e.g. 'add_resource = { energy = 500 }')"),
  },
  async ({ effect }) => {
    commandWriter.queueEffect(effect);
    const result = await commandWriter.flush();
    return { content: [{ type: "text" as const, text: result }] };
  }
);

// ─── Tool: queue_commands ───────────────────────────────────────
server.tool(
  "queue_commands",
  "Queue multiple console commands at once. They will all be written to ai_commands.txt.",
  {
    commands: z
      .array(z.string())
      .describe("Array of console commands to queue"),
  },
  async ({ commands }) => {
    for (const cmd of commands) {
      commandWriter.queueCommand(cmd);
    }
    const result = await commandWriter.flush();
    return { content: [{ type: "text" as const, text: result }] };
  }
);

// ─── Tool: list_save_profiles ───────────────────────────────────
server.tool(
  "list_save_profiles",
  "List available save game profiles and their save files.",
  {},
  async () => {
    const { readdir, stat } = await import("fs/promises");
    const { join } = await import("path");

    try {
      const entries = await readdir(config.saveGamesPath);
      const lines = ["# Save Game Profiles\n"];

      for (const entry of entries) {
        const entryPath = join(config.saveGamesPath, entry);
        const s = await stat(entryPath);
        if (s.isDirectory()) {
          const files = await readdir(entryPath);
          const saves = files.filter((f) => f.endsWith(".sav"));
          lines.push(`- **${entry}**: ${saves.length} save(s) — ${saves.join(", ")}`);
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error reading save directory: ${error}`,
          },
        ],
      };
    }
  }
);

// ─── Tool: analyze_situation ────────────────────────────────────
server.tool(
  "analyze_situation",
  "Get a comprehensive strategic analysis of the current game situation, combining all available data sources.",
  {
    save_profile: z.string().optional(),
  },
  async ({ save_profile }) => {
    const effectiveConfig = save_profile
      ? { ...config, saveProfile: save_profile }
      : config;

    const { state, source } = await getGameState(effectiveConfig, logWatcher);
    if (!state) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No game data available. Ensure Stellaris is running with autosave enabled, or specify a save_profile.",
          },
        ],
      };
    }

    const formattedState = formatGameState(state, source);

    const analysis = [
      formattedState,
      "",
      "---",
      "## Instructions for AI Advisor",
      "",
      "You now have the complete game state. Analyze the situation and provide strategic advice covering:",
      "1. **Economic Assessment** — Are resources balanced? Any critical shortages?",
      "2. **Military Assessment** — Fleet strength relative to neighbors. Vulnerabilities?",
      "3. **Expansion Opportunities** — Available colonization targets, claims worth pressing?",
      "4. **Diplomatic Landscape** — Threats, potential allies, federation opportunities?",
      "5. **Technology Priorities** — What should be researched next given current situation?",
      "6. **Recommended Actions** — Top 3-5 concrete actions to take this decade.",
      "",
      "If you want to execute actions, use the `execute_command` or `queue_commands` tools.",
      `The player must then run \`run ai_commands.txt\` in the Stellaris console.`,
    ];

    return { content: [{ type: "text" as const, text: analysis.join("\n") }] };
  }
);

// ─── Start the server ───────────────────────────────────────────
async function main() {
  // Start watchers
  try {
    await logWatcher.start();
  } catch {
    // Log file may not exist yet, that's ok
  }

  try {
    saveWatcher.start();
  } catch {
    // Save dir may not exist
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
