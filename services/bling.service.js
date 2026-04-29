// services/bling.service.js
import axios from "axios";
import { loadTokens, saveTokens } from "../tokenStore.js";

let ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
let refreshEmAndamento = false;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// ===== Headers =====
export const getHeaders = () => ({
  Authorization: `Bearer ${ACCESS_TOKEN}`,
  Accept: "application/json"
});

// ===== Fila Bling =====
const filaBling = [];
let processandoFila = false;

export async function executarNaFilaBling(fn) {
  return new Promise((resolve, reject) => {
    filaBling.push({ fn, resolve, reject });
    processarFila();
  });
}

async function processarFila() {
  if (processandoFila || filaBling.length === 0) return;
  processandoFila = true;

  const { fn, resolve, reject } = filaBling.shift();
  try {
    const r = await fn();
    resolve(r);
  } catch (e) {
    reject(e);
  } finally {
    await new Promise(r => setTimeout(r, 400));
    processandoFila = false;
    processarFila();
  }
}

// ===== Token =====
export async function renovarToken() {
  if (refreshEmAndamento) return;
  refreshEmAndamento = true;

  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    });

    const r = await axios.post(
      "https://developer.bling.com.br/api/bling/oauth/token",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    ACCESS_TOKEN = r.data.access_token;
    REFRESH_TOKEN = r.data.refresh_token;
    saveTokens({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN });

  } finally {
    refreshEmAndamento = false;
  }
}

// ===== Safe request =====
export async function safeRequest(fn, retry = false) {
  try {
    return await fn();
  } catch (err) {
    const status = err.response?.status;

    if (status === 401 && !retry) {
      await renovarToken();
      return safeRequest(fn, true);
    }
    throw err;
  }
}
