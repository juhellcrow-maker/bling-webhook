app.get("/processar-pedidos", async (req, res) => {
  try {
    console.log("Iniciando processamento de pedidos...");

    const pedidosResponse = await axios.get(
      "https://api.bling.com.br/Api/v3/pedidos/vendas",
      {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      }
    );

    const pedidos = pedidosResponse.data.data;

    for (const pedido of pedidos) {
      const pedidoId = pedido.id;

      console.log("Processando pedido:", pedidoId);

      const detalhe = await axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidoId}`,
        {
          headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
        }
      );

      const itens = detalhe.data.data.itens;

      // 🔥 Aqui você vai colocar a lógica de estoque depois

      console.log("Itens:", itens);
    }

    res.json({ status: "processamento finalizado" });

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ erro: "falha no processamento" });
  }
});
