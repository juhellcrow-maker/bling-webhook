import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// 👉 COLOQUE SEU ACCESS TOKEN AQUI
const ACCESS_TOKEN = "SEU_ACCESS_TOKEN_AQUI";

app.get("/teste-bling", async (req, res) => {
  try {
    console.log("Testando API do Bling...");

    const response = await axios.get(
      "https://api.bling.com.br/Api/v3/produtos",
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`
        }
      }
    );

    console.log("Resposta do Bling:");
    console.log(JSON.stringify(response.data, null, 2));

    res.json({ status: "ok" });

  } catch (error) {
    console.error("Erro:");
    console.error(error.response?.data || error.message);

    res.json({ erro: "falha na requisição" });
  }
});

app.get("/", (req, res) => {
  res.send("API rodando 🚀");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando");
});
