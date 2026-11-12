import { describe, expect, it, vi } from "vitest";
import { callWithRetry } from "./index";

const boom = (msg: string) => () => Promise.reject(new Error(msg));

describe("callWithRetry", () => {
  it("returns on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(callWithRetry(fn, "t")).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient overload then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('{"error":{"code":503,"message":"high demand"}'))
      .mockResolvedValueOnce("ok");
    await expect(callWithRetry(fn, "t")).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after 3 attempts on persistent transient errors", async () => {
    const fn = vi.fn(boom("429 quota exceeded"));
    await expect(callWithRetry(fn, "t")).rejects.toThrow("quota");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-transient errors", async () => {
    const fn = vi.fn(boom("API key invalid"));
    await expect(callWithRetry(fn, "t")).rejects.toThrow("API key invalid");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("treats network blips as transient", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed: ECONNRESET"))
      .mockResolvedValueOnce("ok");
    await expect(callWithRetry(fn, "t")).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
