import axios from "axios";

export async function enviarWhatsAppTeste(telefone, mensagem) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.warn("⚠️ WhatsApp não configurado no ambiente");
    return;
  }

  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to: telefone,
      type: "text",
      text: {
        body: mensagem
      }
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  console.log("✅ Mensagem WhatsApp enviada com sucesso");
}

export async function enviarWhatsAppConfirmacaoComBotoes({
  telefone,
  pedidoNumero,
  textoItens
}) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.warn("⚠️ WhatsApp não configurado no ambiente");
    return;
  }

  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to: telefone,
      type: "interactive",
      interactive: {
        type: "button",
        header: {
          type: "text",
          text: "📦 Confirmação de Pedido"
        },
        body: {
          text:
`Pedido Nº: *${pedidoNumero}*

Itens do pedido:
${textoItens}

Confirme a disponibilidade para envio:`
        },
        footer: {
          text: "Selecione uma opção"
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: `pedido_${pedidoNumero}_confirmar`,
                title: "✅ Confirmar pedido"
              }
            },
            {
              type: "reply",
              reply: {
                id: `pedido_${pedidoNumero}_sem_estoque`,
                title: "❌ Sem estoque"
              }
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  console.log("✅ Mensagem WhatsApp COM BOTÕES enviada");
}
