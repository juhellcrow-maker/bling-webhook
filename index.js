import express from "express";
import axios from "axios";
import REGRAS_ML_MATRIZ from "./regras_ml_matriz.js";

const app = express();
app.use(express.json());

/* ================= CONFIG ================= */
const ML_MATRIZ = 204560827;
const AMZ_FILIAL = 205415213;

// ✅ CONTROLE GLOBAL
const WEBHOOK_ATIVO = false;   // <<< MODO MANUTENÇÃO
const pedidosRecentes = new Set();

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

/* ================= TOKEN ================= */
// ✅ REFRESH PROATIVO (NUNCA POR ERRO)
let ultimoRefresh = 0;
const REFRESH_INTERVAL = 5 * 60 * 60 * 1000; // 5h

async function talvezAtualizarToken() {
  if (Date.now() - ultimoRefresh < REFRESH_INTERVAL) return;

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
  ultimoRefresh = Date.now();

  console.log("✅ Token renovado proativamente");
}
/* ================= SafeRequest ================= */
async function safeRequest(fn, tentouRefresh = false) {
  try {
    // tenta garantir token válido antes da chamada
    await talvezAtualizarToken();
    return await fn();

  } catch (error) {

    // 🔒 Fallback ÚNICO para token expirado
    if (
      error.response?.status === 401 &&
      !tentouRefresh
    ) {
      console.warn("⚠️ 401 detectado, forçando refresh único do token");

      // força o próximo refresh
      ultimoRefresh = 0;
      await talvezAtualizarToken();

      // tenta novamente apenas uma vez
      return safeRequest(fn, true);
    }

    // qualquer outro erro sobe
    throw error;
  }
}
/* ================= OAUTH CALLBACK ================= */
app.get("/callback", async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).send("Code não informado");
    }

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("client_id", process.env.CLIENT_ID);
    params.append("client_secret", process.env.CLIENT_SECRET);
    params.append("code", code);
    params.append(
      "redirect_uri",
      "https://bling-webhook.onrender.com/callback"
    );

    const response = await axios.post(
      "https://developer.bling.com.br/api/bling/oauth/token",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token, refresh_token, expires_in } = response.data;

    console.log("✅ NOVOS TOKENS GERADOS VIA CALLBACK");
    console.log("ACCESS_TOKEN:", access_token);
    console.log("REFRESH_TOKEN:", refresh_token);
    console.log("EXPIRES_IN:", expires_in);

    res.json({
      access_token,
      refresh_token,
      expires_in
    });
  } catch (err) {
    console.error("❌ Erro no callback OAuth:", err.response?.data || err.message);
    res.status(500).send("Erro no callback OAuth");
  }
});

/* ================= Teste Processar pedido ================= */
app.post("/teste/alterar-status/:id", async (req, res) => {
  try {
    const id = req.params.id;

    console.log(`🧪 TESTE MANUAL → Processando pedido ${id}`);

    // reaproveita TODA a lógica real
    await processarPedidoPorId(id);

    res.json({
      ok: true,
      mensagem: `Pedido ${id} processado manualmente`
    });
  } catch (err) {
    console.error("❌ Erro no teste manual:", err.message);
    res.status(500).json({ erro: err.message });
  }
});

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
  console.log(
    `🚦 ALTERAR STATUS → Pedido ${pedido.numero} | Unidade ${pedido.loja.unidadeNegocio.id} | ${pedido.situacao.id} → ${statusDestino}`
  );

  const r = await safeRequest(() =>
    axios.patch(
      `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}/situacoes/${statusDestino}`,
      null,
      { headers: getHeaders() }
    )
  );

  console.log(`✅ Status alterado | HTTP ${r.status}`);
}

/* ================= PROCESSO ================= */
async function processarPedidoPorId(id) {
  const r = await safeRequest(() =>
    axios.get(
      `https://api.bling.com.br/Api/v3/pedidos/vendas/${id}`,
      { headers: getHeaders() }
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
app.post("/webhook/bling/pedidos", async (req, res) => {
  if (!WEBHOOK_ATIVO) {
    console.log("⛔ Webhook bloqueado (manutenção)");
    return res.sendStatus(200);
  }

  const { id } = req.body.data;

  if (pedidosRecentes.has(id)) {
    console.log(`⏭ Evento duplicado ignorado (${id})`);
    return res.sendStatus(200);
  }

  pedidosRecentes.add(id);
  setTimeout(() => pedidosRecentes.delete(id), 60000);

  await processarPedidoPorId(id);
  await delay(1100);

  res.sendStatus(200);
});

/* ================= DEBUG ================= */
app.get("/debug-pedido/:numero", async (req, res) => {
  try {
    const numero = req.params.numero;
    const r = await safeRequest(() =>
      axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas?numero=${numero}`,
        { headers: getHeaders() }
      )
    );

    const id = r.data.data[0].id;
    const detalhe = await safeRequest(() =>
      axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas/${id}`,
        { headers: getHeaders() }
      )
    );

    res.json(detalhe.data.data);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

/* ================= START ================= */
(async () => {
  await talvezAtualizarToken();
  console.log("✅ Servidor iniciado");
})();

app.listen(process.env.PORT || 3000);
