/**
 * services/regras.service.js
 *
 * Responsabilidade:
 * - Motor de regras do pedido
 * - Avaliar saldo por depósito
 * - Alterar status do pedido
 * - Coordenar lançamento de estoque
 *
 * 👉 ESTE ARQUIVO É O FLUXO CENTRAL DO PEDIDO
 */

import axios from "axios";
import REGRAS from "../rules/regras.js";
import {executarNaFilaBling, safeRequest, getHeaders} from "./bling.service.js";
import {pedidoTemSaldoCompletoNoDeposito, lancarEstoqueUmaVez} from "./estoque.service.js";
import { registrarPedidoConfirmacao } from "./confirmacao.service.js";
import { BuscarCanalVenda } from "../config/canaisVenda.js";
import { registrarLancamentoEstoque, removerPedidoExpedicao, atualizarPedidoComNotaFiscal, atualizarCodigoRastreio,
        buscarEtiquetaZPL, tentarBuscarEtiquetaZPLSeExistir } from "./expedicao.service.js";


const MAPA_DEPOSITO_POR_STATUS = {
  462966: 14888631397, // PS-Ribeirão Preto
  462097: 14888665295, // SS-Rio Preto
  462099: 14888906921  // SS-Catanduva
};


/* ======================================================
   LOCALIZA A REGRA APLICÁVEL AO PEDIDO
   ====================================================== */

/**
 * Encontra a regra correta considerando:
 * - loja
 * - status atual
 * - unidade de negócio (quando aplicável)
 */
function encontrarRegraUnificada(pedido) {
  return REGRAS.find(r =>
    r.lojaId === pedido.loja.id &&
    r.statusOrigem === pedido.situacao.id &&
    (
      // Regra sem condição de unidade
      !r.condicaoUnidade ||
      // Regra com condição de unidade
      r.condicaoUnidade === pedido.loja.unidadeNegocio?.id
    )
  );
}

/* ======================================================
   PROCESSA REGRA DO TIPO "ESTOQUE"
   ====================================================== */

/**
 * Avalia prioridades de estoque
 * e escolhe o primeiro depósito com saldo completo.
 */
async function processarRegraPorEstoque(pedido, regra) {
  console.log(`🧠 Avaliando regra por estoque: ${regra.nome}`);

  for (const prioridade of regra.prioridades) {
    const temSaldo = await pedidoTemSaldoCompletoNoDeposito(
      pedido,
      prioridade.depositoId
    );

    console.log(`📦 ${prioridade.nome} → saldo ok: ${temSaldo}`);

    if (!temSaldo) continue;

    // 1️⃣ ALTERA STATUS
    await alterarStatusPedido(pedido, prioridade.statusDestino);

    // 2️⃣ ATUALIZA STATUS EM MEMÓRIA
    pedido.situacao.id = prioridade.statusDestino;

    // 3️⃣ RESOLVE DEPÓSITO PELO STATUS
    const depositoId = MAPA_DEPOSITO_POR_STATUS[prioridade.statusDestino];
    if (!depositoId) {
      throw new Error(
        `Depósito não definido para o status ${prioridade.statusDestino}`
      );
    }

    // 4️⃣ LANÇA ESTOQUE
    await lancarEstoqueUmaVez(pedido, depositoId);

    // 5️⃣ REGISTRA NO BANCO
    const canalVenda = BuscarCanalVenda(pedido.loja.id);
    await registrarLancamentoEstoque({ pedido, depositoId, canalVenda });

    console.log("✅ Regra aplicada com sucesso");
    return; // ✅ return AQUI (dentro da função)
  }

  console.log("⚠️ Nenhuma prioridade com saldo — ação manual");
}

/* ======================================================
   ALTERAÇÃO DE STATUS DO PEDIDO
   ====================================================== */

/**
 * Altera o status do pedido no Bling
 * de forma segura.
 */
async function alterarStatusPedido(pedido, statusDestino) {
  if (pedido.situacao.id === statusDestino) {
    console.log(`ℹ️ Pedido ${pedido.numero} já está no status ${statusDestino}`);
    return;
  }

  const url =
    `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedido.id}/situacoes/${statusDestino}`;

  try {
    console.log(`🚦 Alterando status do pedido ${pedido.numero} → ${statusDestino}`);

    const r = await executarNaFilaBling(() =>
      safeRequest(() =>
        axios.patch(url, null, { headers: getHeaders() })
      )
    );

    console.log(`✅ Status alterado HTTP ${r.status}`);
  } catch (err) {
    const fields = err.response?.data?.error?.fields || [];
    const mesmaSituacao = err.response?.status === 400 && fields.some(f => f.code === 50);


    if (mesmaSituacao) {
      console.log(`ℹ️ Status do pedido ${pedido.numero} já estava em ${statusDestino}`);
      return;
    }

    throw err;
  }
}

/* ======================================================
   PROCESSO PRINCIPAL (ENTRADA DO WEBHOOK)
   ====================================================== */

/**
 * Orquestra todo o fluxo do pedido:
 * - Busca pedido
 * - Aplica regras
 */

export async function processarPedidoPorId(idPedido) {
        const resp = await executarNaFilaBling(() => 
        safeRequest(() =>
        axios.get(
        `https://api.bling.com.br/Api/v3/pedidos/vendas/${idPedido}`,
        { headers: getHeaders() }
                )
        )
        );

        const pedido = resp.data.data;
        const canalVenda = BuscarCanalVenda(pedido.loja.id);

        // ✅ Pedidos com Envio Programado – RESERVA DE ESTOQUE
        if (pedido.situacao.id === 462967) {
                console.log(`⏸️ Pedido ${pedido.numero} envio futuro — avaliando regra e reservando estoque`);
                const regra = encontrarRegraUnificada(pedido);
                if (!regra) return;
                /* ---------------------------
                       REGRA SIMPLES
                --------------------------- */
                if (regra.tipo === "SIMPLES") {
                        // ❌ NÃO altera status
                        // ❌ NÃO altera pedido.situacao.id

                        const depositoId = MAPA_DEPOSITO_POR_STATUS[regra.statusDestino];
                        if (!depositoId) {
                            throw new Error(
                                    `Depósito não definido para o status ${regra.statusDestino}`
                                    );
                                }
                        await lancarEstoqueUmaVez(pedido, depositoId);
                        const canalVenda = BuscarCanalVenda(pedido.loja.id);
                        await registrarLancamentoEstoque({
                            pedido,
                            depositoId,
                            canalVenda
                                });

                        console.log(`🔒 Estoque reservado (regra simples) para pedido ${pedido.numero}`);
                        return;
                        }
                

                /* ---------------------------
                       REGRA POR ESTOQUE
               --------------------------- */
            if (regra.tipo === "ESTOQUE") {
                    for (const prioridade of regra.prioridades) {
                            const temSaldo = await pedidoTemSaldoCompletoNoDeposito(
                                    pedido,
                                    prioridade.depositoId
                                    );
                            console.log(
              `📦 Reserva ${prioridade.nome} → saldo ok: ${temSaldo}`
            );

            if (!temSaldo) continue;

            // ✅ SOMENTE RESERVA ESTOQUE
            await lancarEstoqueUmaVez(pedido, prioridade.depositoId);

            const canalVenda = BuscarCanalVenda(pedido.loja.id);
            await registrarLancamentoEstoque({
                pedido,
                depositoId: prioridade.depositoId,
                canalVenda
            });

            console.log(
              `🔒 Estoque reservado para pedido ${pedido.numero}`
            );

            return;
        }

        console.log(
          `⚠️ Pedido ${pedido.numero} envio futuro — sem saldo para reserva`
        );
        return;
    }
await removerPedidoExpedicao(pedido.numero);
    return;
}
        
        // ✅ Se pedido voltou para status 6, resetar controle interno de estoque
        if (pedido.situacao.id === 6) {
                await removerPedidoExpedicao(pedido.numero);
                console.log(`🔄 Novo Pedido ${pedido.numero} via Canal: ${canalVenda} `);
                /* ---------------------------
                     ETAPA 2 – MOTOR DE REGRAS
                     --------------------------- */
                const regra = encontrarRegraUnificada(pedido);
                if (!regra) return;
                /* ---------------------------
                     REGRA SIMPLES
                --------------------------- */
                if (regra.tipo === "SIMPLES") {
                        // 1️⃣ ALTERA O STATUS (PASSO PRINCIPAL)
                        await alterarStatusPedido(pedido, regra.statusDestino);
                        
                        // 2️⃣ ATUALIZA STATUS NO OBJETO EM MEMÓRIA
                        pedido.situacao.id = regra.statusDestino;
                        
                        // 3️⃣ RESOLVE DEPÓSITO PELO STATUS
                        const depositoId = MAPA_DEPOSITO_POR_STATUS[regra.statusDestino];
                        if (!depositoId) {
                                throw new Error(`Depósito não definido para o status ${regra.statusDestino}`);
                                }
                        
                        // 4️⃣ LANÇA ESTOQUE
                        await lancarEstoqueUmaVez(pedido, depositoId);
                        
                        // 5️⃣ REGISTRA NO BANCO (EXPEDIÇÃO)
                        const canalVenda = BuscarCanalVenda(pedido.loja.id);
                        await registrarLancamentoEstoque({pedido, depositoId, canalVenda});
                        return;
                        }

                /* ---------------------------
                     REGRA POR ESTOQUE
                --------------------------- */
                if (regra.tipo === "ESTOQUE") {
                        await processarRegraPorEstoque(pedido, regra);
                        return;
                        }
                
                console.log(`📦 Pedido ${pedido.numero} | Status ${pedido.situacao.id}`);
                
                }

        // ✅ SOMENTE PARA PEDIDOS AGUARDANDO GERAR NFE E ETIQUETA
        if (pedido.situacao.id === 15) {
                console.log(`🔄 Pedido aguardando Faturamento ${pedido.numero} via Canal: ${canalVenda} `);
                }

        // ✅ PROCESSA PEDIDOS CANCELADO EXCLUINDO DO BD
        if (pedido.situacao.id === 12) {
                const removido = await removerPedidoExpedicao(pedido.numero);
                if (removido) {
                        console.log(`🗑️ Pedido ${pedido.numero} cancelado – registro removido da expedição`);
                        } else {
                        console.log(`ℹ️ Pedido ${pedido.numero} cancelado – não havia registro de expedição`);
                        }
                return;
                }

        // ✅ PROCESSA STATUS 9 APENAS SE AINDA NÃO FOI COMPLETAMENTE TRATADO
        if (pedido.situacao.id === 9) {
                const jaProcessado = await pedidoJaProcessadoNoAtendido(pedido.numero);
                if (jaProcessado) {
                        console.log(`⏩ Pedido ${pedido.numero} já processado no status 9 — ignorando webhook`);
                        return;
                }
                await atualizarPedidoComNotaFiscal(pedido);
                await atualizarCodigoRastreio(pedido);
                await buscarEtiquetaZPL(pedido.id, pedido.numero, canalVenda);
                console.log(`⏩ Pedido ${pedido.numero} Atualizado NF-e Etiqueta no BD`);
}
}

/* ----- Verifica se Pedidos já foram Processados ----- */

async function pedidoJaProcessadoNoAtendido(pedidoNumero) {
  const result = await pool.query(
    `
    SELECT 1
    FROM pedidos_expedicao
    WHERE pedido_numero = $1
      AND nota_fiscal IS NOT NULL
      AND etiqueta_zpl IS NOT NULL
    `,
    [pedidoNumero]
  );

  return result.rowCount > 0;
}
