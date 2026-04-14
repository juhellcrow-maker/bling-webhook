import express from "express";

const app = express();
app.use(express.json());

app.post("/webhook/bling/pedidos", (req, res) => {
  console.log("Pedido recebido do Bling:");
  console.log(JSON.stringify(req.body, null, 2));

  res.status(200).json({
    status: "ok"
  });
});

app.get("/", (req, res) => {
  res.send("API rodando 🚀");
});

app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});
