/**
 * routes/health.routes.js
 *
 * Responsabilidade:
 * - Monitorar saúde da aplicação
 * - Expor status do OAuth do Bling
 *
 * 👉 ESTE ARQUIVO NÃO ALTERA DADOS
 */

import { Router } from "express";
import { getOAuthHealth } from "../services/bling.service.js";

const router = Router();

/* ======================================================
   HEALTH GERAL DA APLICAÇÃO
   ====================================================== */

/**
 * Endpoint simples para verificar se:
 * - servidor está no ar
 * - processo Node está respondendo
 *
 * Usado por:
 * - Render
 * - Monitoramento externo
 */
router.get("/health", (req, res) => {
  console.log(
    JSON.stringify({
      type: "health",
      status: "ok",
      time: new Date().toISOString()
    })
  );

  res.status(200).json({ status: "ok" });
});

/* ======================================================
   HEALTH DO OAUTH (BLING)
   ====================================================== */

/**
 * Endpoint específico para validar se:
 * - tokens OAuth estão sendo renovados
 * - refresh está funcionando
 *
 * Usa estado interno do bling.service.js
 */
router.get("/health/oauth", (req, res) => {
  const health = getOAuthHealth();

  if (health.status === "ok") {
    return res.status(200).json(health);
  }

  console.warn("⚠️ OAuth possível problema", health);
  return res.status(500).json(health);
});

export default router;
