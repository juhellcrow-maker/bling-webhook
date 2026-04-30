/**
 * routes/oauth.routes.js
 *
 * Responsabilidade:
 * - Finalizar o fluxo OAuth do Bling
 * - Trocar código de autorização por tokens
 * - Persistir tokens no sistema
 *
 * 👉 ESTE ARQUIVO EXISTE SOMENTE PARA O CALLBACK DO OAUTH
 */

import { Router } from "express";
import axios from "axios";
import { saveTokens } from "../tokenStore.js";
import { atualizarTokens } from "../services/bling.service.js";


const router = Router();

/* ======================================================
   CALLBACK OAUTH BLING
   ====================================================== */

/**
 * Endpoint chamado pelo Bling após o usuário
 * autorizar o aplicativo.
 *
 * Fluxo:
 * 1. Bling redireciona para /callback?code=XXX
 * 2. Troca code por access_token + refresh_token
 * 3. Persiste tokens
 */
router.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.status(400).send(
        "Código de autorização não informado"
      );
    }

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("client_id", process.env.CLIENT_ID);
    params.append("client_secret", process.env.CLIENT_SECRET);
    params.append("redirect_uri", process.env.REDIRECT_URI);

    const r = await axios.post(
      "https://developer.bling.com.br/api/bling/oauth/token",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    /* ---------------------------
       PERSISTE OS TOKENS
       --------------------------- */
    saveTokens({
      access_token: r.data.access_token,
      refresh_token: r.data.refresh_token
    });

     
   atualizarTokens(
      r.data.access_token,
     r.data.refresh_token
   );


    console.log("✅ OAuth concluído com sucesso");

    res.send(
      "✅ Autorização concluída com sucesso. Pode fechar esta página."
    );

  } catch (e) {
    console.error(
      "❌ Erro no callback OAuth:",
      e.response?.data || e.message
    );
    res.status(500).send(
      "Erro ao processar callback OAuth"
    );
  }
});

export default router;
