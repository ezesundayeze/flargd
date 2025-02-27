import { Hono } from "hono";
import { calculatePercentage, evaluate } from "./evaluation";
import { createFlagKey, Flag } from "./flag";

export interface Env {
  FLARGD_STORE: KVNamespace;
}

export interface FlagPayload {
  flagName: string;
  percentage?: number;
}

export interface EvaluationResult {
  evaluation: ReturnType<typeof evaluate>;
  identifier: number | string;
}

const OWNER = "public"; // This should be dynamic

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.json("Hello! Flargd Edge Feature Flags!"));

/** Create and update a flag */
app.post("/apps/:app/flag", async ({ env, req, text, json }) => {
  try {
    // TODO: validate input using zod (it might be better to just do it without zod ATM because it's the only place I need validation for now.)
    const { flagName, percentage } = await req.json<FlagPayload>();
    const { app } = req.param();

    //save flag
    const flagKey = createFlagKey({ prefix: OWNER, flagName, app });
    const date = new Date().toISOString();
    const existingFlag = await env.FLARGD_STORE.get<Flag>(flagKey, "json");

    let flag: Flag;
    if (existingFlag) {
      flag = {
        ...existingFlag,
        percentage: percentage ?? 100,
        updatedAt: date,
      };
    } else {
      flag = {
        name: flagName,
        percentage: percentage ?? 100,
        createdAt: date,
        updatedAt: date,
        app,
        owner: OWNER,
      };
    }

    await env.FLARGD_STORE.put(flagKey, JSON.stringify(flag));
    return json(flag, 201);
  } catch (error) {
    console.error({ error });
    return text("Kaboom!", 500); // Refactor later for better error handler/description
  }
});

app.get(
  "/apps/:app/flags/:flagName",
  async ({ env, req, text, json, notFound }) => {
    const { app, flagName } = req.param();
    const flagKey = createFlagKey({ prefix: OWNER, flagName, app });

    try {
      const flag = await env.FLARGD_STORE.get<Flag>(flagKey, "json");

      if (flag) {
        return json(flag);
      }

      return notFound();
    } catch (error) {
      console.error({ error });

      return text("Kaboom!", 500);
    }
  }
);

app.get(
  "/apps/:app/flags/:flagName/evaluation/:identifier?",
  async ({ env, req, text, json, notFound }) => {
    const { app, flagName, identifier: requestIdentifier } = req.param();
    const flagKey = createFlagKey({ prefix: OWNER, flagName, app });

    try {
      const cacheTtl = 300; // TODO: make this configurable at runtime
      const options: KVNamespaceGetOptions<"json"> = { cacheTtl, type: "json" };
      const flag = await env.FLARGD_STORE.get<Flag>(flagKey, options);

      if (flag) {
        const { identifier, percentage } = await calculatePercentage(
          requestIdentifier
        );
        const evaluation = evaluate(flag, percentage);

        return json<EvaluationResult>({ evaluation, identifier });
      }

      return notFound();
    } catch (error) {
      console.error({ error });

      return text("Kaboom!", 500);
    }
  }
);

export default app;
