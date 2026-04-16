import express from "express";
import axios from "axios";
import REGRAS_ML_MATRIZ from "./regras_ml_matriz.js";

const app = express();
app.use(express.json());

/* ======================================================
   🔐 CONFIGURAÇÕES (ENV)
====================================================== */
let ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Lojas
const ML_MATRIZ = 204560827;
const AMZ_FILIAL = 205415213;

/* ======================================================
   🔄 CONTROLE DE TOKEN (LOCK GLOBAL)
====================================================== */
let tokenRefreshing = false;
let tokenRefreshPromise = null;

/* ======================================================
   ⏳ UTIL
====================================================== */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getHeaders() {
  return {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    Accept: "application/json"
  };
}

/* ======================================================
   🔄 ATUALIZAR TOKEN (COM LOCK)
====================================================== */
async function atualizarToken() {
  if (tokenRefreshing && tokenRefreshPromise) {
    console.log("⏳ Aguardando refresh de token em andamento...");
    await tokenRefreshPromise;
    return;
  }

  tokenRefreshing = true;

  tokenRefreshPromise = (async () => {
    try {
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

      console.log("✅ Token atualizado com sucesso");
    } catch (err) {
      console.error("❌ Falha ao atualizar token:", err.response?.data || err.message);
      throw err;
    } finally {
      tokenRefreshing = false;
      tokenRefreshPromise = null;
    }
  })();

  await tokenRefreshPromise;
}

/* ======================================================
   🛡️ REQUEST SEGURO (RETRY + RATE LIMIT)
====================================================== */
async function safeRequest(fn, tentativas = 3) {
  try {
    return await fn();
  } catch (error) {

    // 🔄 TOKEN INVÁLIDO OU TRANSITÓRIO
    if (
      error.response?.status === 401 ||
      error.response?.data?.error?.type === "invalid_token"
    ) {
      if (tentativas <= 0) throw error;

      console.log("🔄 Token inválido, tentando renovar...");
      await atualizarToken();

      return safeRequest(fn, tentativas - 1);
    }

    // ⏳ RATE LIMIT
    if (error.response?.status === 429 && tentativas > 0) {
      console.log("⏳ Rate limit atingido, aguardando...");
      await delay(10000);
      return safeRequest(fn, tentativas - 1);
    }

    throw error;
  }
}

/* ======================================================
   🧠 MOTOR DE REGRAS (ML MATRIZ)
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
  console.log(`🔄 Alterando Pedido Nº ${numeroPedido} → Situação ${statusDestino}`);

  await safeRequest(() =>
    axios.patch(
      `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidoId}/situacoes/${statusDestino}`,
      null,
      { headers: getHeaders() }
    )
  );

  console.log(`✅ Pedido Nº ${numeroPedido} atualizado com sucesso`);
}

/* ======================================================
   ⚙️ PROCESSAR PEDIDO (INDIVIDUAL)
====================================================== */
async function processarPedidoPorId(idPedido) {
  const detalhe = await safeRequest(() =>
    axios.get(
      `https://api.bling.com.br/Api/v3/pedidos/vendas/${idPedido}`,
      { headers: getHeaders() }
    )
  );

  const pedido = detalhe.data.data;

  console.log(`🔍 Processando Pedido Nº ${pedido.numero} | Loja ${pedido.loja?.id}`);

  if (pedido.loja?.id !== ML_MATRIZ) return;
  if (pedido.situacao?.id !== 6) return;

  const regra = encontrarRegra(pedido);

  if (!regra) {
    console.log(`⏭ Pedido ${pedido.numero} sem regra aplicável`);
    return;
  }

  console.log(`✅ Regra "${regra.nome}" aplicada ao Pedido ${pedido.numero}`);

  await alterarStatusPedido(
    pedido.id,
    pedido.numero,
    regra.statusDestino
  );
}

/* ======================================================
   📦 FILA DE PROCESSAMENTO (ANTI CONCORRÊNCIA)
====================================================== */
const filaPedidos = [];
let processandoFila = false;

async function processarFila() {
  if (processandoFila) return;

  processandoFila = true;

  while (filaPedidos.length > 0) {
    const idPedido = filaPedidos.shift();

    try {
      await processarPedidoPorId(idPedido);
    } catch (err) {
      console.error("❌ Erro ao processar pedido da fila:", err.message);
    }

    // ✅ delay para respeitar rate limit do Bling
    await delay(800);
  }

  processandoFila = false;
}

/* ======================================================
   📣 WEBHOOK BLING – PEDIDOS
====================================================== */
app.post("/webhook/bling/pedidos", async (req, res) => {
  try {
    const evento = req.body;

    const tipoEvento = evento.event;
    const idPedido = evento.data?.id;
    const numeroPedido = evento.data?.numero;
    const lojaId = evento.data?.loja?.id;
    const situacaoId = evento.data?.situacao?.id;

    console.log(
      `➡️ Evento: ${tipoEvento} | Pedido Nº ${numeroPedido} | Loja ${lojaId} | Status ${situacaoId}`
    );

    if (lojaId === ML_MATRIZ && situacaoId === 6) {
      if (!filaPedidos.includes(idPedido)) {
        filaPedidos.push(idPedido);
        console.log(`📥 Pedido ${numeroPedido} enfileirado`);
      }
      processarFila();
    }

    if (lojaId === AMZ_FILIAL) {
      console.log(`🟠 Amazon Filial | Pedido ${numeroPedido} (manual)`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Erro no webhook:", error.message);
    res.sendStatus(500);
  }
});

/* ======================================================
   🧪 DEBUG – BUSCA COMPLETA DE PEDIDO (POR NÚMERO BLING)
====================================================== */
app.get("/debug-pedido/:numero", async (req, res) => {
  try {
    const numeroPedido = req.params.numero;

    const resumo = await safeRequest(() =>
      axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas?numero=${numeroPedido}`,
        { headers: getHeaders() }
      )
    );

    const pedidos = resumo.data.data || [];

    if (!pedidos.length) {
      return res.status(404).json({
        erro: `Pedido ${numeroPedido} não encontrado`
      });
    }

    const detalhe = await safeRequest(() =>
      axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidos[0].id}`,
        { headers: getHeaders() }
      )
    );

    res.json(detalhe.data.data);

    console.log(
      "🧾 DEBUG Pedido completo:",
      JSON.stringify(detalhe.data.data, null, 2)
    );

  } catch (error) {
    console.error("❌ Erro no debug-pedido:", error.message);
    res.status(500).json({ erro: error.message });
  }
});

/* ======================================================
   🚀 STARTUP
====================================================== */
(async () => {
  try {
    console.log("🔁 Renovando token no startup...");
    await atualizarToken();
  } catch (err) {
    console.error("❌ Erro ao renovar token no startup:", err.message);
  }
})();

setInterval(atualizarToken, 90 * 60 * 1000); // 1h30

app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Servidor rodando");
});
``
