import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import dotenv from 'dotenv';

dotenv.config();

// Ensure the connection string exists
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing in .env file');
}

// Use a pooled connection because the workflow relies on database transactions.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Export the Drizzle database instance to be used across the app
export const db = drizzle(pool);