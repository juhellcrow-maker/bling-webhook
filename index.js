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
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", "SEU_REFRESH_TOKEN");
    params.append("client_id", "3ce0ca5a754902d36bd3c27fd0be1f49f0790b3c");
    params.append("client_secret", "105e48387b6fb4a2398566768cd529d9a9df30c78ad4161df0454e00879d");

    const response = await axios.post(
      "https://www.bling.com.br/Api/v3/oauth/token",
      params,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
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
