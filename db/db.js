/**
 * src/db/db.js
 *
 * Responsabilidade:
 * - Criar e exportar o pool de conexões com o PostgreSQL
 *
 * Este arquivo NÃO executa queries.
 * Ele apenas expõe o pool reutilizável.
 */

import pkg from "pg";
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});
