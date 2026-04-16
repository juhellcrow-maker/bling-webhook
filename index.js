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
    `🔄 Alterando Pedido Nº ${numeroPedido} → Status ${statusDestino}`
  );

  await safeRequest(() =>
    axios.put(
      `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidoId}/situacao`,
      { situacao: statusDestino },
      { headers: getHeaders() }
    )
  );

  console.log(`✅ Pedido Nº ${numeroPedido} atualizado com sucesso`);
}

/* ======================================================
   🚀 PROCESSAR PEDIDOS (COM PAGINAÇÃO)
====================================================== */
async function processarPedidos() {
  try {
    console.log("🔄 Iniciando processamento de pedidos...");

    let pagina = 1;
    let totalProcessados = 0;

    while (true) {
      const response = await safeRequest(() =>
        axios.get(
          `https://api.bling.com.br/Api/v3/pedidos/vendas?situacao=6&pagina=${pagina}&limite=10`,
          { headers: getHeaders() }
        )
      );

      const pedidos = response.data.data || [];
      if (pedidos.length === 0) break;

      console.log(
        `📄 Página ${pagina} | Pedidos encontrados: ${pedidos.length}`
      );

      for (const pedido of pedidos) {
        await delay(1500);

        const detalhe = await safeRequest(() =>
          axios.get(
            `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}`,
            { headers: getHeaders() }
          )
        );

        const pedidoCompleto = detalhe.data.data;

        console.log(
          `ℹ️ Pedido Nº ${pedidoCompleto.numero} | Status: ${pedidoCompleto.situacao?.id} (${pedidoCompleto.situacao?.descricao})`
        );

        // 🔐 GARANTIA FINAL: SOMENTE STATUS 6
        if (pedidoCompleto.situacao?.id !== 6) {
          console.log(
            `⏭ Pedido Nº ${pedidoCompleto.numero} ignorado (fora do status 6)`
          );
          continue;
        }

        const regra = encontrarRegra(pedidoCompleto);

        if (!regra) {
          console.log(
            `⏭ Pedido Nº ${pedidoCompleto.numero} sem regra aplicável`
          );
          continue;
        }

        console.log(
          `✅ Regra "${regra.nome}" aplicada no Pedido Nº ${pedidoCompleto.numero}`
        );

        await alterarStatusPedido(
          pedidoCompleto.id,
          pedidoCompleto.numero,
          regra.statusDestino
        );

        totalProcessados++;
      }

      pagina++;
    }

    console.log(`🎯 Total de pedidos processados: ${totalProcessados}`);
  } catch (error) {
  console.error("❌ Erro ao alterar status:");

  if (error.response?.data) {
    console.error(JSON.stringify(error.response.data, null, 2));
  } else {
    console.error(error.message);
  }
}
 
}

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
setInterval(processarPedidos, 5 * 60 * 1000);   // 5 minutos
setInterval(atualizarToken, 30 * 60 * 1000);    // 30 minutos

/* ======================================================
   🚀 SERVIDOR
====================================================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Servidor rodando");
});
