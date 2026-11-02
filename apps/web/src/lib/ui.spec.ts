import { describe, expect, it } from "vitest";
import { extractLinks } from "@/components/chat/markdown";
import { readPreference, resolveTheme, THEME_STORAGE_KEY } from "./theme";

describe("theme preference", () => {
  it("resolves System from the OS setting and explicit choices as-is", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("reads the remembered choice, defaulting to System for missing, invalid or blocked storage", () => {
    const store = (v: string | null) => ({ getItem: (k: string) => (k === THEME_STORAGE_KEY ? v : null) });
    expect(readPreference(store("dark"))).toBe("dark");
    expect(readPreference(store("light"))).toBe("light");
    expect(readPreference(store(null))).toBe("system");
    expect(readPreference(store("purple"))).toBe("system");
    expect(readPreference({ getItem: () => { throw new Error("blocked"); } })).toBe("system");
    expect(readPreference(null)).toBe("system");
  });
});

describe("answer sources", () => {
  it("lists each cited web host once, ignoring trailing punctuation", () => {
    const links = extractLinks("See https://www.example.com/a, and [docs](https://docs.example.org/x). Also https://example.com/b.");
    expect(links.map((l) => l.host)).toEqual(["example.com", "docs.example.org"]);
    expect(links[0]!.href).toBe("https://www.example.com/a");
  });

  it("returns nothing for answers without links", () => {
    expect(extractLinks("No links here.")).toEqual([]);
  });
});
