import { homedir } from "node:os";
import { join } from "node:path";
import { LocalLanServer } from "./server.js";

const databasePath = process.env.FANTASTA_DATABASE_PATH ?? join(homedir(), ".fantasta", "fantasta.db");
const host = process.env.FANTASTA_HOST ?? "0.0.0.0";
const port = Number(process.env.FANTASTA_PORT ?? 47821);

export async function runLocalServer(): Promise<void> {
  const server = new LocalLanServer({ databasePath, host, port });
  const address = await server.start();
  console.log(`Fantasta desktop server in ascolto su http://${address.host}:${address.port}`);
  console.log(`Database locale: ${databasePath}`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.stop();
  };

  process.once("SIGINT", () => void stop().then(() => process.exit(0)));
  process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
}

void runLocalServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
