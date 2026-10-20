import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export const getDb = (databaseUrl: string) => drizzle(neon(databaseUrl), { schema });
export type Db = ReturnType<typeof getDb>;
