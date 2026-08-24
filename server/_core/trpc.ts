import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { TrpcContext } from "./context";

/**
 * Sem isso, um erro de validação de input (ex.: campo numérico negativo) chega no cliente como
 * o JSON bruto dos issues do Zod — foi o que apareceu na tela de uma reserva com "outras taxas"
 * negativa (dado legado de uma importação de CSV antiga). Aqui vira uma frase legível.
 */
function formatarErroZod(erro: ZodError): string {
  const primeiro = erro.issues[0];
  if (!primeiro) return "Dados inválidos.";
  const campo = primeiro.path.length ? String(primeiro.path[primeiro.path.length - 1]) : "";
  if (primeiro.code === "too_small") {
    const min = "minimum" in primeiro ? primeiro.minimum : undefined;
    return campo ? `${campo}: o valor não pode ser menor que ${min}.` : `O valor não pode ser menor que ${min}.`;
  }
  if (primeiro.code === "too_big") {
    const max = "maximum" in primeiro ? primeiro.maximum : undefined;
    return campo ? `${campo}: o valor não pode ser maior que ${max}.` : `O valor não pode ser maior que ${max}.`;
  }
  if (primeiro.code === "invalid_type") {
    return campo ? `${campo}: valor obrigatório ou inválido.` : "Valor obrigatório ou inválido.";
  }
  return campo ? `${campo}: ${primeiro.message}` : primeiro.message;
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter(opts) {
    const { shape, error } = opts;
    if (error.cause instanceof ZodError) {
      return { ...shape, message: formatarErroZod(error.cause) };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
