import { describe, expect, it } from "vitest";

import { isPublicProviderAddress } from "./transport.js";

describe("Candidate provider address policy", () => {
  it("allows public addresses and rejects local, private, reserved, and documentation ranges", () => {
    expect(isPublicProviderAddress("8.8.8.8")).toBe(true);
    expect(isPublicProviderAddress("2606:4700:4700::1111")).toBe(true);
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.168.1.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "2001:db8::1",
    ]) {
      expect(isPublicProviderAddress(address)).toBe(false);
    }
  });
});
