const request = require("supertest");
const { ObjectId } = require("mongodb");

// Dashboard login uses bcryptjs.compare()
jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
}));

jest.mock("../../config/redis", () => ({
  initRedis: jest.fn(),
  getRedis: jest.fn(() => null),
}));

jest.mock("../../config/db", () => {
  const { ObjectId } = require("mongodb");

  const mockAdminId = new ObjectId("507f1f77bcf86cd799439010");
  const mockAdmin = {
    _id: mockAdminId,
    name: "Admin",
    email: "admin@mineralbridge.com",
    role: "ceo",
    status: "Active",
    passwordHash: "hashed-demo123",
  };

  return {
    connectDB: jest.fn(),
    getDB: jest.fn(() => ({
      collection: jest.fn((name) => {
        if (name === "admin_users") {
          return {
            findOne: jest.fn(async (query) => {
              if (query && query.email === "admin@mineralbridge.com") return mockAdmin;
              return null;
            }),
          };
        }
        return {
          findOne: jest.fn(async () => null),
        };
      }),
    })),
  };
});

process.env.JWT_SECRET = process.env.JWT_SECRET || "dev-insecure-secret-please-change";
process.env.DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || "test-dashboard-secret";

const bcrypt = require("bcryptjs");
const app = require("../../app");

describe("Dashboard Auth API", () => {
  describe("POST /api/dashboard/login", () => {
    it("returns 403 for invalid dashboard key", async () => {
      bcrypt.compare.mockResolvedValue(true);

      const res = await request(app)
        .post("/api/dashboard/login")
        .set("x-dashboard-key", "wrong-key")
        .send({ email: "admin@mineralbridge.com", password: "demo123" });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 400 when email/password missing", async () => {
      bcrypt.compare.mockResolvedValue(true);

      const res = await request(app)
        .post("/api/dashboard/login")
        .set("x-dashboard-key", process.env.DASHBOARD_SECRET)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 401 when password is wrong", async () => {
      bcrypt.compare.mockResolvedValue(false);

      const res = await request(app)
        .post("/api/dashboard/login")
        .set("x-dashboard-key", process.env.DASHBOARD_SECRET)
        .send({ email: "admin@mineralbridge.com", password: "badpass" });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 200 with token and admin payload on success", async () => {
      bcrypt.compare.mockResolvedValue(true);

      const res = await request(app)
        .post("/api/dashboard/login")
        .set("x-dashboard-key", process.env.DASHBOARD_SECRET)
        .send({ email: "admin@mineralbridge.com", password: "demo123" });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("token");
      expect(res.body).toHaveProperty("admin");
      expect(res.body.admin).toMatchObject({
        email: "admin@mineralbridge.com",
        role: "ceo",
      });
    });
  });
});

