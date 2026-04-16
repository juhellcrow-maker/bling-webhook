import express from "express";
import axios from "axios";
import REGRAS_ML_MATRIZ from "./regras_ml_matriz.js";

const app = express();
app.use(express.json());

/* ======================================================
   🔐 CONFIGURAÇÕES (ENV - RENDER)
====================================================== */
let ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SECRET_KEY = process.env.SECRET_KEY;

/* ======================================================
   ⏳ DELAY
====================================================== */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ======================================================
   🔧 HEADERS
====================================================== */
function getHeaders() {
  return {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    Accept: "application/json"
  };
}

/* ======================================================
   🔄 ATUALIZAR TOKEN
====================================================== */
async function atualizarToken() {
  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", REFRESH_TOKEN);
  params.append("client_id", CLIENT_ID);
  params.append("client_secret", CLIENT_SECRET);

  const response = await axios.post(
    "https://developer.bling.com.br/api/bling/oauth/token",
    params,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  ACCESS_TOKEN = response.data.access_token;
  REFRESH_TOKEN = response.data.refresh_token;

  console.log("🔄 Token atualizado com sucesso");
}

/* ======================================================
   🛡️ SAFE REQUEST
====================================================== */
async function safeRequest(fn, tentativas = 2) {
  try {
    return await fn();
  } catch (error) {
    if (
      error.response?.status === 401 ||
      error.response?.data?.error?.type === "invalid_token"
    ) {
      console.log("🔄 Token inválido, renovando...");
      await atualizarToken();
      return fn();
    }

    if (error.response?.status === 429 && tentativas > 0) {
      console.log("⏳ Rate limit, aguardando...");
      await delay(10000);
      return safeRequest(fn, tentativas - 1);
    }

    throw error;
  }
}

/* ======================================================
   🧠 MOTOR DE REGRAS
====================================================== */
function encontrarRegra(pedido) {
  return REGRAS_ML_MATRIZ.find(regra =>
    regra.lojaId === pedido.loja?.id &&
    regra.statusOrigem === pedido.situacao?.id &&
    regra.unidades.includes(pedido.loja?.unidadeNegocio?.id)
  );
}

/* ======================================================
   🔁 ALTERAR STATUS DO PEDIDO
====================================================== */
async function alterarStatusPedido(pedidoId, numeroPedido, statusDestino) {
  console.log(
    `🔄 Alterando Pedido Nº ${numeroPedido} → Situação ${statusDestino}`
  );

  await safeRequest(() =>
    axios.patch(
      `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidoId}/situacoes/${statusDestino}`,
      null, // body vazio (PATCH não exige payload)
      { headers: getHeaders() }
    )
  );

  console.log(`✅ Pedido Nº ${numeroPedido} atualizado com sucesso`);
}
``
/* ======================================================
   🚀 PROCESSAR PEDIDOS (COM PAGINAÇÃO)
====================================================== */
async function processarPedidos() {
  const response = await safeRequest(() =>
    axios.get(
      "https://api.bling.com.br/Api/v3/pedidos/vendas?situacao=6&pagina=1&limite=10",
      { headers: getHeaders() }
    )
  );

  const pedidos = response.data.data || [];

  for (const pedido of pedidos) {
    const regra = REGRAS_ML_MATRIZ.find(regra =>
      regra.lojaId === pedido.loja?.id &&
      regra.statusOrigem === pedido.situacao?.id &&
      regra.unidades.includes(pedido.loja?.unidadeNegocio?.id)
    );

    if (!regra) continue;

    const detalhe = await safeRequest(() =>
      axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}`,
        { headers: getHeaders() }
      )
    );

    const pedidoCompleto = detalhe.data.data;

    console.log(
      `✅ Pedido Nº ${pedidoCompleto.numero} atende regra ${regra.nome}`
    );

    await alterarStatusPedido(
      pedidoCompleto.id,
      pedidoCompleto.numero,
      regra.statusDestino
    );
  }
}
``

/* ======================================================
   🔐 PROTEÇÃO DE ROTAS
====================================================== */
function auth(req, res, next) {
  if (req.headers.authorization !== SECRET_KEY) {
    return res.status(401).json({ erro: "Não autorizado" });
  }
  next();
}

/* ======================================================
   🌐 ROTAS
====================================================== */
app.get("/processar-pedidos", auth, async (req, res) => {
  await processarPedidos();
  res.json({ ok: true });
});

/* ======================================================
   🤖 AUTOMAÇÃO
====================================================== */
setInterval(processarPedidos, 10 * 60 * 1000);   // 10 minutos
setInterval(atualizarToken, 90 * 60 * 1000);    // 1h30 minutos

/* ======================================================
   🚀 SERVIDOR
====================================================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Servidor rodando");
});
