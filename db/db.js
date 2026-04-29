/**
 * src/db/db.js
 *
 * Responsabilidade:
 * - Criar e gerenciar o Pool de conexões com o PostgreSQL
 *
 * 👉 ESTE ARQUIVO NÃO EXECUTA QUERIES
 * 👉 ELE APENAS EXPÕE A CONEXÃO
 *
 * Regras de uso:
 * - Somente SERVICES devem importar o pool
 * - ROUTES nunca devem acessar o banco diretamente
 */

import pkg from "pg";
const { Pool } = pkg;

/* ======================================================
   CONFIGURAÇÃO DO POOL
   ====================================================== */

/**
 * O Pool reutiliza conexões com o banco,
 * evitando overhead de abrir/fechar conexões.
 *
 * A variável DATABASE_URL deve estar definida
 * no ambiente (ex: Render).
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  /**
   * SSL é obrigatório em provedores gerenciados
   * como Render, Heroku, Railway etc.
   *
   * rejectUnauthorized: false
   * → permite certificados gerenciados pelo provedor
   */
  ssl: {
    rejectUnauthorized: false
  }
});

/* ======================================================
   OBSERVAÇÃO IMPORTANTE
   ====================================================== */

/**
 * Este pool é:
 * - singleton (uma instância global)
