import { describe, expect, it } from "vitest";
import { formatElapsed } from "@/components/chat/mic-button";
import { micErrorMessage, pickMimeType } from "./recorder";

describe("pickMimeType", () => {
  it("prefers WebM/Opus (verified with Azure), then Ogg/Opus, then Safari's MP4", () => {
    expect(pickMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickMimeType((t) => t.startsWith("audio/ogg"))).toBe("audio/ogg;codecs=opus");
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBeNull();
  });
});

describe("micErrorMessage", () => {
  it("explains permission, hardware and busy-device failures in plain words", () => {
    expect(micErrorMessage(new DOMException("x", "NotAllowedError"))).toMatch(/blocked/);
    expect(micErrorMessage(new DOMException("x", "NotFoundError"))).toMatch(/No microphone/);
    expect(micErrorMessage(new DOMException("x", "NotReadableError"))).toMatch(/in use/);
    expect(micErrorMessage(new Error("weird"))).toMatch(/Couldn't start/);
  });
});

describe("formatElapsed", () => {
  it("formats m:ss", () => {
    expect(formatElapsed(4_200)).toBe("0:04");
    expect(formatElapsed(61_000)).toBe("1:01");
  });
});
