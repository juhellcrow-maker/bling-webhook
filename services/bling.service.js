/**
 * services/bling.service.js
 *
 * Responsabilidade:
 * - Autenticação OAuth com o Bling
 * - Manter estado dos tokens em memória
 * - Renovação automática de token
 * - Fila para respeitar rate limit do Bling
 * - Helper de chamada segura (safeRequest)
 *
 * 👉 ESTE ARQUIVO É O CORAÇÃO DA INTEGRAÇÃO COM O BLING
 */

import axios from "axios";
import { loadTokens, saveTokens } from "../tokenStore.js";

/* ======================================================
   OAUTH – ESTADO GLOBAL
   ====================================================== */

// Tokens carregados de ENV ou atualizados via refresh
let ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;

// Estado do refresh (usado para health e controle)
let ultimoRefreshToken = 0;
let ultimoRefreshStatus = "unknown";
let refreshEmAndamento = false;
let tokenInvalido = false;

// Credenciais do app Bling
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

/* ======================================================
   BOOTSTRAP DOS TOKENS (STARTUP)
   ====================================================== */

// Restaura tokens salvos em disco (tokenStore)
const stored = loadTokens();

if (stored) {
  ACCESS_TOKEN = stored.access_token;
  REFRESH_TOKEN = stored.refresh_token;
  console.log("🔐 Tokens restaurados do storage");
}

// Se já existe refresh token, força refresh no startup
// Isso evita usar token expirado na primeira chamada
if (REFRESH_TOKEN) {
  console.log("🔁 Executando refresh inicial no startup");
  renovarToken();
}

/* ======================================================
   HEADERS PADRÃO PARA API DO BLING
   ====================================================== */

export const getHeaders = () => ({
  Authorization: `Bearer ${ACCESS_TOKEN}`,
  Accept: "application/json"
});

/* ======================================================
   FILA DO BLING (RATE LIMIT)
   ====================================================== */

// O Bling não tolera muitas chamadas simultâneas.
// Aqui garantimos:
// - Apenas 1 chamada por vez
// - Delay mínimo entre chamadas

const filaBling = [];
let processandoFila = false;

/**
 * Enfileira qualquer chamada que vá falar com o Bling
 */
export async function executarNaFilaBling(fn) {
  return new Promise((resolve, reject) => {
    filaBling.push({ fn, resolve, reject });
    processarFila();
  });
}

/**
 * Processa a fila respeitando o intervalo mínimo
 */
async function processarFila() {
  if (processandoFila || filaBling.length === 0) return;

  processandoFila = true;
  const { fn, resolve, reject } = filaBling.shift();

  try {
    const resultado = await fn();
    resolve(resultado);
  } catch (e) {
    reject(e);
  } finally {
    // ⏱️ Delay obrigatório para evitar bloqueio do Bling
    await new Promise(r => setTimeout(r, 400));
    processandoFila = false;
    processarFila();
  }
}

/* ======================================================
   RENOVAÇÃO DE TOKEN
   ====================================================== */

/**
 * Renova o access token usando o refresh token.
 * - Atualiza memória
 * - Persiste em disco
 * - Atualiza estado para health check
 */
export async function renovarToken() {
  if (refreshEmAndamento) return;
  refreshEmAndamento = true;

  try {
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", REFRESH_TOKEN);
    params.append("client_id", CLIENT_ID);
    params.append("client_secret", CLIENT_SECRET);

    const r = await axios.post(
      "https://developer.bling.com.br/api/bling/oauth/token",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    ACCESS_TOKEN = r.data.access_token;
    REFRESH_TOKEN = r.data.refresh_token;

    // Persistência CRÍTICA
    saveTokens({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN
    });

    ultimoRefreshToken = Date.now();
    ultimoRefreshStatus = "ok";

    console.log("🔁 Token renovado automaticamente");
  } catch (e) {
    if (e.response?.status === 429) {
      if (tokenInvalido) {
       ultimoRefreshStatus = "error";
       console.error(
         "❌ OAuth bloqueado: token inválido e refresh limitado. " +
         "Processamento suspenso até nova autorização."
       );

       throw new Error("OAUTH_INVALID_TOKEN_RATE_LIMIT");
     }

        console.warn(
          "⚠️ OAuth: rate limit atingido, mas token ainda válido — mantendo token atual"
        );
        return;
      }
    ultimoRefreshStatus = "error";
    console.error(
      "❌ Falha ao renovar token:",
      e.response?.data || e.message
    );
  } finally {
    refreshEmAndamento = false;
  }
}

/* ======================================================
   SAFE REQUEST
   ====================================================== */

/**
 * Executa uma chamada de API do Bling com:
 * - Retry automático em 401
 * - Tratamento de erro inteligente
 * - Ignora erro de estoque já lançado (61 / 66)
 */
export async function safeRequest(fn, retry = false) {
  try {
    return await fn();
  } catch (err) {
    if (err.response) {
      const { status, data, config } = err.response;
      const fields = data?.error?.fields || [];
      
      if (status === 401) {
        tokenInvalido = true;
      }

      const isEstoqueJaLancado =
        config?.url?.includes("/lancar-estoque") &&
        fields.some(f => f.code === 61 || f.code === 66);

      if (!isEstoqueJaLancado) {
        console.error("❌ Erro Bling", status, config?.method, config?.url);
        if (config?.data) console.error("➡️ Payload:", config.data);
        if (data) console.error("➡️ Resposta:", JSON.stringify(data, null, 2));
      } else {
        console.log(
          "ℹ️ Bling informou estoque já lançado (tratado como sucesso lógico)"
        );
      }

      // Token expirado → tenta renovar e repetir
      if (status === 401 && !retry) {
        await renovarToken();
        return safeRequest(fn, true);
      }
    }

    // Erro real → sobe para quem chamou
    throw err;
  }
}

/* ======================================================
   AUTO REFRESH DE TOKEN
   ====================================================== */

// Garante que o token nunca expire em produção
const TOKEN_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutos

setInterval(async () => {
  if (!REFRESH_TOKEN) {
    console.warn("⚠️ Refresh token ausente, não foi possível renovar");
    return;
  }

  console.log("⏳ Renovação automática de token em execução");
  await renovarToken();
}, TOKEN_REFRESH_INTERVAL);

/* ======================================================
   HEALTH CHECK (USADO NA ROTA /health/oauth)
   ====================================================== */

export function getOAuthHealth() {
  const agora = Date.now();
  const MAX_DELAY = 30 * 60 * 1000;

  if (ultimoRefreshToken === 0 && REFRESH_TOKEN) {
    return {
      status: "ok",
      oauth: "starting",
      message: "Servidor recém-iniciado, aguardando primeiro refresh"
    };
  }

  if (
    ultimoRefreshStatus === "ok" &&
    agora - ultimoRefreshToken < MAX_DELAY
  ) {
    return { status: "ok", oauth: "active" };
  }

  return { status: "error", oauth: "stale" };
}

// ✅ Atualiza os tokens em memória após OAuth manual
export function atualizarTokens(accessToken, refreshToken) {
  ACCESS_TOKEN = accessToken;
  REFRESH_TOKEN = refreshToken;

  ultimoRefreshToken = Date.now();
  ultimoRefreshStatus = "ok";
  tokenInvalido = false;
  console.log("🔑 Tokens atualizados em memória via OAuth callback");
}
