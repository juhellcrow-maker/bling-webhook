/**
 * routes/webhook.routes.js
 *
 * Responsabilidade:
 * - Receber webhooks externos
 * - Encaminhar eventos para o motor de regras
 *
 * 👉 ESTE ARQUIVO NÃO POSSUI REGRA DE NEGÓCIO
 */

import { Router } from "express";
import { getOAuthHealth } from "../services/bling.service.js";
import { processarPedidoPorId } from "../services/regras.service.js";

const router = Router();

/* ======================================================
   WEBHOOK BLING – PEDIDO DE VENDA
   ====================================================== */

/**
 * Endpoint chamado pelo Bling sempre que:
 * - Pedido muda de status
 * - Pedido é atualizado
 *
 * Payload esperado:
 * {
 *   data: {
 *     id: <ID do pedido no Bling>
 *   }
 * }
 */
router.post("/webhook", async (req, res) => {
  try {
    // Flag global (caso queira desligar webhook rapidamente)
    const WEBHOOK_ATIVO = true;
    if (!WEBHOOK_ATIVO) {
      return res.status(200).send("Webhook desligado");
    }

    // ✅ AQUI É O MELHOR LUGAR PARA O CHECK DE OAUTH
    const health = getOAuthHealth();

    if (health.status === "error") {
      console.warn(
        "⚠️ OAuth indisponível — webhook ignorado temporariamente",
        health
      );

      // Importante: continuar respondendo 200 para não gerar retry
      return res.status(200).send("OAuth indisponível");
    }

    const idPedido = req.body?.data?.id;

    if (!idPedido) {
      // Webhook sem ID → não há o que processar
      return res.status(200).send("OK");
    }

    console.log("🔔 Webhook Bling recebido | Pedido ID:", idPedido);

    // Encaminha para o motor principal
    await processarPedidoPorId(idPedido);

  } catch (e) {
    console.error("❌ Erro no webhook Bling:", e.message);
  }

  // ⚠️ SEMPRE responde 200 ao Bling
  res.status(200).send("OK");
});
