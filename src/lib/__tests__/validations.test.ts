import { describe, it, expect } from "vitest";
import {
  canvasTestSchema,
  pushSubscribeSchema,
  pushTestSchema,
  nudgeTestQuerySchema,
} from "@/lib/validations";

describe("canvasTestSchema", () => {
  it("accepts valid input", () => {
    const result = canvasTestSchema.safeParse({
      token: "3~abc123",
      domain: "canvas.example.edu",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing token", () => {
    const result = canvasTestSchema.safeParse({
      domain: "canvas.example.edu",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty domain", () => {
    const result = canvasTestSchema.safeParse({
      token: "3~abc",
      domain: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("pushSubscribeSchema", () => {
  it("accepts valid input", () => {
    const result = pushSubscribeSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/123",
      p256dh: "p256dh-key-value",
      auth: "auth-key-value",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid endpoint URL", () => {
    const result = pushSubscribeSchema.safeParse({
      endpoint: "not-a-url",
      p256dh: "p256dh-key-value",
      auth: "auth-key-value",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const result = pushSubscribeSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/123",
    });
    expect(result.success).toBe(false);
  });
});

describe("pushTestSchema", () => {
  it("accepts valid endpoint", () => {
    const result = pushTestSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/123",
    });
    expect(result.success).toBe(true);
  });
});

describe("nudgeTestQuerySchema", () => {
  it("accepts valid userId + default type", () => {
    const result = nudgeTestQuerySchema.safeParse({
      userId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("productive_window");
    }
  });

  it("accepts explicit nudge type", () => {
    const result = nudgeTestQuerySchema.safeParse({
      userId: "550e8400-e29b-41d4-a716-446655440000",
      type: "6h",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("6h");
    }
  });

  it("rejects invalid UUID", () => {
    const result = nudgeTestQuerySchema.safeParse({
      userId: "not-a-uuid",
      type: "12h",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid nudge type", () => {
    const result = nudgeTestQuerySchema.safeParse({
      userId: "550e8400-e29b-41d4-a716-446655440000",
      type: "2h",
    });
    expect(result.success).toBe(false);
  });
});
