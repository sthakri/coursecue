import { describe, expect, it } from "vitest";
import { canvasRequest, isPublicAddress } from "@/lib/canvas-request";

describe("Canvas request destination boundary", () => {
  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "100.64.0.1", "172.16.1.1", "192.168.1.1", "0.0.0.0", "224.0.0.1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fd12::1", "fe80::1", "2001:db8::1", "2002:7f00:1::", "not-an-address"])("rejects %s", address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(["8.8.8.8", "104.16.112.71", "2606:4700::1111"])("accepts public address %s", address => expect(isPublicAddress(address)).toBe(true));
  it.each(["http://school.example.edu/", "https://school.example.edu:8080/", "https://user:secret@school.example.edu/"])("rejects unsafe URL %s before opening a socket", async url => {
    await expect(canvasRequest(url, "test-token")).rejects.toThrow("standard HTTPS");
  });
});
