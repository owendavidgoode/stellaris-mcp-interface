import AdmZip from "adm-zip";
import { Jomini } from "jomini";
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import type {
  GameState,
  GameMeta,
  PlayerState,
  Country,
  Planet,
  Fleet,
  TechState,
  Leader,
  Resources,
  War,
  Starbase,
  Policy,
} from "./types.js";
import { RESOURCE_KEYS } from "./types.js";

let jominiInstance: Jomini | null = null;

async function getJomini(): Promise<Jomini> {
  if (!jominiInstance) {
    jominiInstance = await Jomini.initialize();
  }
  return jominiInstance;
}

/**
 * Find the most recent save file in the given directory
 */
export async function findLatestSave(
  saveDir: string,
  profile?: string
): Promise<string | null> {
  try {
    const searchDir = profile ? join(saveDir, profile) : saveDir;
    const entries = await readdir(searchDir);
    const savFiles = entries.filter((f) => f.endsWith(".sav"));

    if (savFiles.length === 0) return null;

    let latest = "";
    let latestTime = 0;

    for (const f of savFiles) {
      const fpath = join(searchDir, f);
      const s = await stat(fpath);
      if (s.mtimeMs > latestTime) {
        latestTime = s.mtimeMs;
        latest = fpath;
      }
    }

    return latest;
  } catch {
    return null;
  }
}

/**
 * Parse a Stellaris .sav file into structured game state
 */
export async function parseSaveFile(savePath: string): Promise<GameState> {
  const jomini = await getJomini();
  const buffer = await readFile(savePath);
  const zip = new AdmZip(Buffer.from(buffer));

  const gamestateEntry = zip.getEntry("gamestate");
  const metaEntry = zip.getEntry("meta");

  if (!gamestateEntry) {
    throw new Error("No gamestate found in save file");
  }

  const gamestateText = gamestateEntry.getData().toString("utf-8");
  const metaText = metaEntry?.getData().toString("utf-8") || "";

  const gamestate = jomini.parseText(gamestateText);
  const meta = metaText ? jomini.parseText(metaText) : {};

  return buildGameState(gamestate, meta);
}

function buildGameState(gs: any, meta: any): GameState {
  const gameMeta = extractMeta(meta, gs);
  const playerId = extractPlayerId(gs);
  const countries = extractCountries(gs, playerId);
  const player = extractPlayerState(gs, playerId);
  const wars = extractWars(gs);

  return {
    meta: gameMeta,
    player,
    countries,
    wars,
    timestamp: new Date().toISOString(),
  };
}

function extractMeta(meta: any, gs: any): GameMeta {
  return {
    version: safeStr(meta.version || gs.version, "unknown"),
    name: extractName(meta.name || gs.name),
    date: formatDate(meta.date || gs.date),
    requiredDlcs: Array.isArray(meta.required_dlcs)
      ? meta.required_dlcs
      : [],
  };
}

function extractPlayerId(gs: any): number {
  // Player country is identified in the player array
  if (gs.player && Array.isArray(gs.player)) {
    for (const p of gs.player) {
      if (p.country !== undefined) return Number(p.country);
    }
  }
  // Fallback: look for player= at top level
  if (gs.player?.country !== undefined) return Number(gs.player.country);
  return 0;
}

function safeNum(val: any, fallback = 0): number {
  if (val === undefined || val === null) return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function safeStr(val: any, fallback = ""): string {
  if (val === undefined || val === null) return fallback;
  // Jomini parses names as { key: "...", literal: true } objects
  if (typeof val === "object" && val !== null) {
    if (val.key !== undefined) return String(val.key);
    if (val.name !== undefined) return String(val.name);
    // Date objects
    if (val instanceof Date) return val.toISOString().split("T")[0];
  }
  return String(val);
}

/** Extract a display name from jomini's name objects */
function extractName(val: any): string {
  if (!val) return "Unknown";
  if (typeof val === "string") return val;
  if (typeof val === "object") {
    if (val.key) return String(val.key);
    if (val.name) return String(val.name);
    if (val.literal !== undefined && val.key !== undefined)
      return String(val.key);
  }
  return String(val);
}

/** Format a date value from jomini (could be Date object or string) */
function formatDate(val: any): string {
  if (!val) return "unknown";
  if (val instanceof Date) {
    // Convert back to Stellaris date format YYYY.MM.DD
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, "0");
    const d = String(val.getUTCDate()).padStart(2, "0");
    return `${y}.${m}.${d}`;
  }
  if (typeof val === "string") return val;
  return String(val);
}

function extractResources(countryData: any): {
  stockpile: Resources;
  income: Resources;
} {
  const stockpile = emptyResources();
  const income = emptyResources();

  // Resources are stored in modules/standard_economy_module or similar
  const modules = countryData.modules;
  if (modules) {
    const econ =
      modules.standard_economy_module || modules.economy_module || {};
    const resources = econ.resources;
    if (resources) {
      for (const key of RESOURCE_KEYS) {
        if (resources[key] !== undefined) {
          stockpile[key] = safeNum(resources[key]);
        }
      }
    }
    // Last month income
    const lastMonth = econ.last_month;
    if (lastMonth) {
      for (const key of RESOURCE_KEYS) {
        if (lastMonth[key] !== undefined) {
          income[key] = safeNum(lastMonth[key]);
        }
      }
    }
  }

  // Alternative: budget/current_month
  if (countryData.budget) {
    const current = countryData.budget.current_month;
    if (current?.income) {
      for (const key of RESOURCE_KEYS) {
        if (current.income[key] !== undefined) {
          income[key] = safeNum(current.income[key]);
        }
      }
    }
  }

  return { stockpile, income };
}

function emptyResources(): Resources {
  return {
    energy: 0,
    minerals: 0,
    food: 0,
    consumer_goods: 0,
    alloys: 0,
    volatile_motes: 0,
    exotic_gases: 0,
    rare_crystals: 0,
    dark_matter: 0,
    living_metal: 0,
    zro: 0,
    nanites: 0,
    minor_artifacts: 0,
    influence: 0,
    unity: 0,
    physics_research: 0,
    society_research: 0,
    engineering_research: 0,
  };
}

function extractPlayerState(gs: any, playerId: number): PlayerState {
  const countryMap = gs.country || {};
  const countryData = findInObject(countryMap, playerId);

  if (!countryData) {
    return {
      countryId: playerId,
      name: "Unknown",
      resources: emptyResources(),
      resourceIncome: emptyResources(),
      planets: [],
      fleets: [],
      technologies: {
        physics: { current: "", progress: 0, output: 0 },
        society: { current: "", progress: 0, output: 0 },
        engineering: { current: "", progress: 0, output: 0 },
        completed: [],
      },
      leaders: [],
      starbases: [],
      traditions: [],
      ascensionPerks: [],
      edicts: [],
      policies: [],
      navySize: 0,
      navyCap: 0,
      empireCohesion: 0,
    };
  }

  const { stockpile, income } = extractResources(countryData);
  const planets = extractPlanets(gs, countryData);
  const fleets = extractFleets(gs, countryData);
  const tech = extractTech(countryData);
  const leaders = extractLeaders(countryData);

  return {
    countryId: playerId,
    name: extractName(countryData.name),
    resources: stockpile,
    resourceIncome: income,
    planets,
    fleets,
    technologies: tech,
    leaders,
    starbases: [],
    traditions: extractArray(countryData.traditions),
    ascensionPerks: extractArray(countryData.ascension_perks),
    edicts: extractArray(countryData.active_edicts),
    policies: extractPolicies(countryData),
    navySize: safeNum(countryData.fleet_size),
    navyCap: safeNum(countryData.navy_cap),
    empireCohesion: safeNum(countryData.empire_cohesion),
  };
}

function extractPlanets(gs: any, countryData: any): Planet[] {
  const planets: Planet[] = [];
  const ownedPlanetIds = extractNumArray(countryData.owned_planets);
  const planetMap = gs.planets?.planet || gs.planet || {};

  for (const pid of ownedPlanetIds) {
    const pdata = findInObject(planetMap, pid);
    if (!pdata) continue;

    const buildings: string[] = [];
    if (pdata.buildings) {
      const bldgs = Array.isArray(pdata.buildings) ? pdata.buildings : Object.values(pdata.buildings);
      for (const b of bldgs) {
        if (b?.type) buildings.push(safeStr(b.type));
        else if (typeof b === "string") buildings.push(b);
      }
    }

    const districts: Record<string, number> = {};
    if (pdata.district) {
      const dists = Array.isArray(pdata.district) ? pdata.district : [pdata.district];
      for (const d of dists) {
        const dtype = safeStr(d?.type || d);
        if (dtype) districts[dtype] = (districts[dtype] || 0) + 1;
      }
    }

    planets.push({
      id: pid,
      name: extractName(pdata.name),
      planetClass: safeStr(pdata.planet_class),
      size: safeNum(pdata.planet_size),
      pops: safeNum(
        Array.isArray(pdata.pop) ? pdata.pop.length : pdata.num_pops
      ),
      buildings,
      districts,
      stability: safeNum(pdata.stability),
      amenities: safeNum(pdata.amenities),
      housing: safeNum(pdata.housing),
      freeHousing: safeNum(pdata.free_housing),
      crime: safeNum(pdata.crime),
      freeJobs: safeNum(pdata.free_jobs),
      designation: safeStr(pdata.designation || pdata.planet_designation),
      modifiers: extractArray(pdata.timed_modifier?.modifier || pdata.modifier),
    });
  }

  return planets;
}

function extractFleets(gs: any, countryData: any): Fleet[] {
  const fleets: Fleet[] = [];
  const fleetIds = extractNumArray(countryData.fleets_manager?.owned_fleets);
  const fleetMap = gs.fleet || {};

  for (const fid of fleetIds) {
    const fdata = findInObject(fleetMap, fid);
    if (!fdata) continue;

    const shipCount = Array.isArray(fdata.ships)
      ? fdata.ships.length
      : safeNum(fdata.num_ships);

    fleets.push({
      id: fid,
      name: extractName(fdata.name),
      ships: shipCount,
      militaryPower: safeNum(fdata.military_power),
      isMilitary: fdata.military !== undefined ? Boolean(fdata.military) : true,
      isCivilian: fdata.civilian !== undefined ? Boolean(fdata.civilian) : false,
      location: safeStr(fdata.movement_manager?.coordinate?.origin),
      mia: Boolean(fdata.mia),
    });
  }

  return fleets;
}

function extractTech(countryData: any): TechState {
  const completed: string[] = [];
  if (countryData.tech_status) {
    const techStatus = countryData.tech_status;
    if (techStatus.technology) {
      const techs = Array.isArray(techStatus.technology)
        ? techStatus.technology
        : [techStatus.technology];
      for (const t of techs) {
        if (typeof t === "string") completed.push(t);
        else if (t?.technology) completed.push(safeStr(t.technology));
      }
    }
  }

  const activeResearch = countryData.tech_status?.active_research || {};
  const areas = ["physics", "society", "engineering"] as const;
  const research: Record<string, { current: string; progress: number; output: number }> = {};

  for (const area of areas) {
    const areaData = activeResearch[area] || {};
    research[area] = {
      current: safeStr(areaData.technology),
      progress: safeNum(areaData.progress),
      output: 0,
    };
  }

  return {
    physics: research.physics,
    society: research.society,
    engineering: research.engineering,
    completed,
  };
}

function extractLeaders(countryData: any): Leader[] {
  const leaders: Leader[] = [];
  const leaderData = countryData.owned_leaders || countryData.leaders;
  if (!leaderData) return leaders;

  const leaderList = Array.isArray(leaderData) ? leaderData : [leaderData];
  for (const l of leaderList) {
    if (!l) continue;
    leaders.push({
      id: safeNum(l.id),
      name: extractName(l.name),
      class: safeStr(l.class),
      level: safeNum(l.level),
      age: safeNum(l.age),
      traits: extractArray(l.traits),
    });
  }

  return leaders;
}

function extractCountries(gs: any, playerId: number): Country[] {
  const countries: Country[] = [];
  const countryMap = gs.country || {};
  const playerRelations = gs.country
    ? findInObject(countryMap, playerId)?.relations_manager
    : null;

  const entries = Object.entries(countryMap);
  for (const [idStr, data] of entries) {
    const id = Number(idStr);
    if (isNaN(id) || id === playerId) continue;
    const c = data as any;
    if (!c || c.type === "fallen_empire_remnants") continue;

    const countryType = safeStr(c.type || c.country_type);
    if (
      countryType !== "default" &&
      countryType !== "fallen_empire" &&
      countryType !== "awakened_fallen_empire"
    ) {
      continue;
    }

    let opinion = 0;
    let isRival = false;
    let hasDefensivePact = false;
    let attitude = "unknown";

    if (playerRelations?.relation) {
      const relations = Array.isArray(playerRelations.relation)
        ? playerRelations.relation
        : [playerRelations.relation];
      for (const rel of relations) {
        if (safeNum(rel?.country) === id) {
          opinion = safeNum(rel.opinion);
          isRival = Boolean(rel.is_rival);
          hasDefensivePact = Boolean(rel.defensive_pact);
          attitude = safeStr(rel.attitude);
          break;
        }
      }
    }

    countries.push({
      id,
      name: extractName(c.name),
      type: countryType,
      government: safeStr(c.government?.type),
      ethics: extractArray(c.ethos?.ethic),
      militaryPower: safeNum(c.military_power),
      techPower: safeNum(c.tech_power),
      economyPower: safeNum(c.economy_power),
      numPlanets: safeNum(
        Array.isArray(c.owned_planets) ? c.owned_planets.length : c.num_owned_planets
      ),
      numPops: safeNum(c.num_pops),
      opinion,
      isRival,
      hasDefensivePact,
      hasFederation: Boolean(c.federation),
      isAtWar: Boolean(c.at_war),
      attitude,
    });
  }

  return countries;
}

function extractWars(gs: any): War[] {
  const wars: War[] = [];
  const warMap = gs.war || {};
  const warEntries = Array.isArray(warMap) ? warMap : Object.values(warMap);

  for (const w of warEntries) {
    if (!w || typeof w !== "object") continue;
    wars.push({
      name: extractName(w.name),
      attackers: extractArray(w.attackers?.map?.((a: any) => safeStr(a?.country)) || []),
      defenders: extractArray(w.defenders?.map?.((d: any) => safeStr(d?.country)) || []),
      warGoal: safeStr(w.war_goal?.type),
      startDate: formatDate(w.start_date),
    });
  }

  return wars;
}

function extractPolicies(countryData: any): Policy[] {
  const policies: Policy[] = [];
  if (countryData.policies) {
    const pols = Array.isArray(countryData.policies)
      ? countryData.policies
      : Object.values(countryData.policies);
    for (const p of pols) {
      if (p?.policy) {
        policies.push({
          name: safeStr(p.policy),
          selected: safeStr(p.selected),
        });
      }
    }
  }
  return policies;
}

// --- Utility functions ---

function findInObject(obj: any, id: number): any {
  if (!obj) return null;
  // Jomini may produce objects with numeric-string keys or arrays
  if (obj[id] !== undefined) return obj[id];
  if (obj[String(id)] !== undefined) return obj[String(id)];
  // May be an array indexed by id
  if (Array.isArray(obj) && obj[id]) return obj[id];
  return null;
}

function extractArray(val: any): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string") return [val];
  return [];
}

function extractNumArray(val: any): number[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(Number).filter((n) => !isNaN(n));
  if (typeof val === "number") return [val];
  return [];
}
