import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth";

// Mock the dependencies before importing
vi.mock("../config/env", () => ({
  loadEnv: () => ({
    PORT: 3001,
    DATABASE_URL: "postgres://test",
    REDIS_URL: "redis://test",
    JWT_SECRET: "test-secret",
    CORS_ORIGINS: ["http://localhost:5173"],
  }),
}));

vi.mock("../redis/client", () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

const { requireAdmin } = await import("./auth");

describe("RBAC middleware", () => {
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {};
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    nextFunction = vi.fn();
  });

  describe("requireAdmin", () => {
    it("should return 401 if no user is present", async () => {
      mockRequest.user = undefined;

      await requireAdmin(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "unauthorized",
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should return 403 if user is not an admin", async () => {
      mockRequest.user = {
        id: "user-id",
        email: "user@example.com",
        role: "user",
      };

      await requireAdmin(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: "forbidden" });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should call next if user is an admin", async () => {
      mockRequest.user = {
        id: "admin-id",
        email: "admin@example.com",
        role: "admin",
      };

      await requireAdmin(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(mockResponse.json).not.toHaveBeenCalled();
      expect(nextFunction).toHaveBeenCalled();
    });

    it("should handle different role values correctly", async () => {
      const roles = ["moderator", "owner", "superuser"];

      for (const role of roles) {
        mockRequest.user = {
          id: "user-id",
          email: "user@example.com",
          role,
        };

        await requireAdmin(
          mockRequest as AuthenticatedRequest,
          mockResponse as Response,
          nextFunction,
        );

        expect(mockResponse.status).toHaveBeenCalledWith(403);
        expect(mockResponse.json).toHaveBeenCalledWith({
          error: "forbidden",
        });
      }
    });
  });

  describe("role-based access control", () => {
    it("should ensure role is case-sensitive", async () => {
      mockRequest.user = {
        id: "user-id",
        email: "user@example.com",
        role: "Admin", // Different case
      };

      await requireAdmin(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should not allow empty role", async () => {
      mockRequest.user = {
        id: "user-id",
        email: "user@example.com",
        role: "",
      };

      await requireAdmin(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });
});
