import { describe, expect, it } from "vitest";
import { eigeneAdresse } from "./adresse";

const kopf = (o: Record<string, string>) => new Headers(o);

describe("eigeneAdresse", () => {
  it("nimmt Host und Protokoll vom Proxy", () => {
    expect(
      eigeneAdresse(
        kopf({
          "x-forwarded-host": "inventar.firma.example",
          "x-forwarded-proto": "https",
          host: "0.0.0.0:3000",
        }),
      ),
    ).toBe("https://inventar.firma.example");
  });
  it("ohne Proxy: Host-Header über http", () => {
    expect(eigeneAdresse(kopf({ host: "localhost:3000" }))).toBe(
      "http://localhost:3000",
    );
  });
  it.each([
    ["ohne Host", {}],
    ["Host mit Pfad", { host: "a.example/pfad" }],
    ["Host mit Zeichen", { host: "a.example@evil" }],
    ["Protokoll", { host: "a.example", "x-forwarded-proto": "javascript" }],
  ])("wirft bei %s", (_n, k) => {
    expect(() => eigeneAdresse(kopf(k))).toThrow();
  });
});
