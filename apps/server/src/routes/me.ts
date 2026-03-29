import { Hono } from "hono";

const me = new Hono();

// GET /me — return the current user info from Authentik proxy headers
me.get("/", (c) => {
  const username = c.req.header("x-authentik-username") || "";
  const email = c.req.header("x-authentik-email") || "";
  const name = c.req.header("x-authentik-name") || "";

  if (!username) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  return c.json({ username, email, name });
});

export { me };
