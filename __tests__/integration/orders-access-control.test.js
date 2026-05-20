const request = require("supertest");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

jest.mock("../../config/redis", () => ({
  initRedis: jest.fn(),
  getRedis: jest.fn(() => null),
}));

jest.mock("../../config/db", () => {
  const { ObjectId } = require("mongodb");

  const userId1 = new ObjectId("507f1f77bcf86cd799439011");
  const userId2 = new ObjectId("507f1f77bcf86cd799439012");
  const adminId = new ObjectId("507f1f77bcf86cd799439010");

  const mockUsers = new Map([
    [
      userId1.toString(),
      { _id: userId1, phone: "+233201234567", countryCode: "+233", name: "U1", email: "u1@test.com" },
    ],
    [
      userId2.toString(),
      { _id: userId2, phone: "+233201234568", countryCode: "+233", name: "U2", email: "u2@test.com" },
    ],
  ]);

  const mockAdmin = {
    _id: adminId,
    name: "Admin",
    email: "admin@mineralbridge.com",
    role: "ceo",
    status: "Active",
    passwordHash: "x",
  };

  const sellOrder1Id = new ObjectId("507f1f77bcf86cd799439021");
  const sellOrder2Id = new ObjectId("507f1f77bcf86cd799439022");

  const mockOrders = [
    {
      _id: sellOrder1Id,
      id: sellOrder1Id.toString(),
      orderId: "SO-1",
      userId: userId1.toString(),
      type: "sell",
      status: "Pending",
      mineralName: "Gold",
      quantity: 10,
      amount: 100,
      unit: "kg",
      orderSummary: { total: "101.00" },
      confirmedPrice: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      _id: sellOrder2Id,
      id: sellOrder2Id.toString(),
      orderId: "SO-2",
      userId: userId2.toString(),
      type: "sell",
      status: "Pending",
      mineralName: "Copper",
      quantity: 20,
      amount: 200,
      unit: "kg",
      orderSummary: { total: "202.00" },
      confirmedPrice: null,
      createdAt: new Date("2026-01-02T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    },
  ];

  return {
    connectDB: jest.fn(),
    getDB: jest.fn(() => ({
      collection: jest.fn((name) => {
        if (name === "admin_users") {
          return {
            findOne: jest.fn(async (query) => {
              const idStr = query?._id?.toString?.();
              return idStr === adminId.toString() ? mockAdmin : null;
            }),
          };
        }

        if (name === "users") {
          return {
            findOne: jest.fn(async (query) => {
              const idStr = query?._id?.toString?.();
              return mockUsers.get(idStr) || null;
            }),
          };
        }

        if (name === "orders") {
          return {
            find: jest.fn((filter) => {
              let list = mockOrders.slice();

              if (filter?.type) list = list.filter((o) => o.type === filter.type);
              if (filter?.userId) list = list.filter((o) => o.userId === filter.userId);

              const cursor = {
                sort: jest.fn(() => cursor),
                limit: jest.fn(() => cursor),
                toArray: jest.fn(async () => list),
              };

              return cursor;
            }),
            findOne: jest.fn(async (filter) => {
              const idStr = filter?._id?.toString?.();
              const userIdFilter = filter?.userId;

              return (
                mockOrders.find((o) => {
                  if (o._id.toString() !== idStr) return false;
                  if (userIdFilter && o.userId !== userIdFilter) return false;
                  return true;
                }) || null
              );
            }),
            updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
          };
        }

        return {
          findOne: jest.fn(async () => null),
          find: jest.fn(() => ({ toArray: jest.fn(async () => []) })),
          updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
        };
      }),
    })),
  };
});

process.env.JWT_SECRET = process.env.JWT_SECRET || "dev-insecure-secret-please-change";
process.env.DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || "test-dashboard-secret";

const app = require("../../app");

describe("Orders Access Control", () => {
  const JWT_SECRET = process.env.JWT_SECRET;
  const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET;

  const userId1 = "507f1f77bcf86cd799439011";
  const userId2 = "507f1f77bcf86cd799439012";
  const adminId = "507f1f77bcf86cd799439010";

  const sellOrder1Id = "507f1f77bcf86cd799439021";
  const sellOrder2Id = "507f1f77bcf86cd799439022";

  const userToken1 = jwt.sign({ userId: userId1 }, JWT_SECRET, { expiresIn: "1h" });
  const adminToken = jwt.sign({ adminId, type: "admin", role: "ceo" }, JWT_SECRET, { expiresIn: "1h" });

  it("user token only sees their own orders (type=sell)", async () => {
    const res = await request(app).get(`/api/orders?type=sell`).set("Authorization", `Bearer ${userToken1}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.every((o) => o.userId === userId1)).toBe(true);
    expect(res.body.length).toBe(1);
  });

  it("dashboard admin sees all orders only when all=1", async () => {
    const res = await request(app)
      .get(`/api/orders?type=sell&all=1`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-dashboard-key", DASHBOARD_SECRET);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((o) => o.id)).toEqual(expect.arrayContaining([sellOrder1Id, sellOrder2Id]));
  });

  it("GET /api/orders/:id enforces ownership for non-dashboard users", async () => {
    const res = await request(app)
      .get(`/api/orders/${sellOrder2Id}`)
      .set("Authorization", `Bearer ${userToken1}`);

    expect(res.status).toBe(404);
  });

  it("GET /api/orders/:id allows dashboard admin to fetch any order", async () => {
    const res = await request(app)
      .get(`/api/orders/${sellOrder2Id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-dashboard-key", DASHBOARD_SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("id");
    expect(res.body.id).toBe(sellOrder2Id);
  });
});

