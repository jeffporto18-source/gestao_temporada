// Cloudflare R2 storage helpers (S3-compatible API).
// Uploaded files live in a private R2 bucket; callers get back a stable
// `/manus-storage/{key}` URL that the storageProxy route resolves to a
// short-lived signed R2 URL on each request.

import crypto from "crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "";

let client: S3Client | null = null;

function requireClient(): S3Client {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw new Error("R2 não configurado: defina R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_BUCKET_NAME.");
  }
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });
  }
  return client;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  await requireClient().send(
    new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, Body: data, ContentType: contentType }),
  );
  return { key, url: `/manus-storage/${key}` };
}

/** URL assinada de curta duração (5 min) para leitura do objeto — gerada a cada acesso, nunca persistida. */
export async function getPresignedUrl(relKey: string, expiresInSeconds = 300): Promise<string> {
  const key = normalizeKey(relKey);
  return getSignedUrl(
    requireClient(),
    new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/** Baixa o conteúdo bruto de um objeto (ex.: para ler uma planilha anexada, no servidor). */
export async function storageGetBuffer(relKey: string): Promise<Buffer> {
  const key = normalizeKey(relKey);
  const res = await requireClient().send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error("Arquivo vazio ou não encontrado.");
  return Buffer.from(bytes);
}
