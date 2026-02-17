import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { loadConfig, type AuthPayload } from "@alpharena/shared";
import { UserModel } from "@alpharena/db";
import { authenticate } from "../middleware/auth.js";

/**
 * Zod schema for user registration.
 */
const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers, and underscores"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
  walletAddress: z
    .string()
    .min(1, "Wallet address is required"),
  email: z
    .string()
    .email("Invalid email address")
    .optional(),
});

/**
 * Zod schema for user login.
 */
const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

/**
 * Generate a signed JWT for the given user payload.
 */
function generateToken(payload: AuthPayload): string {
  const config = loadConfig();
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as string & jwt.SignOptions["expiresIn"],
  });
}

/**
 * Strip sensitive fields from a user document for the API response.
 */
function sanitizeUser(user: InstanceType<typeof UserModel>) {
  return {
    id: user._id.toString(),
    username: user.username,
    walletAddress: user.walletAddress,
    email: user.email,
    balance: user.balance,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Auth route plugin.
 *
 * POST /auth/register  - Create a new user account
 * POST /auth/login     - Authenticate and receive a JWT
 * GET  /auth/me        - Get current authenticated user's profile
 */
export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /auth/register
   * Create a new user with hashed password and return a JWT.
   */
  fastify.post(
    "/register",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Validate request body
      const parseResult = registerSchema.safeParse(request.body);
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        return reply.code(400).send({
          error: "Validation Error",
          message: "Invalid registration data",
          details: errors,
        });
      }

      const { username, password, walletAddress, email } = parseResult.data;

      // Check for existing username
      const existingUsername = await UserModel.findOne({ username });
      if (existingUsername) {
        return reply.code(409).send({
          error: "Conflict",
          message: "Username is already taken",
        });
      }

      // Check for existing wallet address
      const existingWallet = await UserModel.findOne({ walletAddress });
      if (existingWallet) {
        return reply.code(409).send({
          error: "Conflict",
          message: "Wallet address is already registered",
        });
      }

      // Check for existing email if provided
      if (email) {
        const existingEmail = await UserModel.findOne({ email });
        if (existingEmail) {
          return reply.code(409).send({
            error: "Conflict",
            message: "Email is already registered",
          });
        }
      }

      // Hash the password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create the user
      const user = await UserModel.create({
        username,
        passwordHash,
        walletAddress,
        email: email ?? null,
        balance: 0,
      });

      // Generate JWT
      const payload: AuthPayload = {
        userId: user._id.toString(),
        username: user.username,
      };
      const token = generateToken(payload);

      fastify.log.info({ userId: user._id, username }, "New user registered");

      return reply.code(201).send({
        token,
        user: sanitizeUser(user),
      });
    },
  );

  /**
   * POST /auth/login
   * Verify credentials and return a JWT.
   */
  fastify.post(
    "/login",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Validate request body
      const parseResult = loginSchema.safeParse(request.body);
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        return reply.code(400).send({
          error: "Validation Error",
          message: "Invalid login data",
          details: errors,
        });
      }

      const { username, password } = parseResult.data;

      // Find user by username
      const user = await UserModel.findOne({ username });
      if (!user) {
        return reply.code(401).send({
          error: "Unauthorized",
          message: "Invalid username or password",
        });
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return reply.code(401).send({
          error: "Unauthorized",
          message: "Invalid username or password",
        });
      }

      // Generate JWT
      const payload: AuthPayload = {
        userId: user._id.toString(),
        username: user.username,
      };
      const token = generateToken(payload);

      fastify.log.info({ userId: user._id, username }, "User logged in");

      return reply.send({
        token,
        user: sanitizeUser(user),
      });
    },
  );

  /**
   * GET /auth/me
   * Return the currently authenticated user's profile.
   */
  fastify.get(
    "/me",
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await UserModel.findById(request.user.userId);
      if (!user) {
        return reply.code(404).send({
          error: "Not Found",
          message: "User not found",
        });
      }

      return reply.send({ user: sanitizeUser(user) });
    },
  );
}
