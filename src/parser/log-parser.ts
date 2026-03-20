import { readFile } from "fs/promises";
import type { LogGameState, Resources } from "./types.js";
import { RESOURCE_KEYS } from "./types.js";

const AI_PREFIX = "AI_";
const STATE_END_MARKER = "AI_STATE_END";

/**
 * Parse the game.log file for AI_* prefixed lines from the mod.
 * Returns the latest complete state dump.
 */
export async function parseGameLog(
  logPath: string
): Promise<LogGameState | null> {
  try {
    const content = await readFile(logPath, "utf-8");
    return parseLogContent(content);
  } catch {
    return null;
  }
}

export function parseLogContent(content: string): LogGameState | null {
  const lines = content.split("\n");

  // Find the last complete state dump (between last AI_SUMMARY and AI_STATE_END)
  let lastEndIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(STATE_END_MARKER)) {
      lastEndIdx = i;
      break;
    }
  }

  if (lastEndIdx === -1) return null;

  // Find the start of this dump (AI_SUMMARY before the end)
  let startIdx = -1;
  for (let i = lastEndIdx - 1; i >= 0; i--) {
    if (lines[i].includes("AI_SUMMARY|")) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) {
    // Try to find any AI_ lines before the end
    for (let i = lastEndIdx - 1; i >= 0; i--) {
      if (!lines[i].includes(AI_PREFIX)) {
        startIdx = i + 1;
        break;
      }
    }
  }

  if (startIdx === -1) startIdx = 0;

  // Parse all AI_ lines in this block
  const state: LogGameState = { date: "" };
  const resources: Partial<Resources> = {};
  const income: Partial<Resources> = {};
  const planets: any[] = [];
  const fleets: any[] = [];
  const diplomacy: any[] = [];

  for (let i = startIdx; i <= lastEndIdx; i++) {
    const line = lines[i];
    const aiMatch = extractAiLine(line);
    if (!aiMatch) continue;

    const { type, fields } = aiMatch;

    switch (type) {
      case "AI_SUMMARY":
        state.date = fields[0] || "";
        state.summary = {
          numPlanets: num(fields[2]),
          numPops: num(fields[3]),
          navyCap: num(fields[4]),
          fleetPower: num(fields[5]),
        };
        break;

      case "AI_RESOURCES": {
        const resName = fields[1] as keyof Resources;
        if (RESOURCE_KEYS.includes(resName)) {
          resources[resName] = num(fields[2]);
          income[resName] = num(fields[3]);
        }
        break;
      }

      case "AI_PLANET":
        planets.push({
          name: fields[0],
          planetClass: fields[1],
          pops: num(fields[2]),
          size: num(fields[3]),
          stability: num(fields[4]),
          amenities: num(fields[5]),
          freeHousing: num(fields[6]),
          freeJobs: num(fields[7]),
          crime: num(fields[8]),
        });
        break;

      case "AI_FLEET":
        fleets.push({
          name: fields[0],
          ships: num(fields[1]),
          militaryPower: num(fields[2]),
          mia: fields[3] === "yes",
        });
        break;

      case "AI_DIPLO":
        diplomacy.push({
          name: fields[0],
          opinion: num(fields[1]),
          isRival: fields[2] === "yes",
          hasDefensivePact: fields[3] === "yes",
        });
        break;

      case "AI_TECH_OUTPUT":
        // fields: physics|society|engineering
        break;
    }
  }

  if (Object.keys(resources).length > 0) state.resources = resources;
  if (Object.keys(income).length > 0) state.resourceIncome = income;
  if (planets.length > 0) state.planets = planets;
  if (fleets.length > 0) state.fleets = fleets;
  if (diplomacy.length > 0) state.diplomacy = diplomacy;

  return state;
}

function extractAiLine(
  line: string
): { type: string; fields: string[] } | null {
  // Log lines from Stellaris look like: [HH:MM:SS] [game] AI_TYPE|field1|field2|...
  // or just: AI_TYPE|field1|field2|...
  const aiIdx = line.indexOf("AI_");
  if (aiIdx === -1) return null;

  const payload = line.substring(aiIdx);
  const parts = payload.split("|");
  if (parts.length < 2) return null;

  return {
    type: parts[0].trim(),
    fields: parts.slice(1).map((s) => s.trim()),
  };
}

function num(val: string | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}
