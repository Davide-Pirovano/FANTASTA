import { backup } from "node:sqlite";
import type { LocalDatabase } from "./database.js";

/** Crea una copia consistente anche quando il database usa WAL. */
export async function createLocalBackup(database: LocalDatabase, destinationPath: string): Promise<number> {
  if (!destinationPath || destinationPath === ":memory:") {
    throw new Error("Destinazione backup non valida");
  }
  return backup(database, destinationPath, { rate: 100 });
}
