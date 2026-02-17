import mongoose from "mongoose";

/**
 * Connect to MongoDB using the provided URI.
 * Configures connection pool and event listeners for status logging.
 */
export async function connectDatabase(uri: string): Promise<typeof mongoose> {
  mongoose.connection.on("connected", () => {
    console.log("[db] MongoDB connected successfully");
  });

  mongoose.connection.on("error", (err) => {
    console.error("[db] MongoDB connection error:", err);
  });

  mongoose.connection.on("disconnected", () => {
    console.log("[db] MongoDB disconnected");
  });

  console.log("[db] Connecting to MongoDB...");

  const connection = await mongoose.connect(uri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  return connection;
}

/**
 * Gracefully disconnect from MongoDB.
 */
export async function disconnectDatabase(): Promise<void> {
  console.log("[db] Disconnecting from MongoDB...");
  await mongoose.disconnect();
}
