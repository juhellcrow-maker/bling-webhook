import express from "express";
import axios from "axios";
import fs from "fs";
import REGRAS_ML_MATRIZ from "./regras_ml_matriz.js";

const app = express();
app.use(express.json());

/* ======================================================
   🔐 CONFIGURAÇÕES (USE ENV NO RENDER)
====================================================== */
let ACCESS_TOKEN = process.env.ACCESS_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SECRET_KEY = process.env.SECRET_KEY;

/* ======================================================
   ⏳ FUNÇÃO DE DELAY
====================================================== */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ======================================================
   🛡️ REQUEST SEGURO (RATE LIMIT)
====================================================== */
async function safeRequest(fn, tentativas = 2) {
  try {
    return await fn();
  } catch (error) {

    // TOKEN INVÁLIDO → TENTAR ATUALIZAR
    if (
      error.response?.data?.error?.type === "invalid_token" ||
      error.response?.status === 401
    ) {
      console.log("🔄 Token inválido, atualizando...");
      await atualizarToken();
      return fn(); // tenta novamente
    }

    // RATE LIMIT
    if (error.response?.status === 429 && tentativas > 0) {
      console.log("⏳ Limite da API atingido, aguardando...");
      await delay(10000);
      return safeRequest(fn, tentativas - 1);
    }

    throw error;
  }
}

/*============================
CallBack
==========================*/
app.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.status(400).json({ erro: "Code não recebido do Bling" });
    }

    console.log("🔑 Code recebido, trocando por tokens...");

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
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

    const { access_token, refresh_token, expires_in } = response.data;

    // Atualiza tokens em memória
    ACCESS_TOKEN = access_token;
    REFRESH_TOKEN = refresh_token;

    // Salva localmente (opcional, pode remover depois)
    fs.writeFileSync(
      "token.json",
      JSON.stringify({ access_token, refresh_token }, null, 2)
    );

    console.log("✅ Tokens gerados com sucesso");
    console.log("⏳ Expira em (segundos):", expires_in);

    res.json({
      sucesso: true,
      mensagem: "Tokens gerados com sucesso",
      access_token,
      refresh_token
    });

  } catch (error) {
    console.error("❌ Erro no callback:", error.response?.data || error.message);
    res.status(500).json(error.response?.data || error.message);
  }
});


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
   💾 TOKEN LOCAL (OPCIONAL)
====================================================== */
function carregarToken() {
  try {
    const json = JSON.parse(fs.readFileSync("token.json"));
    ACCESS_TOKEN = json.access_token;
    REFRESH_TOKEN = json.refresh_token;
    console.log("🔐 Token carregado do arquivo");
  } catch {
    console.log("⚠️ Nenhum token salvo localmente");
  }
}

function salvarToken(access, refresh) {
  fs.writeFileSync(
    "token.json",
    JSON.stringify({ access_token: access, refresh_token: refresh }, null, 2)
  );
}

/* ======================================================
   🔄 ATUALIZAR TOKEN
====================================================== */
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
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    ACCESS_TOKEN = response.data.access_token;
    REFRESH_TOKEN = response.data.refresh_token;

    salvarToken(ACCESS_TOKEN, REFRESH_TOKEN);
    console.log("🔄 Token atualizado");
  } catch (error) {
    console.error("❌ Erro ao atualizar token:", error.response?.data || error.message);
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
   🚀 PROCESSAR PEDIDOS
====================================================== */
async function processarPedidos() {
  try {
    console.log("🔄 Processando pedidos...");

    const response = await safeRequest(() =>
      axios.get(
        "https://api.bling.com.br/Api/v3/pedidos/vendas?situacao=6&pagina=1&limite=10",
        { headers: getHeaders() }
      )
    );

    const pedidos = response.data.data || [];
    console.log("📦 Pedidos encontrados:", pedidos.length);

    for (const pedido of pedidos) {
      await delay(1500);

      const detalhe = await safeRequest(() =>
        axios.get(
          `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}`,
          { headers: getHeaders() }
        )
      );

      const pedidoCompleto = detalhe.data.data;
      const regra = encontrarRegra(pedidoCompleto);

      if (regra) {
        console.log(`✅ Regra aplicada: ${regra.nome} | Pedido ${pedidoCompleto.id}`);
        // aqui você pode aplicar ações futuras
      }
    }
  } catch (error) {
    console.error("❌ Erro geral:", error.response?.data || error.message);
  }
}

/* ======================================================
   🔐 MIDDLEWARE DE PROTEÇÃO
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
carregarToken();
setInterval(processarPedidos, 5 * 60 * 1000); // 5 minutos
setInterval(atualizarToken, 30 * 60 * 1000); // 30 minutos

/* ======================================================
   🚀 SERVIDOR
====================================================== */
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Servidor rodando");
});
