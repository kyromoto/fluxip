import { Hono } from "hono";
import { register } from "prom-client";

export const metricsRoute = new Hono();

metricsRoute.get("/metrics", async (c) => {
  const body = await register.metrics();
  return c.text(body, 200, { "Content-Type": register.contentType });
});
