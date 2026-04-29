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
    // Importante: SEMPRE retornar 200 para o Bling
    // para evitar reenvio infinito
  }

  res.status(200).send("OK");
});

export default router;
