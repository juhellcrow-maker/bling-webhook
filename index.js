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
let tokenRefreshing = false;
let tokenRefreshPromise = null;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Lojas
const ML_MATRIZ = 204560827;
const AMZ_FILIAL = 205415213;

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
   🔄 TOKEN
====================================================== */
async function atualizarToken() {
  // ✅ Se já está renovando, aguarda
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
    } catch (error) {
      console.error(
        "❌ Falha ao atualizar token:",
        error.response?.data || error.message
      );
      throw error;
    } finally {
      tokenRefreshing = false;
      tokenRefreshPromise = null;
    }
  })();

  await tokenRefreshPromise;
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
   🔁 ALTERAR STATUS
====================================================== */
async function alterarStatusPedido(pedidoId, numeroPedido, statusDestino) {
  console.log(
    `🔄 Alterando Pedido Nº ${numeroPedido} → Situação ${statusDestino}`
  );

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
   ⚙️ PROCESSAR PEDIDO (POR ID – VIA WEBHOOK)
====================================================== */
async function processarPedidoPorId(idPedido) {
  const detalhe = await safeRequest(() =>
    axios.get(
      `https://api.bling.com.br/Api/v3/pedidos/vendas/${idPedido}`,
      { headers: getHeaders() }
    )
  );

  const pedido = detalhe.data.data;

  console.log(
    `🔍 Processando Pedido Nº ${pedido.numero} | Loja ${pedido.loja?.id}`
  );

  // Garantias
  if (pedido.loja?.id !== ML_MATRIZ) return;
  if (pedido.situacao?.id !== 6) return;

  const regra = encontrarRegra(pedido);

  if (!regra) {
    console.log(`⏭ Pedido ${pedido.numero} sem regra aplicável`);
    return;
  }

  console.log(
    `✅ Regra "${regra.nome}" aplicada ao Pedido ${pedido.numero}`
  );

  await alterarStatusPedido(
    pedido.id,
    pedido.numero,
    regra.statusDestino
  );
}

/* ======================================================
   📣 WEBHOOK BLING – PEDIDOS
====================================================== */
app.post("/webhook/bling/pedidos", async (req, res) => {
  try {
    const evento = req.body;

    console.log("📣 Webhook do Bling recebido:");
    console.log(JSON.stringify(evento, null, 2));

    const tipoEvento = evento.event;
    const idPedido = evento.data?.id;
    const numeroPedido = evento.data?.numero;
    const lojaId = evento.data?.loja?.id;
    const situacaoId = evento.data?.situacao?.id;

    console.log(
      `➡️ Evento: ${tipoEvento} | Pedido Nº ${numeroPedido} | Loja ${lojaId} | Status ${situacaoId}`
    );

    // ✅ Mercado Livre Matriz – processamento automático
    if (lojaId === ML_MATRIZ && situacaoId === 6) {
      console.log(
        `🔵 Mercado Livre Matriz | Processando pedido ${numeroPedido}`
      );
      await processarPedidoPorId(idPedido);
    }

    // ✅ Amazon Filial – manual (por enquanto)
    if (lojaId === AMZ_FILIAL) {
      console.log(
        `🟠 Amazon Filial | Pedido ${numeroPedido} recebido (manual)`
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Erro no webhook:", error.message);
    res.sendStatus(500);
  }
});
/* ======================================================
   🧪 DEBUG – BUSCA COMPLETA DE PEDIDO
   Uso exclusivo para análise de dados reais
   NÃO USAR EM AUTOMAÇÕES
====================================================== */
/* ======================================================
   🧪 DEBUG – BUSCAR PEDIDO POR NÚMERO (APENAS PARA INSPEÇÃO)
====================================================== */
app.get("/debug-pedido/:numero", async (req, res) => {
  try {
    const numeroPedido = req.params.numero;

    // 1️⃣ Buscar pedido pelo número
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

    // 2️⃣ Buscar detalhe completo pelo ID
    const detalhe = await safeRequest(() =>
      axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidos[0].id}`,
        { headers: getHeaders() }
      )
    );

    // ✅ Retorna no navegador
    res.json(detalhe.data.data);

    // ✅ Loga também
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
   🤖 AUTOMAÇÃO
====================================================== */
// ✅ Polling desligado definitivamente
// setInterval(processarPedidos, ...);

setInterval(atualizarToken, 90 * 60 * 1000); // 1h30

(async () => {
  try {
    console.log("🔁 Renovando token no startup...");
    await atualizarToken();
  } catch (err) {
    console.error("❌ Erro ao renovar token no startup:", err.message);
  }
})();
/* ======================================================
   🚀 SERVIDOR
====================================================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Servidor rodando");
});
``
