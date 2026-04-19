import express from "express";
import axios from "axios";
import { pool } from "./db.js";
import REGRAS from "./regras.js";
import { randomUUID } from "crypto";
import { loadTokens, saveTokens } from "./tokenStore.js";
import { enviarWhatsAppTeste } from "./notificacoes/whatsapp.js";

const app = express();
app.use(express.json());

/* ================= CONFIG ================= */
const WEBHOOK_ATIVO = true;

/* ================= OAUTH – VARIÁVEIS ================= */
let ACCESS_TOKEN = process.env.ACCESS_TOKEN || null;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN || null;
let ultimoRefreshToken = 0;
let ultimoRefreshStatus = "unknown";
let refreshEmAndamento = false;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

/* ================= RESTAURA TOKENS ================= */
const stored = loadTokens();
if (stored) {
  ACCESS_TOKEN = stored.access_token;
  REFRESH_TOKEN = stored.refresh_token;
  console.log("🔐 Tokens restaurados do storage");
}

/* ================= UTIL ================= */
const delay = ms => new Promise(r => setTimeout(r, ms));

const getHeaders = () => ({
  Authorization: `Bearer ${ACCESS_TOKEN}`,
  Accept: "application/json"
});

/* ================= TOKEN (REATIVO + PERSISTÊNCIA) ================= */
async function renovarToken() {
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

    saveTokens({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN
    });

    ultimoRefreshToken = Date.now();
    ultimoRefreshStatus = "ok";

    console.log("🔁 Token renovado automaticamente");
  } catch (e) {
    ultimoRefreshStatus = "error";
    console.error("❌ Falha ao renovar token:", e.response?.data || e.message);
  } finally {
    refreshEmAndamento = false;
  }
}

/* ================= REFRESH INICIAL ================= */
if (REFRESH_TOKEN) {
  console.log("🔁 Executando refresh inicial no startup");
  renovarToken();
}

/* ================= FILA BLING ================= */
const filaBling = [];
let processandoFila = false;

async function executarNaFilaBling(fn) {
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
    await delay(400);
    processandoFila = false;
    processarFila();
  }
}

/* ================= SAFE REQUEST ================= */
async function safeRequest(fn, retry = false) {
  try {
    return await fn();
  } catch (err) {
    if (err.response) {
      const { status } = err.response;
      if (status === 401 && !retry) {
        await renovarToken();
        return safeRequest(fn, true);
      }
    }
    throw err;
  }
}

/* ================= MENSAGEM WHATSAPP ================= */
function montarMensagemPedido(pedido) {
  const itens = pedido.itens
    .map(
      item => `• ${item.produto.nome} — ${item.quantidade} un`
    )
    .join("\n");

  return (
`📦 *NOVO PEDIDO – MERCADO LIVRE*

Pedido: *${pedido.numero}*
Depósito: *Serv-Seg Rio Preto*

Itens:
${itens}

⏳ *Aguardando confirmação de disponibilidade.*
Após a confirmação o pedido será faturado automaticamente.`
  );
}

/* ================= REGISTRA PEDIDO NO BD ================= */
async function registrarPedidoConfirmacao(pedido) {
  if (![204560827, 204964661].includes(pedido.loja.id)) return;
  if (pedido.situacao.id !== 462097) return;

  const pedidoId = pedido.id;

  const existe = await pool.query(
    "SELECT 1 FROM pedido_confirmacao WHERE pedido_id = $1",
    [pedidoId]
  );

  if (existe.rowCount > 0) return;

  const tokenConfirmacao = randomUUID();

  await pool.query(
    `
    INSERT INTO pedido_confirmacao
    (pedido_id, numero_pedido, marketplace, deposito_codigo, status_bling, token_confirmacao)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      pedidoId,
      pedido.numero,
      "ML",
      "SERVSEG_RP",
      462097,
      tokenConfirmacao
    ]
  );

  const mensagem = montarMensagemPedido(pedido);
  const telefoneDeposito = "5516993105050";

  await enviarWhatsAppTeste(telefoneDeposito, mensagem);

  await pool.query(
    "UPDATE pedido_confirmacao SET notificacao_enviada = true WHERE pedido_id = $1",
    [pedidoId]
  );

  console.log(`📲 WhatsApp enviado para o depósito | Pedido ${pedido.numero}`);
}

/* ================= PROCESSO ================= */
async function processarPedidoPorId(id) {
  const r = await executarNaFilaBling(() =>
    safeRequest(() =>
      axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas/${id}`,
        { headers: getHeaders() }
      )
    )
  );

  const pedido = r.data.data;
  await registrarPedidoConfirmacao(pedido);
}

/* ================= CALLBACK ================= */
app.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.status(400).send("Código de autorização não informado");
    }

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("client_id", CLIENT_ID);
    params.append("client_secret", CLIENT_SECRET);
    params.append("redirect_uri", process.env.REDIRECT_URI);

    const r = await axios.post(
      "https://developer.bling.com.br/api/bling/oauth/token",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    ACCESS_TOKEN = r.data.access_token;
    REFRESH_TOKEN = r.data.refresh_token;
    
    saveTokens({
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN
    });


    console.log("✅ OAuth concluído com sucesso");
    res.send("✅ Autorização concluída com sucesso. Pode fechar esta página.");
  } catch (e) {
    console.error("❌ Erro no callback OAuth:", e.response?.data || e.message);
    res.status(500).send("Erro ao processar callback OAuth");
  }
});

/* ================= WEBHOOK ================= */
app.post("/webhook", async (req, res) => {
  if (!WEBHOOK_ATIVO) return res.send("Webhook desligado");
  const idPedido = req.body?.data?.id;
  if (idPedido) await processarPedidoPorId(idPedido);
  res.send("OK");
});

/* ================= HEALTH ================= */
app.get("/health", (_, res) => res.json({ status: "ok" }));

/* ================= TOKEN AUTO-RENEW ================= */
setInterval(async () => {
  if (REFRESH_TOKEN) await renovarToken();
}, 10 * 60 * 1000);

/* ================= START ================= */
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Servidor iniciado");
});
