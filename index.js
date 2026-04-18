import express from "express";
import axios from "axios";
import REGRAS_ML_MATRIZ from "./regras_ml_matriz.js";

const app = express();
app.use(express.json());

/* ================= CONFIG ================= */
const ML_MATRIZ = 204560827;
const AMZ_FILIAL = 205415213;

// ✅ CONTROLE GLOBAL
const WEBHOOK_ATIVO = true;   // <<< MODO PPRODUÇÃO
const pedidosRecentes = new Set();

let ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

/* ================= FILA BLING ================= */
const filaBling = [];
let processandoFilaBling = false;

async function executarNaFilaBling(fn) {
  return new Promise((resolve, reject) => {
    filaBling.push({ fn, resolve, reject });
    processarFilaBling();
  });
}

async function processarFilaBling() {
  if (processandoFilaBling || filaBling.length === 0) return;

  processandoFilaBling = true;
  const { fn, resolve, reject } = filaBling.shift();

  try {
    const resultado = await fn();
    resolve(resultado);
  } catch (err) {
    reject(err);
  } finally {
    // 🔒 respeita limite do Bling (3 req/s)
    await delay(400);
    processandoFilaBling = false;
    processarFilaBling();
  }
}

/* ================= UTIL ================= */
const delay = ms => new Promise(r => setTimeout(r, ms));
const getHeaders = () => ({
  Authorization: `Bearer ${ACCESS_TOKEN}`,
  Accept: "application/json"
});

/* ================= TOKEN ================= */
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
async function safeRequest(fn, tentouRetry = false) {
  try {
    return await fn();
  } catch (error) {

    if (error.response?.status === 401 && !tentouRetry) {
      console.warn("⚠️ 401 detectado, renovando token...");

      await renovarToken();          // ✅ refresh UMA ÚNICA VEZ
      return safeRequest(fn, true);  // ✅ refaz a request
    }

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

  const r = await executarNaFilaBling(() =>
  safeRequest(() =>
    axios.patch(
      url,
      null,
      { headers: getHeaders() }
    )
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
  if (!WEBHOOK_ATIVO) {
    console.log("🔔 Webhook recebido, mas está DESATIVADO");
    return res.status(200).send("Webhook ignorado");
  }

  try {
    const evento = req.body;
    const idPedido = evento?.data?.id;

    console.log("🔔 Webhook recebido");

    if (!idPedido) {
      console.log("⚠️ Webhook sem ID de pedido, ignorando");
      return res.status(200).send("Evento inválido");
    }

    console.log(`📦 Pedido recebido | ID ${idPedido}`);

    await processarPedidoPorId(idPedido);

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Erro no webhook:", err.message);
    // ⚠️ sempre responder 200 para o Bling não reenviar
    res.status(200).send("Erro tratado");
  }
});

/* ================= DEBUG ================= */
app.get("/debug-pedido/:numero", async (req, res) => {
  try {
    const numero = req.params.numero;

    // 1️⃣ Busca pedido pelo número
    const urlBusca = `https://api.bling.com.br/Api/v3/pedidos/vendas?numero=${numero}`;

    const r = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.get(urlBusca, { headers: getHeaders() })
      )
    );

    if (!r.data.data || r.data.data.length === 0) {
      return res.status(404).json({ erro: "Pedido não encontrado" });
    }

    // 2️⃣ Pega o ID do pedido
    const id = r.data.data[0].id;

    // 3️⃣ Busca detalhes do pedido
    const urlDetalhe = `https://api.bling.com.br/Api/v3/pedidos/vendas/${id}`;

    const detalhe = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.get(urlDetalhe, { headers: getHeaders() })
      )
    );

    res.json(detalhe.data.data);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

/* ================= START ================= */
(async () => {
  console.log("✅ Servidor iniciado");
})();

app.listen(process.env.PORT || 3000);
