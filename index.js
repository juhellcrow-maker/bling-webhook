import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const ACCESS_TOKEN = "SEU_ACCESS_TOKEN_AQUI";

// ✅ SEU TESTE DO BLING
app.get("/teste-bling", async (req, res) => {
  try {
    const response = await axios.get(
      "https://api.bling.com.br/Api/v3/produtos",
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`
        }
      }
    );

    console.log(response.data);

    res.json({ ok: true });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.json({ erro: true });
  }
});


// 🔥 COLOCA AQUI (NOVO ENDPOINT)
app.get("/gerar-token", async (req, res) => {
  try {
    const response = await axios.post(
      "https://www.bling.com.br/Api/v3/oauth/token",
      null,
      {
        params: {
          grant_type: "refresh_token",
          refresh_token: "SEU_REFRESH_TOKEN",
          client_id: "SEU_CLIENT_ID",
          client_secret: "SEU_CLIENT_SECRET"
        }
      }
    );

    console.log("NOVO TOKEN:");
    console.log(response.data);

    res.json(response.data);

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.json({ erro: "falha ao gerar token" });
  }
});


// ✅ SERVIDOR
app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando");
});
