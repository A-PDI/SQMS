/**
 * Malware scanning. Files stay QUARANTINED until a scanner returns a clean verdict.
 *
 * ClamdScanner implements the clamd INSTREAM protocol (see clamd(8)): the command "zINSTREAM\0" is followed by
 * chunks prefixed with a 4-byte big-endian length, terminated by a zero-length chunk. The reply is
 * "stream: OK", "stream: <signature> FOUND" or "<message> ERROR".
 */
import net from "node:net";
import type { Readable } from "node:stream";

export type ScanVerdict = { status: "clean"; engine: string } | { status: "infected"; engine: string; signature: string };

export interface MalwareScanner {
  readonly name: string;
  scan(stream: Readable): Promise<ScanVerdict>;
  ping(): Promise<boolean>;
}

export class ScannerError extends Error {}

export class ClamdScanner implements MalwareScanner {
  readonly name = "clamav";

  constructor(private readonly host: string, private readonly port: number, private readonly timeoutMs: number) {}

  private command(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      socket.setTimeout(this.timeoutMs);
      socket.on("connect", () => socket.write(`z${cmd}\0`));
      socket.on("data", (d) => chunks.push(d));
      socket.on("timeout", () => socket.destroy(new ScannerError("clamd timeout")));
      socket.on("error", reject);
      socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim()));
    });
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.command("PING")) === "PONG";
    } catch {
      return false;
    }
  }

  async version(): Promise<string> {
    return this.command("VERSION");
  }

  scan(stream: Readable): Promise<ScanVerdict> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const response: Buffer[] = [];
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        stream.destroy();
        socket.destroy();
        reject(err);
      };
      socket.setTimeout(this.timeoutMs);
      socket.on("timeout", () => fail(new ScannerError("clamd timeout")));
      socket.on("error", (e) => fail(new ScannerError(`clamd connection error: ${e.message}`)));
      socket.on("data", (d) => response.push(d));
      socket.on("close", () => {
        if (settled) return;
        settled = true;
        const reply = Buffer.concat(response).toString("utf8").replace(/\0/g, "").trim();
        const engine = "clamav";
        if (reply.endsWith("OK") && reply.startsWith("stream:")) return resolve({ status: "clean", engine });
        const found = /^stream:\s*(.+)\s+FOUND$/.exec(reply);
        if (found) return resolve({ status: "infected", engine, signature: found[1] });
        reject(new ScannerError(`clamd returned an error: ${reply || "(empty reply)"}`));
      });
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        stream.on("data", (chunk: Buffer) => {
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length, 0);
          if (!socket.write(Buffer.concat([len, chunk]))) {
            stream.pause();
            socket.once("drain", () => stream.resume());
          }
        });
        stream.on("end", () => socket.write(Buffer.from([0, 0, 0, 0])));
        stream.on("error", (e) => fail(new ScannerError(`source stream error: ${e.message}`)));
      });
    });
  }
}

/** Standard EICAR anti-malware test string (https://www.eicar.org/download-anti-malware-testfile/). */
export const EICAR_TEST_STRING = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/**
 * Deterministic scanner for automated tests where clamd is unavailable. It flags content containing the EICAR test
 * string. Configuration validation forbids this scanner outside NODE_ENV=test.
 */
export class EicarTestScanner implements MalwareScanner {
  readonly name = "eicar-test";

  async ping(): Promise<boolean> {
    return true;
  }

  async scan(stream: Readable): Promise<ScanVerdict> {
    const marker = Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
    let tail = Buffer.alloc(0);
    for await (const chunk of stream) {
      const buf = Buffer.concat([tail, chunk as Buffer]);
      if (buf.includes(marker)) {
        stream.destroy();
        return { status: "infected", engine: this.name, signature: "Eicar-Test-Signature" };
      }
      tail = buf.subarray(Math.max(0, buf.length - marker.length));
    }
    return { status: "clean", engine: this.name };
  }
}
