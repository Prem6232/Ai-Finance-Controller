import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ai_finance_controller";

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;

if (!global._mongoClientPromise) {
  client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 2000, // Timeout quickly if DB is not running
  });
  global._mongoClientPromise = client.connect().catch((err) => {
    console.warn("⚠️ MongoDB Connection Failed. Running with local in-memory fallback.", err.message);
    // Keep it as a rejected promise or resolve a mock client
    throw err;
  });
}
clientPromise = global._mongoClientPromise;

export async function getMongoClient(): Promise<MongoClient> {
  if (!clientPromise) {
    throw new Error("MongoDB client is not initialized");
  }
  return clientPromise;
}

// In memory fallback storage if MongoDB is not running
export const inMemoryDB = {
  batches: [] as any[],
  overrides: [] as any[],
};

// Global type declaration for TS
declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}
