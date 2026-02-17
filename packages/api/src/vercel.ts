import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";

let app: FastifyInstance | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (app) return app;

  app = await buildServer({ serverless: true });
  await app.ready();

  return app;
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse & { status: (code: number) => ServerResponse; setHeader: (key: string, value: string) => void; send: (body: string) => void }) {
  const fastify = await getApp();

  const url = req.url || "/";

  const response = await fastify.inject({
    method: req.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD",
    url,
    headers: req.headers as Record<string, string>,
    payload: req.body ? JSON.stringify(req.body) : undefined,
  });

  res.status(response.statusCode);

  const headers = response.headers;
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      res.setHeader(key, value as string);
    }
  }

  res.send(response.body);
}
