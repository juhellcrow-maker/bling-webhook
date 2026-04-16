import express from "express";
import axios from "axios";
import REGRAS_ML_MATRIZ from "./regras_ml_matriz.js";

const app = express();
app.use(express.json());

/* ======================================================
   🔐 CONFIG (ENV)
====================================================== */
let ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SECRET_KEY = process.env.SECRET_KEY;

const LOJA_MERCADO_LIVRE = 204560827;
const STATUS_DATA_FUTURA = 462967;

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

  console.log("🔄 Token atualizado");
}

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
   🧠 REGRAS
====================================================== */
function encontrarRegra(pedido) {
  return REGRAS_ML_MATRIZ.find(regra =>
    regra.lojaId === pedido.loja?.id &&
    regra.statusOrigem === pedido.situacao?.id &&
    regra.unidades.includes(pedido.loja?.unidadeNegocio?.id)
  );
}

function dataPrevistaMaiorQueDataSaida(pedido) {
  if (!pedido.dataPrevista || !pedido.dataSaida) return false;

  const prevista = new Date(pedido.dataPrevista);
  const saida = new Date(pedido.dataSaida);

  return prevista > saida;
}

/* ======================================================
   🔁 ALTERAR STATUS
====================================================== */
async function alterarStatusPedido(pedidoId, numeroPedido, statusDestino) {
  console.log(
    `🔄 Pedido Nº ${numeroPedido} → Situação ${statusDestino}`
  );

  await safeRequest(() =>
    axios.patch(
      `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidoId}/situacoes/${statusDestino}`,
      null,
      { headers: getHeaders() }
    )
  );

  console.log(`✅ Pedido Nº ${numeroPedido} atualizado`);
}

/* ======================================================
   🚀 PROCESSAR PEDIDOS (ENXUTO)
====================================================== */
async function processarPedidos() {
  try {
    const response = await safeRequest(() =>
      axios.get(
        "https://api.bling.com.br/Api/v3/pedidos/vendas?situacao=6&pagina=1&limite=10",
        { headers: getHeaders() }
      )
    );

    const pedidos = response.data.data || [];
    if (!pedidos.length) return;

    for (const pedido of pedidos) {
      const detalhe = await safeRequest(() =>
        axios.get(
          `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}`,
          { headers: getHeaders() }
        )
      );

      const pedidoCompleto = detalhe.data.data;

      console.log(
        `ℹ️ Pedido Nº ${pedidoCompleto.numero} | Status ${pedidoCompleto.situacao?.id}`
      );

      // ✅ SOMENTE MERCADO LIVRE
      if (pedidoCompleto.loja?.id !== LOJA_MERCADO_LIVRE) continue;
      if (pedidoCompleto.situacao?.id !== 6) continue;

      // ✅ NOVA REGRA: DATA FUTURA
      if (dataPrevistaMaiorQueDataSaida(pedidoCompleto)) {
        console.log(
          `🕒 dataPrevista (${pedidoCompleto.dataPrevista}) > dataSaida (${pedidoCompleto.dataSaida})`
        );

        await alterarStatusPedido(
          pedidoCompleto.id,
          pedidoCompleto.numero,
          STATUS_DATA_FUTURA
        );

        continue; // NÃO aplica outras regras
      }

      // ✅ REGRAS EXISTENTES
      const regra = encontrarRegra(pedidoCompleto);
      if (!regra) continue;

      await alterarStatusPedido(
        pedidoCompleto.id,
        pedidoCompleto.numero,
        regra.statusDestino
      );
    }
  } catch (error) {
    console.error("❌ Erro no processamento:");
    console.error(error.response?.data || error.message);
  }
}

/* ======================================================
   🤖 AUTOMAÇÃO
====================================================== */
setInterval(processarPedidos, 10 * 60 * 1000); // 10 minutos
setInterval(atualizarToken, 60 * 60 * 1000);   // 1 hora

/* ======================================================
   🚀 SERVER
====================================================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Servidor rodando");
});
