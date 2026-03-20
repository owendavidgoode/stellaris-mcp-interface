# Stellaris MCP Server

MCP (Model Context Protocol) server that allows an AI to read game state and send commands to **Stellaris** (Paradox Interactive). Designed for Stellaris **Cetus V4.3.1**.

## Architecture

The system has three components:

```
┌─────────────────┐      game.log       ┌─────────────────┐     stdio      ┌─────────────┐
│  Stellaris Mod   │ ──────────────────► │   MCP Server    │ ◄────────────► │  AI (Claude) │
│  (PDXScript)     │                     │   (TypeScript)  │                │              │
│                  │ ◄────────────────── │                 │                │              │
│                  │   ai_commands.txt   │                 │                │              │
└─────────────────┘                     └────────┬────────┘                └──────────────┘
                                                 │
                                                 │ parse .sav
                                                 ▼
                                        ┌─────────────────┐
                                        │   Save Files     │
                                        │   (.sav / ZIP)   │
                                        └─────────────────┘
```

1. **Stellaris Mod** (`mod/`) — PDXScript mod that hooks into `on_monthly_pulse_country` and dumps structured game state to `game.log` every in-game month.
2. **Save File Parser** (`src/parser/`) — Uses the [jomini](https://github.com/nickbabcock/jomini) npm package to parse `.sav` files (ZIP archives containing Clausewitz-format text).
3. **MCP Server** (`src/index.ts`) — stdio-transport MCP server exposing tools for the AI to read state and queue commands.

### Key Constraint

The Clausewitz engine has **no external API** — no REST, no WebSocket, no IPC. The mod can only **write** to `game.log` (one-way observation). Commands go through `ai_commands.txt`, which the player executes in the console via `run ai_commands.txt`.

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_game_state` | Complete game state from the latest save or real-time log |
| `get_resources` | Resource stockpiles and monthly income (13 resource types) |
| `get_planets` | Owned planets with pops, stability, buildings, districts, crime, jobs |
| `get_fleets` | Fleet composition, military power, location |
| `get_technologies` | Active research and completed tech list |
| `get_diplomacy` | Relations with all known empires (opinion, rivalries, pacts, wars) |
| `execute_command` | Queue a single console command |
| `execute_effect` | Queue a PDXScript effect command |
| `queue_commands` | Queue multiple console commands at once |
| `list_save_profiles` | List available save game profiles |
| `analyze_situation` | Comprehensive strategic analysis combining all data sources |

## Mod Data Export

The mod writes to `game.log` every month with pipe-delimited lines:

| Prefix | Data |
|--------|------|
| `AI_SUMMARY` | Date, empire name, planets, pops, navy used/cap, military power |
| `AI_RESOURCES` | Per-resource stockpile and monthly income |
| `AI_PLANET` | Per-planet: name, class, pops, size, stability, amenities, housing, jobs, crime |
| `AI_FLEET` | Per-fleet: name, ships, power, MIA status |
| `AI_DIPLO` | Per-empire: name, opinion, rival/pact/war status |
| `AI_TECH_OUTPUT` | Physics/society/engineering research output |
| `AI_STATE_END` | End-of-dump marker |

## Setup

### Prerequisites

- Node.js 18+
- Stellaris (non-ironman for console commands; save parsing works with ironman too)

### Install

```bash
# Clone and install dependencies
git clone <repo-url>
cd stellaris-mcp
npm install

# Build
npm run build
```

### Install the Stellaris Mod

```bash
bash scripts/install-mod.sh
```

Or manually copy the `mod/` contents to:
```
Documents/Paradox Interactive/Stellaris/mod/ai_player_mcp/
```

And create `Documents/Paradox Interactive/Stellaris/mod/ai_player_mcp.mod`:
```
name="AI Player MCP Bridge"
path="mod/ai_player_mcp"
tags={
    "Utilities"
}
supported_version="4.3.*"
```

Then activate **"AI Player MCP Bridge"** in the Stellaris launcher under Mods.

### Configure the MCP Server

Add to your Claude Code or Claude Desktop MCP settings:

```json
{
  "mcpServers": {
    "stellaris": {
      "command": "node",
      "args": ["<path-to-project>/dist/index.js"],
      "env": {
        "STELLARIS_SAVE_PROFILE": "ia"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STELLARIS_DOCUMENTS_PATH` | `~/Documents/Paradox Interactive/Stellaris` | Stellaris user data directory |
| `STELLARIS_INSTALL_PATH` | `F:/SteamLibrary/steamapps/common/Stellaris` | Game installation directory |
| `STELLARIS_SAVE_PROFILE` | _(empty)_ | Save game profile folder name |

## Usage

### Reading Game State

The AI can call any read tool at any time. Data sources:
- **Save file parsing** — full game state from the latest `.sav` file
- **Log monitoring** — real-time updates from the mod's `game.log` output (requires mod to be active)

### Sending Commands

1. The AI queues commands via `execute_command`, `execute_effect`, or `queue_commands`
2. Commands are written to `Documents/Paradox Interactive/Stellaris/ai_commands.txt`
3. In-game, open the console (`~`) and type: `run ai_commands.txt`

Example commands the AI might generate:
```
# Direct console commands
cash 1000
research_technology tech_lasers_2
influence 100

# Effect commands (wrapped automatically)
effect add_resource = { energy = 500 }
effect every_owned_planet = { limit = { free_jobs > 5 } add_building = building_factory_1 }
```

### Testing the Parser

```bash
# Parse all save profiles and print results
npm run test:parser
```

## Project Structure

```
stellaris-mcp/
├── mod/                                  # Stellaris mod (PDXScript)
│   ├── descriptor.mod
│   ├── common/
│   │   ├── on_actions/                   # Monthly pulse hooks
│   │   └── scripted_effects/             # State dump effects
│   ├── events/                           # ai_player event chain
│   └── localisation/english/
├── src/                                  # MCP Server (TypeScript)
│   ├── index.ts                          # Server entry point + tool definitions
│   ├── config.ts                         # Configuration loading
│   ├── parser/
│   │   ├── types.ts                      # Game state TypeScript interfaces
│   │   ├── save-parser.ts                # .sav file parser (jomini)
│   │   ├── log-parser.ts                 # game.log parser
│   │   └── test-parser.ts               # Parser test script
│   ├── tools/
│   │   └── get-game-state.ts             # State formatting for MCP responses
│   ├── watcher/
│   │   ├── save-watcher.ts               # Autosave directory watcher
│   │   └── log-watcher.ts                # game.log tail watcher
│   └── commands/
│       └── command-writer.ts             # Console command file writer
├── scripts/
│   └── install-mod.sh                    # Mod installer script
├── package.json
└── tsconfig.json
```

## Limitations

- **No real-time command injection** — the Clausewitz engine cannot receive commands from external programs. Commands require manual console execution.
- **Localization keys** — save files store internal keys (e.g. `%ADJECTIVE%`, `NEW_COLONY_NAME_1`) rather than display names. The game resolves these at runtime.
- **Monthly log frequency** — the mod dumps state once per in-game month. For more frequent updates, use save file parsing with shorter autosave intervals.
- **Non-ironman required** — console commands and the `run` command only work in non-ironman games. Save parsing works with both modes.

## Future Plans

- **Phase 2: Command injection via save file flags** — modify save files to set global flags that the mod reads and executes as actions, enabling a fully autonomous loop.
- **Phase 3: Hot-reload automation** — use `-debug_mode` launch flag + console automation to inject and execute commands without manual interaction.
