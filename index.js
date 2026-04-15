import express from "express";
import axios from "axios";


const app = express();
app.use(express.json());

const ACCESS_TOKEN = "b804763144274df39d70887279025d4dd6293047";

app.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.send("Nenhum code recebido");
    }

    console.log("CODE RECEBIDO:", code);

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", "https://bling-webhook.onrender.com/callback");
    params.append("client_id", "3ce0ca5a754902d36bd3c27fd0be1f49f0790b3c");
    params.append("client_secret", "105e48387b6fb4a2398566768cd529d9a9df30c78ad4161df0454e00879d");

    const response = await axios.post(
      "https://developer.bling.com.br/api/bling/oauth/token",
      params,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    console.log("TOKEN:", response.data);

    res.json(response.data);

  } catch (error) {
    console.error("ERRO:", error.response?.data || error.message);
    res.json({ erro: error.response?.data || "falha ao gerar token" });
  }
});
// ✅ SEU TESTE DO BLING
app.get("/teste-bling", async (req, res) => {
  try {
    const response = await axios.get(
      "https://api.bling.com.br/Api/v3/produtos?pagina=1&limite=10",
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          Accept: "application/json"
        }
      }
    );

    return res.json(response.data);

  } catch (error) {
    console.error("STATUS:", error.response?.status);
    console.error("DATA:", error.response?.data);

    return res.status(500).json({
      erro: true,
      status: error.response?.status,
      detalhe: error.response?.data || error.message
    });
  }
});
// ✅ SERVIDOR
app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando");
});
// RefresToken
app.get("/refresh-token", async (req, res) => {
  try {
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", "26d97a62308b5dd91105282a6a134a8513bd9a4c");
    params.append("client_id", "3ce0ca5a754902d36bd3c27fd0be1f49f0790b3c");
    params.append("client_secret", "105e48387b6fb4a2398566768cd529d9a9df30c78ad4161df0454e00879d");

    const response = await axios.post(
      "https://developer.bling.com.br/api/bling/oauth/token",
      params,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.json({ erro: "falha ao atualizar token" });
  }
});
// Consulta Pedidos Bling
app.get("/pedidos-abertos", async (req, res) => {
  try {
    const response = await axios.get(
      "https://api.bling.com.br/Api/v3/pedidos/vendas?situacao=1",
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          Accept: "application/json"
        }
      }
    );

    const pedidos = response.data.data;

    const resultado = pedidos.map(pedido => {
      return {
        id: pedido.id,
        numero: pedido.numero,
        data: pedido.data,
        itens: pedido.itens.map(item => ({
          produto: item.descricao,
          codigo: item.codigo,
          quantidade: item.quantidade,
          valor: item.valor
        }))
      };
    });

    return res.json({
      ok: true,
      total: resultado.length,
      pedidos: resultado
    });

  } catch (error) {
    console.error("ERRO:", error.response?.data || error.message);

    return res.status(500).json({
      erro: true,
      detalhe: error.response?.data || error.message
    });
  }
});
