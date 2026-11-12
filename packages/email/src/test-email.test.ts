import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSmtpConfigProvider } from "./smtp-config";
import { sendTestEmail, verifySmtpConnection } from "./test-email";

// A loopback-only SMTP sink that answers every command with `replies`.
async function relay(replies: Record<string, string>) {
  const sockets = new Set<Socket>();
  const subjects: string[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.write("220 localhost test relay\r\n");
    let pending = "";
    let inData = false;
    socket.on("data", (chunk) => {
      pending += chunk.toString();
      let end = pending.indexOf("\r\n");
      while (end >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (inData) {
          if (line.startsWith("Subject:")) subjects.push(line);
          if (line === ".") {
            inData = false;
            socket.write("250 accepted\r\n");
          }
        } else {
          const verb = line.split(" ")[0] ?? "";
          if (verb === "EHLO")
            socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
          else if (verb === "DATA") {
            inData = true;
            socket.write("354 go\r\n");
          } else if (verb === "QUIT") socket.end("221 bye\r\n");
          else socket.write(replies[verb] ?? "250 OK\r\n");
        }
        end = pending.indexOf("\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return {
    port: address.port,
    subjects,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function useRelay(port: number) {
  setSmtpConfigProvider(() => ({
    host: "127.0.0.1",
    port,
    security: "none",
    user: "test-user",
    password: "test-password",
    from: "Margaya <no-reply@example.test>",
  }));
}

afterEach(() => setSmtpConfigProvider(null));

describe("sendTestEmail", () => {
  it("sends a short message with the instance name", async () => {
    const sink = await relay({ AUTH: "235 ok\r\n" });
    useRelay(sink.port);
    try {
      await expect(
        sendTestEmail("admin@example.test", { instanceName: "Acme" }),
      ).resolves.toEqual({
        sent: true,
        code: "ok",
        message: "The test email was sent.",
      });
      expect(sink.subjects).toEqual(["Subject: Test email from Acme"]);
    } finally {
      await sink.close();
    }
  });

  it("sends the copy in the given locale", async () => {
    const sink = await relay({ AUTH: "235 ok\r\n" });
    useRelay(sink.port);
    try {
      const result = await sendTestEmail("admin@example.test", {
        instanceName: "Acme",
        locale: "de-DE",
      });
      expect(result.sent).toBe(true);
      expect(sink.subjects).toEqual(["Subject: Test-E-Mail von Acme"]);
    } finally {
      await sink.close();
    }
  });

  it("classifies a rejected login without echoing it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sink = await relay({ AUTH: "535 5.7.8 bad credentials\r\n" });
    useRelay(sink.port);
    try {
      const result = await sendTestEmail("admin@example.test", {
        instanceName: "Acme",
      });
      expect(result.code).toBe("auth");
      expect(result.message).not.toContain("bad credentials");
    } finally {
      await sink.close();
    }
  });

  it("classifies a refused sender", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sink = await relay({
      AUTH: "235 ok\r\n",
      MAIL: "553 sender not allowed\r\n",
    });
    useRelay(sink.port);
    try {
      const result = await sendTestEmail("admin@example.test", {
        instanceName: "Acme",
      });
      expect(result.code).toBe("sender");
    } finally {
      await sink.close();
    }
  });

  it("reports an unset configuration without connecting", async () => {
    setSmtpConfigProvider(() => null);
    const result = await sendTestEmail("a@example.test", {
      instanceName: "Acme",
    });
    expect(result).toMatchObject({ sent: false, code: "unknown" });
  });
});

describe("verifySmtpConnection", () => {
  it("signs in without sending a message", async () => {
    const sink = await relay({ AUTH: "235 ok\r\n" });
    useRelay(sink.port);
    try {
      const result = await verifySmtpConnection();
      expect(result).toMatchObject({ ok: true, code: "ok" });
      expect(sink.subjects).toEqual([]);
    } finally {
      await sink.close();
    }
  });

  it("classifies a rejected login", async () => {
    const sink = await relay({ AUTH: "535 5.7.8 bad credentials\r\n" });
    useRelay(sink.port);
    try {
      await expect(verifySmtpConnection()).resolves.toEqual({
        ok: false,
        code: "auth",
        latencyMs: null,
      });
    } finally {
      await sink.close();
    }
  });

  it("answers null when email is not set up", async () => {
    setSmtpConfigProvider(() => null);
    await expect(verifySmtpConnection()).resolves.toBeNull();
  });
});
