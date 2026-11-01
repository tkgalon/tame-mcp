import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

function binary(name) {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  return process.env.TAME_PG_BIN ? join(process.env.TAME_PG_BIN, executable) : executable;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function temporaryPostgres() {
  try {
    const version = execFileSync(binary("initdb"), ["--version"], { encoding: "utf8" });
    if (Number(version.match(/PostgreSQL\) (\d+)/)?.[1]) < 17) {
      throw new Error("PostgreSQL 17+ is required.");
    }
    execFileSync(binary("pg_ctl"), ["--version"], { stdio: "pipe" });
  } catch {
    throw new Error("Database tests need PostgreSQL 17+ binaries on PATH, or TAME_PG_BIN pointing to their bin directory. No existing database is used.");
  }

  const directory = await mkdtemp(join(tmpdir(), "tame-db-test-"));
  const data = join(directory, "data");
  const log = join(directory, "postgres.log");
  const port = await availablePort();
  let started = false;

  const stop = async () => {
    if (started) {
      execFileSync(binary("pg_ctl"), ["stop", "-D", data, "-m", "immediate", "-w", "-t", "15"], { stdio: "pipe" });
      started = false;
    }
    await rm(directory, { recursive: true, force: true });
  };

  try {
    execFileSync(binary("initdb"), ["-D", data, "--encoding=UTF8", "--no-locale", "--auth=trust"], { stdio: "pipe" });
    // Test data is disposable and the server only binds to loopback
    execFileSync(binary("pg_ctl"), [
      "start", "-D", data, "-l", log, "-w", "-t", "15", "-o",
      `-h 127.0.0.1 -p ${port} -F -c synchronous_commit=off -c full_page_writes=off`,
    ], { stdio: "pipe" });
    started = true;
    return {
      connection: { host: "127.0.0.1", port, user: userInfo().username, database: "postgres" },
      stop,
    };
  } catch (error) {
    const details = await readFile(log, "utf8").catch(() => "");
    // A start command can time out after spawning the server
    try {
      execFileSync(binary("pg_ctl"), ["stop", "-D", data, "-m", "immediate", "-w", "-t", "15"], { stdio: "pipe" });
    } catch {}
    await rm(directory, { recursive: true, force: true });
    throw new Error(`Could not start isolated PostgreSQL. ${details}`, { cause: error });
  }
}
