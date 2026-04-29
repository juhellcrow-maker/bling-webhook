import { Router } from "express";
import axios from "axios";
import { executarNaFilaBling, safeRequest, getHeaders } from "../services/bling.service.js";

const router = Router();

router.get("/listarDepositos", async (req, res) => {
  try {
    let pagina = 1;
    let totalPaginas = 1;
    const depositos = [];

    do {
      const resp = await executarNaFilaBling(() =>
        safeRequest(() =>
          axios.get("https://api.bling.com.br/Api/v3/depositos", {
            headers: getHeaders(),
            params: { pagina, limite: 100, situacao: 1 }
          })
        )
      );

      depositos.push(...(resp.data.data || []));
      totalPaginas = resp.data.pagination?.totalPages || 1;
      pagina++;
    } while (pagina <= totalPaginas);

    res.json(depositos.map(d => ({
      id: d.id,
      descricao: d.descricao
    })));
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

export default router;
