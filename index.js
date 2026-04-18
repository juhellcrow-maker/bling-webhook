import express from "express";
import axios from "axios";
import REGRAS_ML_MATRIZ from "./regras_ml_matriz.js";

const app = express();
app.use(express.json());

/* ================= CONFIG ================= */
const ML_MATRIZ = 204560827;
const WEBHOOK_ATIVO = true;

/* ================= OAUTH ================= */
let ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

/* ================= UTIL ================= */
const delay = ms => new Promise(r => setTimeout(r, ms));
const getHeaders = () => ({
  Authorization: `Bearer ${ACCESS_TOKEN}`,
  Accept: "application/json"
});

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
    const result = await fn();
    resolve(result);
  } catch (e) {
    reject(e);
  } finally {
    await delay(400); // respeita 3 req/s
    processandoFila = false;
    processarFila();
  }
}

/* ================= TOKEN (SOMENTE REATIVO) ================= */
let refreshEmAndamento = false;

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

    console.log("✅ Token renovado após 401");
  } finally {
    refreshEmAndamento = false;
  }
}

/* ================= SafeRequest ================= */
async function safeRequest(fn, retry = false) {
  try {
    return await fn();
  } catch (err) {
    if (err.response?.status === 401 && !retry) {
      console.warn("⚠️ 401 detectado, renovando token...");
      await renovarToken();
      return safeRequest(fn, true);
    }
    throw err;
  }
}

/* ================= REGRAS ================= */
function encontrarRegra(pedido) {
  return REGRAS_ML_MATRIZ.find(r =>
    r.lojaId === pedido.loja.id &&
    r.unidadeNegocioId === pedido.loja.unidadeNegocio.id &&
    r.statusOrigem === pedido.situacao.id
  );
}

/* ================= STATUS ================= */
async function alterarStatusPedido(pedido, statusDestino) {
  const url = `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}/situacoes/${statusDestino}`;

  console.log(
    `🚦 ALTERAR STATUS → Pedido ${pedido.numero} | ${pedido.situacao.id} → ${statusDestino}`
  );

  const r = await executarNaFilaBling(() =>
    safeRequest(() =>
      axios.patch(url, null, { headers: getHeaders() })
    )
  );

  console.log(`✅ Status alterado | HTTP ${r.status}`);
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
  console.log(`🔍 Pedido ${pedido.numero} | Status ${pedido.situacao.id}`);

  if (pedido.loja.id !== ML_MATRIZ) return;
  if (pedido.situacao.id !== 6) return;

  const regra = encontrarRegra(pedido);
  if (!regra) return;

  await alterarStatusPedido(pedido, regra.statusDestino);
}

/* ================= WEBHOOK ================= */
app.post("/webhook", async (req, res) => {
  if (!WEBHOOK_ATIVO) return res.status(200).send("Webhook desativado");

  try {
    const idPedido = req.body?.data?.id;
    if (!idPedido) return res.status(200).send("Evento inválido");

    console.log("🔔 Webhook recebido");
    console.log(`📦 Pedido recebido | ID ${idPedido}`);

    await processarPedidoPorId(idPedido);
    res.status(200).send("OK");
  } catch (e) {
    console.error("❌ Erro no webhook:", e.message);
    res.status(200).send("Erro tratado");
  }
});

/* ================= DEBUG ================= */
app.get("/debug-pedido/:numero", async (req, res) => {
  try {
    const numero = req.params.numero;

    const busca = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.get(
          `https://api.bling.com.br/Api/v3/pedidos/vendas?numero=${numero}`,
          { headers: getHeaders() }
        )
      )
    );

    if (!busca.data.data?.length)
      return res.status(404).json({ erro: "Pedido não encontrado" });

    const id = busca.data.data[0].id;

    const detalhe = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.get(
          `https://api.bling.com.br/Api/v3/pedidos/vendas/${id}`,
          { headers: getHeaders() }
        )
      )
    );

    res.json(detalhe.data.data);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

/* ================= START ================= */
app.get("/health", (req, res) => {
  console.log("🏓 Ping automático recebido");
  res.send("OK");
});
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Servidor iniciado");
});
