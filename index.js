import express from "express";
import axios from "axios";
import fs from "fs"; 

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
 * 📥 LER TOKEN
 */
function carregarToken() {
  try {
    const data = fs.readFileSync("token.json");
    const json = JSON.parse(data);

    ACCESS_TOKEN = json.access_token;
    REFRESH_TOKEN = json.refresh_token;

    console.log("🔐 Token carregado do arquivo");

  } catch (err) {
    console.log("⚠️ Nenhum token salvo ainda");
  }
}

/**
 * 💾 SALVAR TOKEN
 */
function salvarToken(access, refresh) {
  const data = {
    access_token: access,
    refresh_token: refresh
  };

  fs.writeFileSync("token.json", JSON.stringify(data, null, 2));

  console.log("💾 Token salvo");
}
/**
 * 🔧 HEADERS PADRÃO
 */
function getHeaders() {
  return {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    Accept: "application/json"
  };
}

/**
 * 🔄 ATUALIZAR TOKEN AUTOMATICAMENTE
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

  console.log("🔄 TOKEN ATUALIZADO E SALVO");;
  
  } catch (error) {
    console.error("❌ ERRO AO ATUALIZAR TOKEN:", error.response?.data || error.message);
  }
}

/**
 * 📦 PEDIDOS EM ABERTO
 */
app.get("/pedidos-abertos", async (req, res) => {
  try {
    const response = await axios.get(
      "https://api.bling.com.br/Api/v3/pedidos/vendas?situacao=6&pagina=1&limite=20",
      { headers: getHeaders() }
    );

    const pedidos = response.data.data || [];

    const resultado = pedidos.map(p => ({
      id: p.id,
      numero: p.numero,
      numeroLoja: p.numeroLoja,
      lojaId: p.loja?.id,
      unidade: p.loja?.unidadeNegocio?.id,
      status: p.situacao?.id
    }));

    return res.json({
      ok: true,
      total: resultado.length,
      pedidos: resultado
    });

  } catch (error) {
    return res.status(500).json({
      erro: true,
      detalhe: error.response?.data || error.message
    });
  }
});

/**
 * 🚀 PROCESSAR PEDIDOS AUTOMATICAMENTE
 */
async function processarPedidos() {
  try {
    const response = await axios.get(
      "https://api.bling.com.br/Api/v3/pedidos/vendas?situacao=6&pagina=1&limite=20",
      { headers: getHeaders() }
    );

    const pedidos = response.data.data || [];

    console.log("🔄 Rodando automação...");
    console.log("TOTAL DE PEDIDOS:", pedidos.length);

    let atualizados = 0;

    for (const pedido of pedidos) {
      const lojaId = pedido.loja?.id;
      const unidade = pedido.loja?.unidadeNegocio?.id;
      const status = pedido.situacao?.id;

      console.log({
        id: pedido.id,
        lojaId,
        unidade,
        status
      });

      if (
        lojaId === 204560827 &&
        unidade === 2557723 &&
        status === 6
      ) {
        console.log("✅ ATUALIZANDO:", pedido.id);

        await axios.patch(
          `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}/situacoes/462966`,
          {},
          { headers: getHeaders() }
        );

        atualizados++;
      }
    }

    console.log("🎯 TOTAL ATUALIZADOS:", atualizados);

  } catch (error) {
    console.error("❌ ERRO NA AUTOMAÇÃO:", error.response?.data || error.message);

    if (error.response?.status === 401) {
      console.log("🔁 TOKEN EXPIRADO, ATUALIZANDO...");

      await atualizarToken();

      console.log("🔄 REPROCESSANDO APÓS TOKEN NOVO...");

      return processarPedidos();
    }
  }
}

/**
 * 🔗 CALLBACK OAUTH
 */
app.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.send("Nenhum code recebido");
    }

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", "https://bling-webhook.onrender.com/callback");
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

    console.log("🔐 TOKEN GERADO:", response.data);

    res.json(response.data);

  } catch (error) {
    console.error("❌ ERRO:", error.response?.data || error.message);
    res.json({ erro: "falha ao gerar token" });
  }
});

/**
 * 🧪 TESTE API BLING
 */
app.get("/teste-bling", async (req, res) => {
  try {
    const response = await axios.get(
      "https://api.bling.com.br/Api/v3/produtos?pagina=1&limite=10",
      { headers: getHeaders() }
    );

    return res.json(response.data);

  } catch (error) {
    return res.status(500).json({
      erro: true,
      detalhe: error.response?.data || error.message
    });
  }
});

/**
 * 🔍 CONSULTAR PEDIDO COMPLETO
 */
app.get("/pedido-debug", async (req, res) => {
  try {
    const idPedido = req.query.id;

    if (!idPedido) {
      return res.json({
        erro: true,
        mensagem: "Use: /pedido-debug?id=123"
      });
    }

    const response = await axios.get(
      `https://api.bling.com.br/Api/v3/pedidos/vendas/${idPedido}`,
      { headers: getHeaders() }
    );

    return res.json(response.data);

  } catch (error) {
    return res.status(500).json({
      erro: true,
      detalhe: error.response?.data || error.message
    });
  }
});

/**
 * 🔧 EXECUÇÃO MANUAL (opcional)
 */
app.get("/processar-pedidos", async (req, res) => {
  await processarPedidos();
  res.json({ ok: true });
});

/**
 * 🤖 AUTOMAÇÃO (RODA SOZINHO)
 */

// roda ao iniciar
processarPedidos();

// roda a cada 1 minuto
setInterval(processarPedidos, 60000);

// tenta renovar token a cada 5 horas
setInterval(atualizarToken, 5 * 60 * 60 * 1000);

/**
 * 🚀 SERVIDOR
 */
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Servidor rodando");
});
