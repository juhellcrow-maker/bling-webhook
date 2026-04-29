/**
 * routes/whatsapp.routes.js
 *
 * Responsabilidade:
 * - Receber webhooks do WhatsApp (Meta)
 * - Verificar endpoint no processo de configuração
 * - Registrar cliques em botões interativos
 *
 * 👉 ESTE ARQUIVO NÃO ALTERA STATUS DE PEDIDOS
 * 👉 NÃO ACESSA BANCO
 * 👉 NÃO CHAMA BLING
 */

import { Router } from "express";

const router = Router();

/* ======================================================
   WEBHOOK WHATSAPP – RECEBIMENTO DE MENSAGENS
   ====================================================== */

/**
 * Endpoint chamado pelo WhatsApp quando:
 * - usuário responde mensagem
 * - usuário clica em botão interativo
 */
router.post("/webhook/whatsapp", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) {
      console.log("ℹ️ Webhook WhatsApp sem mensagem");
      return res.sendStatus(200);
    }

    /* ---------------------------
       Apenas mensagens interativas
       --------------------------- */
    if (message.type !== "interactive") {
      console.log("ℹ️ Mensagem WhatsApp não interativa recebida");
      return res.sendStatus(200);
    }

    const buttonId = message.interactive?.button_reply?.id;

    if (!buttonId) {
      console.log("ℹ️ Mensagem interativa sem button_reply");
      return res.sendStatus(200);
    }

    /* ---------------------------
       LOG DO CLIQUE
       --------------------------- */
    console.log("📲 ===========================");
    console.log("📲 CLIQUE WHATSAPP RECEBIDO");
    console.log("🆔 Button ID:", buttonId);
    console.log("📲 ===========================");

  } catch (e) {
    console.error("❌ Erro no webhook WhatsApp:", e.message);
  }

  // Importante: SEMPRE retornar 200
  res.sendStatus(200);
});

/* ======================================================
   WEBHOOK WHATSAPP – VERIFICAÇÃO DO META
   ====================================================== */

/**
 * Endpoint usado pelo WhatsApp para validar
 * se o webhook pertence ao número configurado.
 */
router.get("/webhook/whatsapp", (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook WhatsApp verificado com sucesso");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Falha na verificação do webhook WhatsApp");
  return res.sendStatus(403);
});

export default router;
