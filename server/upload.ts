import type { Express, Request, Response } from "express";
import multer from "multer";
import { TRPCError } from "@trpc/server";
import { sdk } from "./_core/sdk";
import { storagePut } from "./storage";
import * as db from "./db";
import { resolverEmpresa } from "./tenant";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

/**
 * Autentica e resolve a EMPRESA em operação — não o usuário logado — para as rotas de upload.
 *
 * Estas rotas rodam em Express puro (multipart/form-data, que o tRPC não lida bem) e por isso
 * ficaram de fora quando as demais 71 rotas foram convertidas para multiempresa: continuavam
 * buscando o registro sob `user.id`. Um contador anexando um documento num cliente recebia
 * "não encontrado" para um imóvel ou contrato que existia — só não sob a conta dele.
 *
 * Devolve `null` depois de já ter respondido (401/403/409), para o chamador só continuar quando
 * o retorno não for nulo.
 */
async function resolverContexto(req: Request, res: Response): Promise<{ ownerId: number; podeEscrever: boolean } | null> {
  const user = await sdk.authenticateRequest(req);
  if (!user) {
    res.status(401).json({ error: "Não autenticado." });
    return null;
  }
  try {
    const acesso = await resolverEmpresa(user.id, req.headers.cookie);
    return { ownerId: acesso.tenantOwnerId, podeEscrever: acesso.nivel !== "consulta" };
  } catch (e) {
    if (e instanceof TRPCError && e.code === "PRECONDITION_FAILED") {
      res.status(409).json({ error: "Escolha a empresa antes de enviar arquivos." });
    } else {
      res.status(403).json({ error: "Sua conta não tem acesso a nenhuma empresa." });
    }
    return null;
  }
}

export function registerUploadRoutes(app: Express) {
  /**
   * POST /api/upload/contrato
   * Body: multipart/form-data with field "file" (PDF) and field "propertyId" (number)
   * Returns: { contratoUrl, contratoKey }
   */
  app.post("/api/upload/contrato", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const ctx = await resolverContexto(req, res);
      if (!ctx) return;
      if (!ctx.podeEscrever) {
        res.status(403).json({ error: "Seu acesso nesta empresa não permite anexar documentos." });
        return;
      }

      const propertyId = Number(req.body.propertyId);
      if (!propertyId) {
        res.status(400).json({ error: "propertyId é obrigatório." });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Arquivo não enviado." });
        return;
      }

      if (file.mimetype !== "application/pdf") {
        res.status(400).json({ error: "Apenas arquivos PDF são aceitos." });
        return;
      }

      // Verify property belongs to the operated company
      const prop = await db.getProperty(ctx.ownerId, propertyId);
      if (!prop) {
        res.status(404).json({ error: "Imóvel não encontrado." });
        return;
      }

      // Upload to S3
      const relKey = `contratos/prop_${propertyId}.pdf`;
      const { key, url } = await storagePut(relKey, file.buffer, "application/pdf");

      // Update property record
      await db.updateProperty(ctx.ownerId, propertyId, { contratoUrl: url, contratoKey: key });

      res.json({ contratoUrl: url, contratoKey: key });
    } catch (error: any) {
      console.error("[Upload] Contract upload failed:", error);
      res.status(500).json({ error: error.message || "Erro ao fazer upload do contrato." });
    }
  });

  /**
   * POST /api/upload/documento-reserva
   * Body: multipart/form-data with field "file" (PDF ou imagem) e "reservationId" (number)
   * Documento de identificação do hóspede.
   * Returns: { documentoUrl, documentoKey }
   */
  const EXT_BY_MIME: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  app.post("/api/upload/documento-reserva", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const ctx = await resolverContexto(req, res);
      if (!ctx) return;
      if (!ctx.podeEscrever) {
        res.status(403).json({ error: "Seu acesso nesta empresa não permite anexar documentos." });
        return;
      }

      const reservationId = Number(req.body.reservationId);
      if (!reservationId) {
        res.status(400).json({ error: "reservationId é obrigatório." });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Arquivo não enviado." });
        return;
      }

      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) {
        res.status(400).json({ error: "Apenas PDF ou imagens (JPG, PNG, WEBP) são aceitos." });
        return;
      }

      const reserva = await db.getReservation(ctx.ownerId, reservationId);
      if (!reserva) {
        res.status(404).json({ error: "Reserva não encontrada." });
        return;
      }

      const relKey = `documentos/reserva_${reservationId}.${ext}`;
      const { key, url } = await storagePut(relKey, file.buffer, file.mimetype);

      await db.updateReservation(ctx.ownerId, reservationId, { documentoUrl: url, documentoKey: key });

      res.json({ documentoUrl: url, documentoKey: key });
    } catch (error: any) {
      console.error("[Upload] Reservation document upload failed:", error);
      res.status(500).json({ error: error.message || "Erro ao fazer upload do documento." });
    }
  });

  /**
   * POST /api/upload/garantia-contrato
   * Body: multipart/form-data with field "file" (PDF ou imagem) e "contractId" (number)
   * Documento da garantia (fiador, caução, seguro fiança, etc.) do contrato de longa duração.
   * Returns: { garantiaDocumentoUrl, garantiaDocumentoKey }
   */
  app.post("/api/upload/garantia-contrato", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const ctx = await resolverContexto(req, res);
      if (!ctx) return;
      if (!ctx.podeEscrever) {
        res.status(403).json({ error: "Seu acesso nesta empresa não permite anexar documentos." });
        return;
      }

      const contractId = Number(req.body.contractId);
      if (!contractId) {
        res.status(400).json({ error: "contractId é obrigatório." });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Arquivo não enviado." });
        return;
      }

      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) {
        res.status(400).json({ error: "Apenas PDF ou imagens (JPG, PNG, WEBP) são aceitos." });
        return;
      }

      const contrato = await db.getLongTermContract(ctx.ownerId, contractId);
      if (!contrato) {
        res.status(404).json({ error: "Contrato não encontrado." });
        return;
      }

      const relKey = `documentos/garantia_contrato_${contractId}.${ext}`;
      const { key, url } = await storagePut(relKey, file.buffer, file.mimetype);

      await db.updateLongTermContract(ctx.ownerId, contractId, { garantiaDocumentoUrl: url, garantiaDocumentoKey: key });

      res.json({ garantiaDocumentoUrl: url, garantiaDocumentoKey: key });
    } catch (error: any) {
      console.error("[Upload] Contract guarantee document upload failed:", error);
      res.status(500).json({ error: error.message || "Erro ao fazer upload do documento da garantia." });
    }
  });

  /**
   * POST /api/upload/contrato-locacao
   * Body: multipart/form-data with field "file" (PDF ou imagem) e "contractId" (number)
   * Contrato de locação assinado do contrato de longa duração.
   * Returns: { contratoLocacaoUrl, contratoLocacaoKey }
   */
  app.post("/api/upload/contrato-locacao", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const ctx = await resolverContexto(req, res);
      if (!ctx) return;
      if (!ctx.podeEscrever) {
        res.status(403).json({ error: "Seu acesso nesta empresa não permite anexar documentos." });
        return;
      }

      const contractId = Number(req.body.contractId);
      if (!contractId) {
        res.status(400).json({ error: "contractId é obrigatório." });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Arquivo não enviado." });
        return;
      }

      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) {
        res.status(400).json({ error: "Apenas PDF ou imagens (JPG, PNG, WEBP) são aceitos." });
        return;
      }

      const contrato = await db.getLongTermContract(ctx.ownerId, contractId);
      if (!contrato) {
        res.status(404).json({ error: "Contrato não encontrado." });
        return;
      }

      const relKey = `documentos/contrato_locacao_${contractId}.${ext}`;
      const { key, url } = await storagePut(relKey, file.buffer, file.mimetype);

      await db.updateLongTermContract(ctx.ownerId, contractId, { contratoLocacaoUrl: url, contratoLocacaoKey: key });

      res.json({ contratoLocacaoUrl: url, contratoLocacaoKey: key });
    } catch (error: any) {
      console.error("[Upload] Contract lease document upload failed:", error);
      res.status(500).json({ error: error.message || "Erro ao fazer upload do contrato de locação." });
    }
  });

  /**
   * POST /api/upload/apolice-seguro
   * Body: multipart/form-data with field "file" (PDF ou imagem) e "contractId" (number)
   * Apólice de seguro (fiança/incêndio) do contrato de longa duração.
   * Returns: { apoliceSeguroUrl, apoliceSeguroKey }
   */
  app.post("/api/upload/apolice-seguro", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const ctx = await resolverContexto(req, res);
      if (!ctx) return;
      if (!ctx.podeEscrever) {
        res.status(403).json({ error: "Seu acesso nesta empresa não permite anexar documentos." });
        return;
      }

      const contractId = Number(req.body.contractId);
      if (!contractId) {
        res.status(400).json({ error: "contractId é obrigatório." });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Arquivo não enviado." });
        return;
      }

      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) {
        res.status(400).json({ error: "Apenas PDF ou imagens (JPG, PNG, WEBP) são aceitos." });
        return;
      }

      const contrato = await db.getLongTermContract(ctx.ownerId, contractId);
      if (!contrato) {
        res.status(404).json({ error: "Contrato não encontrado." });
        return;
      }

      const relKey = `documentos/apolice_seguro_${contractId}.${ext}`;
      const { key, url } = await storagePut(relKey, file.buffer, file.mimetype);

      await db.updateLongTermContract(ctx.ownerId, contractId, { apoliceSeguroUrl: url, apoliceSeguroKey: key });

      res.json({ apoliceSeguroUrl: url, apoliceSeguroKey: key });
    } catch (error: any) {
      console.error("[Upload] Insurance policy upload failed:", error);
      res.status(500).json({ error: error.message || "Erro ao fazer upload da apólice de seguro." });
    }
  });

  /**
   * POST /api/upload/renovacao-contrato
   * Body: multipart/form-data with field "file" (PDF ou imagem) e "contractId" (number)
   * Novo contrato assinado na renovação automática (quando renovacaoAutomatica = "novo_contrato").
   * Returns: { renovacaoContratoUrl, renovacaoContratoKey }
   */
  app.post("/api/upload/renovacao-contrato", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const ctx = await resolverContexto(req, res);
      if (!ctx) return;
      if (!ctx.podeEscrever) {
        res.status(403).json({ error: "Seu acesso nesta empresa não permite anexar documentos." });
        return;
      }

      const contractId = Number(req.body.contractId);
      if (!contractId) {
        res.status(400).json({ error: "contractId é obrigatório." });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Arquivo não enviado." });
        return;
      }

      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) {
        res.status(400).json({ error: "Apenas PDF ou imagens (JPG, PNG, WEBP) são aceitos." });
        return;
      }

      const contrato = await db.getLongTermContract(ctx.ownerId, contractId);
      if (!contrato) {
        res.status(404).json({ error: "Contrato não encontrado." });
        return;
      }

      const relKey = `documentos/renovacao_contrato_${contractId}.${ext}`;
      const { key, url } = await storagePut(relKey, file.buffer, file.mimetype);

      await db.updateLongTermContract(ctx.ownerId, contractId, { renovacaoContratoUrl: url, renovacaoContratoKey: key });

      res.json({ renovacaoContratoUrl: url, renovacaoContratoKey: key });
    } catch (error: any) {
      console.error("[Upload] Contract renewal document upload failed:", error);
      res.status(500).json({ error: error.message || "Erro ao fazer upload do novo contrato." });
    }
  });

  /**
   * POST /api/upload/renovacao-garantia
   * Body: multipart/form-data with field "file" (PDF ou imagem) e "contractId" (number)
   * Documento da garantia (fiador, caução, seguro fiança, etc.) do novo contrato da renovação.
   * Returns: { renovacaoGarantiaDocumentoUrl, renovacaoGarantiaDocumentoKey }
   */
  app.post("/api/upload/renovacao-garantia", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const ctx = await resolverContexto(req, res);
      if (!ctx) return;
      if (!ctx.podeEscrever) {
        res.status(403).json({ error: "Seu acesso nesta empresa não permite anexar documentos." });
        return;
      }

      const contractId = Number(req.body.contractId);
      if (!contractId) {
        res.status(400).json({ error: "contractId é obrigatório." });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Arquivo não enviado." });
        return;
      }

      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) {
        res.status(400).json({ error: "Apenas PDF ou imagens (JPG, PNG, WEBP) são aceitos." });
        return;
      }

      const contrato = await db.getLongTermContract(ctx.ownerId, contractId);
      if (!contrato) {
        res.status(404).json({ error: "Contrato não encontrado." });
        return;
      }

      const relKey = `documentos/renovacao_garantia_${contractId}.${ext}`;
      const { key, url } = await storagePut(relKey, file.buffer, file.mimetype);

      await db.updateLongTermContract(ctx.ownerId, contractId, { renovacaoGarantiaDocumentoUrl: url, renovacaoGarantiaDocumentoKey: key });

      res.json({ renovacaoGarantiaDocumentoUrl: url, renovacaoGarantiaDocumentoKey: key });
    } catch (error: any) {
      console.error("[Upload] Contract renewal guarantee document upload failed:", error);
      res.status(500).json({ error: error.message || "Erro ao fazer upload do documento da garantia da renovação." });
    }
  });

  /**
   * POST /api/upload/renovacao-apolice
   * Body: multipart/form-data with field "file" (PDF ou imagem) e "contractId" (number)
   * Apólice de seguro do novo contrato da renovação.
   * Returns: { renovacaoApoliceSeguroUrl, renovacaoApoliceSeguroKey }
   */
  app.post("/api/upload/renovacao-apolice", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const ctx = await resolverContexto(req, res);
      if (!ctx) return;
      if (!ctx.podeEscrever) {
        res.status(403).json({ error: "Seu acesso nesta empresa não permite anexar documentos." });
        return;
      }

      const contractId = Number(req.body.contractId);
      if (!contractId) {
        res.status(400).json({ error: "contractId é obrigatório." });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Arquivo não enviado." });
        return;
      }

      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) {
        res.status(400).json({ error: "Apenas PDF ou imagens (JPG, PNG, WEBP) são aceitos." });
        return;
      }

      const contrato = await db.getLongTermContract(ctx.ownerId, contractId);
      if (!contrato) {
        res.status(404).json({ error: "Contrato não encontrado." });
        return;
      }

      const relKey = `documentos/renovacao_apolice_${contractId}.${ext}`;
      const { key, url } = await storagePut(relKey, file.buffer, file.mimetype);

      await db.updateLongTermContract(ctx.ownerId, contractId, { renovacaoApoliceSeguroUrl: url, renovacaoApoliceSeguroKey: key });

      res.json({ renovacaoApoliceSeguroUrl: url, renovacaoApoliceSeguroKey: key });
    } catch (error: any) {
      console.error("[Upload] Contract renewal insurance policy upload failed:", error);
      res.status(500).json({ error: error.message || "Erro ao fazer upload da apólice de seguro da renovação." });
    }
  });

  /**
   * POST /api/upload/renovacao2-contrato
   * Body: multipart/form-data with field "file" (PDF ou imagem) e "contractId" (number)
   * Novo contrato assinado na 2ª renovação.
   * Returns: { renovacao2ContratoUrl, renovacao2ContratoKey }
   */
  app.post("/api/upload/renovacao2-contrato", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const ctx = await resolverContexto(req, res);
      if (!ctx) return;
      if (!ctx.podeEscrever) {
        res.status(403).json({ error: "Seu acesso nesta empresa não permite anexar documentos." });
        return;
      }

      const contractId = Number(req.body.contractId);
      if (!contractId) {
        res.status(400).json({ error: "contractId é obrigatório." });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Arquivo não enviado." });
        return;
      }

      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) {
        res.status(400).json({ error: "Apenas PDF ou imagens (JPG, PNG, WEBP) são aceitos." });
        return;
      }

      const contrato = await db.getLongTermContract(ctx.ownerId, contractId);
      if (!contrato) {
        res.status(404).json({ error: "Contrato não encontrado." });
        return;
      }

      const relKey = `documentos/renovacao2_contrato_${contractId}.${ext}`;
      const { key, url } = await storagePut(relKey, file.buffer, file.mimetype);

      await db.updateLongTermContract(ctx.ownerId, contractId, { renovacao2ContratoUrl: url, renovacao2ContratoKey: key });

      res.json({ renovacao2ContratoUrl: url, renovacao2ContratoKey: key });
    } catch (error: any) {
      console.error("[Upload] Second contract renewal document upload failed:", error);
      res.status(500).json({ error: error.message || "Erro ao fazer upload do contrato da 2ª renovação." });
    }
  });

  /**
   * POST /api/upload/renovacao2-garantia
   * Body: multipart/form-data with field "file" (PDF ou imagem) e "contractId" (number)
   * Documento da garantia do contrato da 2ª renovação.
   * Returns: { renovacao2GarantiaDocumentoUrl, renovacao2GarantiaDocumentoKey }
   */
  app.post("/api/upload/renovacao2-garantia", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const ctx = await resolverContexto(req, res);
      if (!ctx) return;
      if (!ctx.podeEscrever) {
        res.status(403).json({ error: "Seu acesso nesta empresa não permite anexar documentos." });
        return;
      }

      const contractId = Number(req.body.contractId);
      if (!contractId) {
        res.status(400).json({ error: "contractId é obrigatório." });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Arquivo não enviado." });
        return;
      }

      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) {
        res.status(400).json({ error: "Apenas PDF ou imagens (JPG, PNG, WEBP) são aceitos." });
        return;
      }

      const contrato = await db.getLongTermContract(ctx.ownerId, contractId);
      if (!contrato) {
        res.status(404).json({ error: "Contrato não encontrado." });
        return;
      }

      const relKey = `documentos/renovacao2_garantia_${contractId}.${ext}`;
      const { key, url } = await storagePut(relKey, file.buffer, file.mimetype);

      await db.updateLongTermContract(ctx.ownerId, contractId, { renovacao2GarantiaDocumentoUrl: url, renovacao2GarantiaDocumentoKey: key });

      res.json({ renovacao2GarantiaDocumentoUrl: url, renovacao2GarantiaDocumentoKey: key });
    } catch (error: any) {
      console.error("[Upload] Second contract renewal guarantee document upload failed:", error);
      res.status(500).json({ error: error.message || "Erro ao fazer upload do documento da garantia da 2ª renovação." });
    }
  });

  /**
   * POST /api/upload/renovacao2-apolice
   * Body: multipart/form-data with field "file" (PDF ou imagem) e "contractId" (number)
   * Apólice de seguro do contrato da 2ª renovação.
   * Returns: { renovacao2ApoliceSeguroUrl, renovacao2ApoliceSeguroKey }
   */
  app.post("/api/upload/renovacao2-apolice", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const ctx = await resolverContexto(req, res);
      if (!ctx) return;
      if (!ctx.podeEscrever) {
        res.status(403).json({ error: "Seu acesso nesta empresa não permite anexar documentos." });
        return;
      }

      const contractId = Number(req.body.contractId);
      if (!contractId) {
        res.status(400).json({ error: "contractId é obrigatório." });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Arquivo não enviado." });
        return;
      }

      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) {
        res.status(400).json({ error: "Apenas PDF ou imagens (JPG, PNG, WEBP) são aceitos." });
        return;
      }

      const contrato = await db.getLongTermContract(ctx.ownerId, contractId);
      if (!contrato) {
        res.status(404).json({ error: "Contrato não encontrado." });
        return;
      }

      const relKey = `documentos/renovacao2_apolice_${contractId}.${ext}`;
      const { key, url } = await storagePut(relKey, file.buffer, file.mimetype);

      await db.updateLongTermContract(ctx.ownerId, contractId, { renovacao2ApoliceSeguroUrl: url, renovacao2ApoliceSeguroKey: key });

      res.json({ renovacao2ApoliceSeguroUrl: url, renovacao2ApoliceSeguroKey: key });
    } catch (error: any) {
      console.error("[Upload] Second contract renewal insurance policy upload failed:", error);
      res.status(500).json({ error: error.message || "Erro ao fazer upload da apólice de seguro da 2ª renovação." });
    }
  });

  /**
   * POST /api/upload/comprovante-lancamento
   * Body: multipart/form-data with field "file" (PDF ou imagem) e "chargeId" (number)
   * Comprovante de pagamento/recebimento de uma ocorrência mensal de Contas a Pagar/Receber.
   * Returns: { comprovanteUrl, comprovanteKey }
   */
  app.post("/api/upload/comprovante-lancamento", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const ctx = await resolverContexto(req, res);
      if (!ctx) return;
      if (!ctx.podeEscrever) {
        res.status(403).json({ error: "Seu acesso nesta empresa não permite anexar comprovantes." });
        return;
      }

      const chargeId = Number(req.body.chargeId);
      if (!chargeId) {
        res.status(400).json({ error: "chargeId é obrigatório." });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Arquivo não enviado." });
        return;
      }

      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) {
        res.status(400).json({ error: "Apenas PDF ou imagens (JPG, PNG, WEBP) são aceitos." });
        return;
      }

      const charge = await db.getLedgerCharge(ctx.ownerId, chargeId);
      if (!charge) {
        res.status(404).json({ error: "Lançamento não encontrado." });
        return;
      }

      const relKey = `comprovantes/lancamento_${chargeId}.${ext}`;
      const { key, url } = await storagePut(relKey, file.buffer, file.mimetype);

      await db.updateLedgerCharge(ctx.ownerId, chargeId, { comprovanteUrl: url, comprovanteKey: key });

      res.json({ comprovanteUrl: url, comprovanteKey: key });
    } catch (error: any) {
      console.error("[Upload] Ledger charge receipt upload failed:", error);
      res.status(500).json({ error: error.message || "Erro ao fazer upload do comprovante." });
    }
  });
}
