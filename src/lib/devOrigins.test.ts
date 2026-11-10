import { parseDevOrigins } from "./devOrigins";

describe("parseDevOrigins", () => {
  it("returns an empty list when unset or blank", () => {
    expect(parseDevOrigins(undefined)).toEqual([]);
    expect(parseDevOrigins("")).toEqual([]);
    expect(parseDevOrigins(" , ,")).toEqual([]);
  });

  it("splits a comma-separated list and trims whitespace", () => {
    expect(parseDevOrigins(" 192.168.1.20 , my-pc.local ")).toEqual([
      "192.168.1.20",
      "my-pc.local",
    ]);
  });

  it("strips schemes, ports and paths down to the hostname", () => {
    expect(
      parseDevOrigins(
        "http://192.168.1.20:3000/dev/viewer,https://my-pc.local",
      ),
    ).toEqual(["192.168.1.20", "my-pc.local"]);
  });

  it("keeps the leading wildcard Next.js supports", () => {
    expect(parseDevOrigins("*.ngrok-free.app")).toEqual(["*.ngrok-free.app"]);
  });

  it("drops duplicates and unparseable entries", () => {
    expect(parseDevOrigins("a.local,a.local,http://")).toEqual(["a.local"]);
  });
});
