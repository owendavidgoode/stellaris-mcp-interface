import { writeFile, readFile } from "fs/promises";
import { join } from "path";

/**
 * Writes console commands to a file that Stellaris can execute via `run ai_commands.txt`
 *
 * The file is placed in the Stellaris documents root directory.
 * The player (or automation) must type `run ai_commands.txt` in the console to execute.
 */
export class CommandWriter {
  private commandFile: string;
  private pendingCommands: string[] = [];

  constructor(private stellarisDocumentsPath: string) {
    this.commandFile = join(stellarisDocumentsPath, "ai_commands.txt");
  }

  /**
   * Queue a raw console command
   */
  queueCommand(command: string): void {
    this.pendingCommands.push(command);
  }

  /**
   * Queue an effect command (wraps in `effect { ... }`)
   */
  queueEffect(effect: string): void {
    this.pendingCommands.push(`effect ${effect}`);
  }

  /**
   * Queue a resource command
   */
  queueAddResource(resource: string, amount: number): void {
    this.queueCommand(`${resource} ${amount}`);
  }

  /**
   * Queue a technology research command
   */
  queueResearchTech(techId: string): void {
    this.queueCommand(`research_technology ${techId}`);
  }

  /**
   * Queue a planet building command via effect
   */
  queueBuildOnPlanet(planetId: number, buildingId: string): void {
    this.queueEffect(
      `event_target:planet_${planetId} = { add_building = ${buildingId} }`
    );
  }

  /**
   * Queue a fleet move command
   */
  queueMoveFleet(fleetId: number, systemId: number): void {
    this.queueEffect(
      `fleet = { id = ${fleetId} queue_actions = { move_to = { target = galactic_object:${systemId} } } }`
    );
  }

  /**
   * Queue a policy change
   */
  queueSetPolicy(policyId: string, optionId: string): void {
    this.queueEffect(
      `set_policy = { policy = ${policyId} option = ${optionId} cooldown = yes }`
    );
  }

  /**
   * Queue a diplomatic action
   */
  queueDiplomaticAction(action: string, targetCountryId: number): void {
    this.queueEffect(
      `country:${targetCountryId} = { ${action} = root }`
    );
  }

  /**
   * Write all pending commands to the file and clear the queue
   */
  async flush(): Promise<string> {
    if (this.pendingCommands.length === 0) {
      return "No pending commands";
    }

    const content = this.pendingCommands.join("\n") + "\n";
    await writeFile(this.commandFile, content, "utf-8");

    const count = this.pendingCommands.length;
    this.pendingCommands = [];

    return `Wrote ${count} commands to ${this.commandFile}. Execute in Stellaris console: run ai_commands.txt`;
  }

  /**
   * Read current pending commands
   */
  getPendingCommands(): string[] {
    return [...this.pendingCommands];
  }

  /**
   * Clear pending commands without writing
   */
  clearPending(): void {
    this.pendingCommands = [];
  }

  /**
   * Read the current command file content
   */
  async readCommandFile(): Promise<string> {
    try {
      return await readFile(this.commandFile, "utf-8");
    } catch {
      return "";
    }
  }
}
