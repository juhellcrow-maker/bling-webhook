/**
 * services/confirmacao.service.js
 *
 * Responsabilidade:
 * - Registrar pedidos para confirmação
 * - Persistir dados no banco
 * - Enviar WhatsApp de confirmação
 * - Evitar envio duplicado
 *
 * 👉 ESTE ARQUIVO CONTROLA A CAMADA DE CONFIRMAÇÃO
 */

import { randomUUID } from "crypto";
import { pool } from "../db/db.js";
import {
  enviarWhatsAppConfirmacaoComBotoes
} from "../notificacoes/whatsapp.js";

/* ======================================================
   REGISTRA PEDIDO PARA CONFIRMAÇÃO
   ====================================================== */

/**
 * Registra um pedido no banco e envia WhatsApp
 * somente se atender todas as condições de negócio.
 *
 * @param {object} pedido - Pedido completo do Bling
 */
export async function registrarPedidoConfirmacao(pedido) {
  console.log(
    "📲 Cheguei na confirmação | Pedido",
    pedido.numero,
    "Status",
    pedido.situacao.id
  );

  console.log("📌 Verificando envio de confirmação");

  // ✅ TELEFONE DO DEPÓSITO
  const telefoneDeposito = "5516993105050";

  /* ---------------------------
     CONDIÇÃO 1 — Loja correta
     --------------------------- */
  if (pedido.loja.id !== 204560827) {
    console.log("⛔ Loja diferente, não envia WhatsApp");
    return;
  }

  /* ---------------------------
     CONDIÇÃO 2 — Status correto
     --------------------------- */
  if (pedido.situacao.id !== 462097) {
    console.log("⛔ Status diferente de 462097, não envia WhatsApp");
    return;
  }

  console.log(
    `✅ Pedido elegível para confirmação (Pedido ${pedido.numero})`
  );

  /* ---------------------------
     VERIFICA DUPLICIDADE
     --------------------------- */
  const existe = await pool.query(
    "SELECT 1 FROM pedido_confirmacao WHERE pedido_id = $1",
    [pedido.id]
  );

  const permitirReenvio =
    process.env.WHATSAPP_REENVIAR === "true";

  if (existe.rowCount > 0 && !permitirReenvio) {
    console.log("ℹ️ Pedido já registrado, não reenviar mensagem");
    return;
  }

  if (existe.rowCount > 0 && permitirReenvio) {
    console.log("🔁 Reenvio forçado de WhatsApp habilitado");
  }

  /* ---------------------------
     GERA TOKEN DE CONFIRMAÇÃO
     --------------------------- */
  const tokenConfirmacao = randomUUID();

  /* ---------------------------
     GRAVA NO BANCO
     --------------------------- */
  await pool.query(
    `
      INSERT INTO pedido_confirmacao
      (
        pedido_id,
        numero_pedido,
        marketplace,
        deposito_codigo,
        status_bling,
        token_confirmacao
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      pedido.id,
      pedido.numero,
      "ML",
      "SERVSEG_RP",
      pedido.situacao.id,
      tokenConfirmacao
    ]
  );

  /* ---------------------------
     MONTA TEXTO DOS ITENS
     --------------------------- */
  const textoItens = montarTextoItensSimples(pedido);

  /* ---------------------------
     ENVIA WHATSAPP
     --------------------------- */
  await enviarWhatsAppConfirmacaoComBotoes({
    telefone: telefoneDeposito,
    pedidoNumero: pedido.numero,
    textoItens
  });

  /* ---------------------------
     MARCA COMO ENVIADO
     --------------------------- */
  await pool.query(
    `
      UPDATE pedido_confirmacao
      SET notificacao_enviada = true
      WHERE pedido_id = $1
    `,
    [pedido.id]
  );

  console.log("📲 WhatsApp de confirmação enviado com sucesso");
}

/* ======================================================
   UTIL – TEXTO SIMPLES DOS ITENS
   ====================================================== */

/**
 * Monta texto simples dos itens
 * usado no WhatsApp.
 */
function montarTextoItensSimples(pedido) {
  return pedido.itens
    .map(
      item =>
        `• ${item.codigo} - ${item.descricao}\nQuantidade: ${item.quantidade}`
    )
    .join("\n\n");
}

/* ======================================================
   UTIL – MENSAGEM COMPLETA (RESERVA)
   ====================================================== */

/**
 * Versão completa da mensagem.
 * Atualmente não usada diretamente,
 * mas mantida para futuras evoluções.
 */
function montarMensagemConfirmacao(pedido) {
  const itensTexto = pedido.itens
    .map(
      item =>
        `• Código: ${item.codigo}
${item.descricao}
Quantidade: ${item.quantidade}`
    )
    .join("\n\n");

  return `
📦 *CONFIRMAÇÃO DE PEDIDO – MUNDOSEG ML MATRIZ*
Pedido Nº: *${pedido.numero}*

Itens do pedido:
${itensTexto}

⏳ *Por favor, confirme se todos os itens estão disponíveis para envio.*
Após a confirmação, o pedido será faturado automaticamente.
  `;
}
