import express from "express";
import axios from "axios";
import fs from "fs";
import REGRAS_ML_MATRIZ from "./regras_ml_matriz.js";

const app = express();
app.use(express.json());

/**
 * 🔐 CONFIG (RECOMENDADO usar ENV no Render depois)
 */
let ACCESS_TOKEN = "b804763144274df39d70887279025d4dd6293047";
let REFRESH_TOKEN = "feae48a9a024a912ff5d3c767b14bf73cdbde104";

const CLIENT_ID = "3ce0ca5a754902d36bd3c27fd0be1f49f0790b3c";
const CLIENT_SECRET = "105e48387b6fb4a2398566768cd529d9a9df30c78ad4161df0454e00879d";

/**
 * 📥 CARREGAR TOKEN
 */
function carregarToken() {
  try {
    const data = fs.readFileSync("token.json");
    const json = JSON.parse(data);

    ACCESS_TOKEN = json.access_token;
    REFRESH_TOKEN = json.refresh_token;

    console.log("🔐 Token carregado");
  } catch {
    console.log("⚠️ Sem token salvo");
  }
}

/**
 * 💾 SALVAR TOKEN
 */
function salvarToken(access, refresh) {
  fs.writeFileSync(
    "token.json",
    JSON.stringify(
      {
        access_token: access,
        refresh_token: refresh
      },
      null,
      2
    )
  );

  console.log("💾 Token salvo");
}

/**
 * 🔧 HEADERS
 */
function getHeaders() {
  return {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    Accept: "application/json"
  };
}

/**
 * 🔄 ATUALIZAR TOKEN
 */
async function atualizarToken() {
  try {
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", REFRESH_TOKEN);
    params.append("client_id", CLIENT_ID);
    params.append("client_secret", CLIENT_SECRET);

    const response = await axios.post(
      "https://developer.bling.com.br/api/bling/oauth/token",
      params,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    ACCESS_TOKEN = response.data.access_token;
    REFRESH_TOKEN = response.data.refresh_token;

    salvarToken(ACCESS_TOKEN, REFRESH_TOKEN);

    console.log("🔄 Token atualizado");

  } catch (error) {
    console.error("❌ Erro ao atualizar token:", error.response?.data || error.message);
  }
}

/**
 * 🧠 MOTOR DE REGRAS
 */
function encontrarRegra(pedido) {
  const lojaId = pedido.loja?.id;
  const unidade = pedido.loja?.unidadeNegocio?.id;
  const status = pedido.situacao?.id;

  return REGRAS_ML_MATRIZ.find(regra =>
    regra.lojaId === lojaId &&
    regra.statusOrigem === status &&
    regra.unidades.includes(unidade)
  );
}

/**
 * 🚀 PROCESSAR PEDIDOS
 */
async function processarPedidos() {
  try {
    const response = await axios.get(
      "https://api.bling.com.br/Api/v3/pedidos/vendas?situacao=6&pagina=1&limite=20",
      { headers: getHeaders() }
    );

    const pedidos = response.data.data || [];

    console.log("🔄 Rodando automação...");
    console.log("TOTAL:", pedidos.length);

    let atualizados = 0;

    for (const pedido of pedidos) {

      // 🔎 BUSCA DETALHE COMPLETO
      const detalhe = await axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}`,
        { headers: getHeaders() }
      );

      const pedidoCompleto = detalhe.data.data;

      console.log({
        id: pedidoCompleto.id,
        lojaId: pedidoCompleto.loja?.id,
        unidade: pedidoCompleto.loja?.unidadeNegocio?.id,
        status: pedidoCompleto.situacao?.id
      });

      const regra = encontrarRegra(pedidoCompleto);

      if (regra) {
        console.log(`✅ ${regra.nome}:`, pedidoCompleto.id);

        await axios.patch(
          `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidoCompleto.id}/situacoes/${regra.statusDestino}`,
          {},
          { headers: getHeaders() }
        );

        atualizados++;
      }
    }

    console.log("🎯 TOTAL ATUALIZADOS:", atualizados);

  } catch (error) {
    console.error("❌ ERRO:", error.response?.data || error.message);

    if (error.response?.status === 401) {
      console.log("🔁 Token expirado...");
      await atualizarToken();
      return processarPedidos();
    }
  }
}

/**
 * 📦 PEDIDOS ABERTOS (DEBUG)
 */
app.get("/pedidos-abertos", async (req, res) => {
  try {
    const response = await axios.get(
      "https://api.bling.com.br/Api/v3/pedidos/vendas?situacao=6&pagina=1&limite=10",
      { headers: getHeaders() }
    );

    const pedidos = response.data.data || [];

    const resultado = [];

    for (const pedido of pedidos) {
      const detalhe = await axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}`,
        { headers: getHeaders() }
      );

      const p = detalhe.data.data;

      resultado.push({
        id: p.id,
        numero: p.numero,
        numeroLoja: p.numeroLoja,
        lojaId: p.loja?.id,
        unidade: p.loja?.unidadeNegocio?.id,
        status: p.situacao?.id
      });
    }

    res.json({ ok: true, pedidos: resultado });

  } catch (error) {
    res.status(500).json({
      erro: true,
      detalhe: error.response?.data || error.message
    });
  }
});

/**
 * 🔧 EXECUÇÃO MANUAL
 */
app.get("/processar-pedidos", async (req, res) => {
  await processarPedidos();
  res.json({ ok: true });
});

/**
 * 🤖 AUTOMAÇÃO
 */
carregarToken();
processarPedidos();
setInterval(processarPedidos, 60000);
setInterval(atualizarToken, 5 * 60 * 60 * 1000);

/**
 * 🚀 SERVIDOR
 */
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Servidor rodando");
});
