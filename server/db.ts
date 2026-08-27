import { and, desc, eq, isNull, like, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  clients,
  properties,
  ledgerEntries,
  ledgerCharges,
  reservations,
  invoices,
  chartAccounts,
  DEFAULT_CHART_ACCOUNTS,
  imobiliarias,
  curtaManagers,
  guaranteeTypes,
  DEFAULT_GUARANTEE_TYPES,
  fornecedores,
  socios,
  socioGrupos,
  inventoryItems,
  longTermContracts,
  contractRentCharges,
  InsertClient,
  InsertProperty,
  InsertLedgerEntry,
  InsertLedgerCharge,
  InsertReservation,
  InsertInvoice,
  InsertChartAccount,
  InsertImobiliaria,
  InsertCurtaManager,
  InsertGuaranteeType,
  InsertFornecedor,
  InsertSocio,
  InsertSocioGrupo,
  InsertInventoryItem,
  InsertLongTermContract,
  InsertContractRentCharge,
  propertyCosts,
  InsertPropertyCost,
  PropertyCost,
  tenantAccess,
  InsertTenantAccess,
  NivelAcesso,
  LongTermContract,
  CostResponsibility,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

// ------------------------------------------------------------------ users
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];
  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function updateUserProfile(userId: number, data: Partial<InsertUser>) {
  const db = await requireDb();
  await db.update(users).set(data).where(eq(users.id, userId));
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// --------------------------------------------------------------- clients
export async function listClients(ownerId: number) {
  const db = await requireDb();
  return db.select().from(clients).where(eq(clients.ownerId, ownerId)).orderBy(desc(clients.createdAt));
}

export async function getClient(ownerId: number, id: number) {
  const db = await requireDb();
  const rows = await db.select().from(clients).where(and(eq(clients.ownerId, ownerId), eq(clients.id, id))).limit(1);
  return rows[0];
}

export async function createClient(data: InsertClient) {
  const db = await requireDb();
  const res = await db.insert(clients).values(data);
  return (res as unknown as { insertId: number }[])[0]?.insertId ?? (res as unknown as { insertId: number }).insertId;
}

export async function updateClient(ownerId: number, id: number, data: Partial<InsertClient>) {
  const db = await requireDb();
  await db.update(clients).set(data).where(and(eq(clients.ownerId, ownerId), eq(clients.id, id)));
}

export async function deleteClient(ownerId: number, id: number) {
  const db = await requireDb();
  await db.delete(clients).where(and(eq(clients.ownerId, ownerId), eq(clients.id, id)));
}

// ------------------------------------------------------------ properties
export async function listProperties(ownerId: number) {
  const db = await requireDb();
  return db.select().from(properties).where(eq(properties.ownerId, ownerId)).orderBy(desc(properties.createdAt));
}

export async function getProperty(ownerId: number, id: number) {
  const db = await requireDb();
  const rows = await db.select().from(properties).where(and(eq(properties.ownerId, ownerId), eq(properties.id, id))).limit(1);
  return rows[0];
}

export async function createProperty(data: InsertProperty) {
  const db = await requireDb();
  await db.insert(properties).values(data);
}

export async function updateProperty(ownerId: number, id: number, data: Partial<InsertProperty>) {
  const db = await requireDb();
  await db.update(properties).set(data).where(and(eq(properties.ownerId, ownerId), eq(properties.id, id)));
}

export async function deleteProperty(ownerId: number, id: number) {
  const db = await requireDb();
  const [reserva] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.ownerId, ownerId), eq(reservations.propertyId, id)))
    .limit(1);
  if (reserva) {
    throw new Error("Este imóvel possui reservas de curta temporada vinculadas e não pode ser excluído.");
  }
  const [contrato] = await db
    .select({ id: longTermContracts.id })
    .from(longTermContracts)
    .where(and(eq(longTermContracts.ownerId, ownerId), eq(longTermContracts.propertyId, id)))
    .limit(1);
  if (contrato) {
    throw new Error("Este imóvel possui contrato de longa duração vinculado e não pode ser excluído.");
  }
  await db.delete(properties).where(and(eq(properties.ownerId, ownerId), eq(properties.id, id)));
}

// --------------------------------------------------------- ledger entries
/** Cada linha representa uma série mensal (competenciaInicio + qtdMeses), não uma ocorrência única. */
export async function listLedgerEntries(
  ownerId: number,
  propertyId?: number,
  grupo?: "despesa_fixa" | "despesa_variavel" | "receita" | "aporte_capital",
) {
  const db = await requireDb();
  const conds = [eq(ledgerEntries.ownerId, ownerId)];
  if (propertyId) conds.push(eq(ledgerEntries.propertyId, propertyId));
  if (grupo) conds.push(eq(ledgerEntries.grupo, grupo));
  return db.select().from(ledgerEntries).where(and(...conds)).orderBy(desc(ledgerEntries.createdAt));
}

/** Verifica se a competência alvo ("AAAA-MM") cai dentro da série [competenciaInicio, competenciaInicio + qtdMeses - 1]. */
export function competenciaNaSerie(competenciaInicio: string, qtdMeses: number, alvo: string): boolean {
  const [y0, m0] = competenciaInicio.split("-").map(Number);
  const [y1, m1] = alvo.split("-").map(Number);
  const idx = (y1 * 12 + (m1 - 1)) - (y0 * 12 + (m0 - 1));
  return idx >= 0 && idx < qtdMeses;
}

/** Lançamentos cuja série cobre a competência informada (para a DRE do mês). */
export async function listLedgerEntriesNaCompetencia(
  ownerId: number,
  propertyId: number,
  competencia: string,
  grupo?: "despesa_fixa" | "despesa_variavel" | "receita" | "aporte_capital",
) {
  const todos = await listLedgerEntries(ownerId, propertyId, grupo);
  return todos.filter((e) => competenciaNaSerie(e.competenciaInicio, e.qtdMeses, competencia));
}

export async function createLedgerEntry(data: InsertLedgerEntry) {
  const db = await requireDb();
  const res = await db.insert(ledgerEntries).values(data);
  return (res as unknown as { insertId: number }[])[0]?.insertId ?? (res as unknown as { insertId: number }).insertId;
}

export async function getLedgerEntry(ownerId: number, id: number) {
  const db = await requireDb();
  const [entry] = await db.select().from(ledgerEntries).where(and(eq(ledgerEntries.ownerId, ownerId), eq(ledgerEntries.id, id))).limit(1);
  return entry;
}

export async function updateLedgerEntry(ownerId: number, id: number, data: Partial<InsertLedgerEntry>) {
  const db = await requireDb();
  await db.update(ledgerEntries).set(data).where(and(eq(ledgerEntries.ownerId, ownerId), eq(ledgerEntries.id, id)));
}

export async function deleteLedgerEntry(ownerId: number, id: number) {
  const db = await requireDb();
  await db.delete(ledgerEntries).where(and(eq(ledgerEntries.ownerId, ownerId), eq(ledgerEntries.id, id)));
}

// --------------------------------------------------------- ledger charges (contas a pagar/receber)
/** Ocorrências mensais de um lançamento manual, com baixa e comprovante próprios. */
export async function listLedgerCharges(
  ownerId: number,
  filtros?: { ledgerEntryId?: number; propertyId?: number; grupo?: "despesa_fixa" | "despesa_variavel" | "receita" | "aporte_capital"; status?: "aberto" | "pago" | "cancelado" },
) {
  const db = await requireDb();
  const conds = [eq(ledgerCharges.ownerId, ownerId)];
  if (filtros?.ledgerEntryId) conds.push(eq(ledgerCharges.ledgerEntryId, filtros.ledgerEntryId));
  if (filtros?.propertyId) conds.push(eq(ledgerCharges.propertyId, filtros.propertyId));
  if (filtros?.grupo) conds.push(eq(ledgerCharges.grupo, filtros.grupo));
  if (filtros?.status) conds.push(eq(ledgerCharges.status, filtros.status));
  return db.select().from(ledgerCharges).where(and(...conds)).orderBy(desc(ledgerCharges.dataVencimento));
}

export async function getLedgerCharge(ownerId: number, id: number) {
  const db = await requireDb();
  const [charge] = await db.select().from(ledgerCharges).where(and(eq(ledgerCharges.ownerId, ownerId), eq(ledgerCharges.id, id))).limit(1);
  return charge;
}

export async function createLedgerCharge(data: InsertLedgerCharge) {
  const db = await requireDb();
  const res = await db.insert(ledgerCharges).values(data);
  return (res as unknown as { insertId: number }[])[0]?.insertId ?? (res as unknown as { insertId: number }).insertId;
}

export async function updateLedgerCharge(ownerId: number, id: number, data: Partial<InsertLedgerCharge>) {
  const db = await requireDb();
  await db.update(ledgerCharges).set(data).where(and(eq(ledgerCharges.ownerId, ownerId), eq(ledgerCharges.id, id)));
}

/** Só os meses "em aberto" — os pagos e cancelados nunca são regenerados, pra não perder a baixa nem o comprovante. */
export async function deleteLedgerChargesAbertas(ownerId: number, ledgerEntryId: number) {
  const db = await requireDb();
  await db.delete(ledgerCharges).where(and(eq(ledgerCharges.ownerId, ownerId), eq(ledgerCharges.ledgerEntryId, ledgerEntryId), eq(ledgerCharges.status, "aberto")));
}

export async function deleteLedgerChargesByEntry(ownerId: number, ledgerEntryId: number) {
  const db = await requireDb();
  await db.delete(ledgerCharges).where(and(eq(ledgerCharges.ownerId, ownerId), eq(ledgerCharges.ledgerEntryId, ledgerEntryId)));
}

/** Bloqueia excluir/editar o cadastro quando algum mês já foi baixado — protege a baixa e o comprovante anexado. */
export async function existeLedgerChargePago(ownerId: number, ledgerEntryId: number) {
  const db = await requireDb();
  const [row] = await db.select({ id: ledgerCharges.id }).from(ledgerCharges).where(and(eq(ledgerCharges.ownerId, ownerId), eq(ledgerCharges.ledgerEntryId, ledgerEntryId), eq(ledgerCharges.status, "pago"))).limit(1);
  return !!row;
}

export async function deleteLedgerEntriesByReservation(ownerId: number, reservationId: number) {
  const db = await requireDb();
  await db.delete(ledgerEntries).where(and(eq(ledgerEntries.ownerId, ownerId), eq(ledgerEntries.reservationId, reservationId)));
}

export async function deleteLedgerEntriesByContractRentCharge(ownerId: number, contractRentChargeId: number) {
  const db = await requireDb();
  await db.delete(ledgerEntries).where(and(eq(ledgerEntries.ownerId, ownerId), eq(ledgerEntries.contractRentChargeId, contractRentChargeId)));
}

// ---------------------------------------------------------- reservations
export async function listReservations(ownerId: number, propertyId?: number, competencia?: string) {
  const db = await requireDb();
  const conds = [eq(reservations.ownerId, ownerId)];
  if (propertyId) conds.push(eq(reservations.propertyId, propertyId));
  if (competencia) conds.push(eq(reservations.competencia, competencia));
  return db.select().from(reservations).where(and(...conds)).orderBy(desc(reservations.checkin));
}

/** Reservas de TODOS os imóveis num ano (competência "AAAA-%"), usado no relatório DIMOB. */
export async function listReservationsByYear(ownerId: number, ano: string) {
  const db = await requireDb();
  return db
    .select()
    .from(reservations)
    .where(and(eq(reservations.ownerId, ownerId), like(reservations.competencia, `${ano}-%`)))
    .orderBy(desc(reservations.checkin));
}

/**
 * Reservas com recebimento CONFIRMADO cuja data de recebimento cai no mês informado — regime de
 * caixa (usado na EFD Contribuições). Reservas sem recebimento confirmado ainda não entram: só
 * contam quando o dinheiro realmente caiu na conta, no mês em que caiu (não no mês do check-in).
 */
export async function listReservationsRecebidasNaCompetencia(ownerId: number, competencia: string) {
  const db = await requireDb();
  return db
    .select()
    .from(reservations)
    .where(and(eq(reservations.ownerId, ownerId), like(reservations.dataRecebimento, `${competencia}-%`)))
    .orderBy(desc(reservations.dataRecebimento));
}

/** Mesma ideia acima, mas para o ano inteiro — usado no DIMOB. */
export async function listReservationsRecebidasNoAno(ownerId: number, ano: string) {
  const db = await requireDb();
  return db
    .select()
    .from(reservations)
    .where(and(eq(reservations.ownerId, ownerId), like(reservations.dataRecebimento, `${ano}-%`)))
    .orderBy(desc(reservations.dataRecebimento));
}

export async function getReservation(ownerId: number, id: number) {
  const db = await requireDb();
  const rows = await db.select().from(reservations).where(and(eq(reservations.ownerId, ownerId), eq(reservations.id, id))).limit(1);
  return rows[0];
}

export async function createReservation(data: InsertReservation) {
  const db = await requireDb();
  const res = await db.insert(reservations).values(data);
  return (res as unknown as { insertId: number }[])[0]?.insertId ?? (res as unknown as { insertId: number }).insertId;
}

export async function updateReservation(ownerId: number, id: number, data: Partial<InsertReservation>) {
  const db = await requireDb();
  await db.update(reservations).set(data).where(and(eq(reservations.ownerId, ownerId), eq(reservations.id, id)));
}

export async function deleteReservation(ownerId: number, id: number) {
  const db = await requireDb();
  await db.delete(reservations).where(and(eq(reservations.ownerId, ownerId), eq(reservations.id, id)));
  await db.delete(invoices).where(and(eq(invoices.ownerId, ownerId), eq(invoices.reservationId, id)));
  // Remover lançamentos automáticos de faxina vinculados a esta reserva
  await db.delete(ledgerEntries).where(and(eq(ledgerEntries.ownerId, ownerId), eq(ledgerEntries.reservationId, id)));
}

// -------------------------------------------------------------- invoices
export async function listInvoicesByReservation(ownerId: number, reservationId: number) {
  const db = await requireDb();
  return db.select().from(invoices).where(and(eq(invoices.ownerId, ownerId), eq(invoices.reservationId, reservationId)));
}

export async function listInvoices(ownerId: number, competencia?: string) {
  const db = await requireDb();
  // notas ligadas a reservas da competência (join simples via reservationId)
  const rows = await db.select().from(invoices).where(eq(invoices.ownerId, ownerId)).orderBy(desc(invoices.createdAt));
  return rows;
}

export async function listInvoicesByProperty(ownerId: number, propertyId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(invoices)
    .where(and(eq(invoices.ownerId, ownerId), eq(invoices.propertyId, propertyId)))
    .orderBy(desc(invoices.createdAt));
}

export async function createInvoice(data: InsertInvoice) {
  const db = await requireDb();
  await db.insert(invoices).values(data);
}

export async function deleteInvoicesByReservation(ownerId: number, reservationId: number) {
  const db = await requireDb();
  await db.delete(invoices).where(and(eq(invoices.ownerId, ownerId), eq(invoices.reservationId, reservationId)));
}

// ----------------------------------------------------------- user management
export async function listTeamUsers(ownerId: number) {
  const db = await requireDb();
  const rows = await db.select().from(users).where(eq(users.invitedBy, ownerId)).orderBy(desc(users.createdAt));
  // O nível mora em tenant_access, não no usuário: a mesma pessoa pode ter alcances diferentes em
  // empresas diferentes. Aqui trazemos o nível dela nesta empresa.
  const acessos = await db.select().from(tenantAccess).where(eq(tenantAccess.tenantOwnerId, ownerId));
  const nivelPorUsuario = new Map(acessos.map((a) => [a.userId, a.nivel]));
  return rows.map(({ passwordHash, ...u }) => ({ ...u, nivel: nivelPorUsuario.get(u.id) ?? null }));
}

export async function createTeamUser(data: {
  ownerId: number;
  name: string;
  email: string;
  password: string;
  telefone?: string | null;
  nivel?: NivelAcesso;
}) {
  const db = await requireDb();
  const bcrypt = await import("bcryptjs");
  const { nanoid } = await import("nanoid");

  // Check if email already exists
  const existing = await db.select().from(users).where(eq(users.email, data.email.toLowerCase().trim())).limit(1);
  if (existing.length > 0) {
    throw new Error("Este e-mail já está cadastrado.");
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const openId = `local_${nanoid(20)}`;

  const inserido = await db.insert(users).values({
    openId,
    name: data.name.trim(),
    email: data.email.toLowerCase().trim(),
    passwordHash,
    loginMethod: "email",
    invitedBy: data.ownerId,
    telefone: data.telefone ? data.telefone.replace(/\D/g, "") : null,
    lastSignedIn: new Date(),
  });

  // O funcionário opera a empresa de quem o convidou — não uma empresa própria. Antes desta linha
  // o convidado entrava e via um sistema vazio, porque as consultas procuravam dados sob o id
  // dele. É aqui que ele passa a enxergar a empresa certa, com o nível escolhido no cadastro.
  const novoId = (inserido as unknown as { insertId: number }[])[0]?.insertId
    ?? (inserido as unknown as { insertId: number }).insertId;
  await db.insert(tenantAccess).values({
    userId: novoId,
    tenantOwnerId: data.ownerId,
    nivel: data.nivel ?? "total",
  });
}

/**
 * Troca a senha de um usuário.
 *
 * O sistema não envia e-mail, então não há "esqueci minha senha" por link: quem redefine é o
 * responsável — o dono da empresa pelo funcionário dele, o escritório pelo dono da empresa. Isso
 * cobre todos os casos reais sem depender de provedor de e-mail, e evita que um cliente fique
 * travado esperando alguém mexer no banco.
 */
export async function setUserPassword(userId: number, novaSenha: string) {
  const db = await requireDb();
  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.hash(novaSenha, 12);
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

/** Confere a senha atual — exigida para o usuário trocar a própria senha. */
export async function checkUserPassword(userId: number, senha: string) {
  const db = await requireDb();
  const bcrypt = await import("bcryptjs");
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const hash = rows[0]?.passwordHash;
  if (!hash) return false;
  return bcrypt.compare(senha, hash);
}

export async function deleteTeamUser(ownerId: number, userId: number) {
  const db = await requireDb();
  await db.delete(users).where(and(eq(users.id, userId), eq(users.invitedBy, ownerId)));
}

export async function getUserById(userId: number) {
  const db = await requireDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] || null;
}

// --------------------------------------------------------- acesso às empresas
/**
 * Empresas que o usuário pode operar, com o nome de cada uma para a tela de seleção.
 *
 * O escritório contábil (`role = admin`) enxerga todas por definição: atender essas empresas é o
 * trabalho dele, e exigir uma concessão por cliente só criaria uma etapa a ser esquecida quando
 * entrasse cliente novo. Para os funcionários do escritório a concessão continua explícita — um
 * deles pode atender só parte da carteira, e aí a escolha significa alguma coisa.
 */
export async function listTenantAccess(userId: number) {
  const db = await requireDb();

  const usuario = await getUserById(userId);
  if (usuario?.role === "admin") {
    const empresas = await listTenants();
    return empresas.map((e) => ({
      tenantOwnerId: e.id,
      nivel: "total" as const,
      nome: e.razaoSocial,
      nomeResponsavel: e.nomeResponsavel,
      nomeUsuario: e.name,
      email: e.email,
      userType: e.userType,
    }));
  }

  return db
    .select({
      tenantOwnerId: tenantAccess.tenantOwnerId,
      nivel: tenantAccess.nivel,
      nome: users.razaoSocial,
      nomeResponsavel: users.nomeResponsavel,
      nomeUsuario: users.name,
      email: users.email,
      userType: users.userType,
    })
    .from(tenantAccess)
    .innerJoin(users, eq(users.id, tenantAccess.tenantOwnerId))
    .where(eq(tenantAccess.userId, userId))
    .orderBy(users.razaoSocial);
}

/**
 * O acesso de um usuário a uma empresa — a única porta pela qual o `ownerId` efetivo passa.
 * Sem linha aqui, não há acesso: é o que impede um cliente de enxergar os dados de outro.
 */
export async function getTenantAccess(userId: number, tenantOwnerId: number) {
  const db = await requireDb();

  // Mesma regra do listTenantAccess: o escritório alcança qualquer empresa do sistema. As duas
  // funções precisam concordar — se uma liberasse e a outra não, a seleção de empresa aceitaria
  // uma escolha que a requisição seguinte recusaria.
  const usuario = await getUserById(userId);
  if (usuario?.role === "admin") {
    const dono = await getUserById(tenantOwnerId);
    // Precisa recusar exatamente o que listTenants recusa — inclusive a própria conta do
    // escritório. Se aqui liberasse e lá não, a seleção aceitaria uma empresa que a requisição
    // seguinte recusaria, e a tela ficaria num laço sem explicação.
    if (!dono || dono.invitedBy !== null || dono.role === "admin") return null;
    return { id: 0, userId, tenantOwnerId, nivel: "total" as const, createdAt: new Date() };
  }

  const rows = await db
    .select()
    .from(tenantAccess)
    .where(and(eq(tenantAccess.userId, userId), eq(tenantAccess.tenantOwnerId, tenantOwnerId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Todos os acessos concedidos numa empresa (para a tela de usuários da própria empresa). */
export async function listAccessOfTenant(tenantOwnerId: number) {
  const db = await requireDb();
  return db
    .select({
      userId: tenantAccess.userId,
      nivel: tenantAccess.nivel,
      nome: users.name,
      email: users.email,
      telefone: users.telefone,
      ehDono: users.invitedBy,
    })
    .from(tenantAccess)
    .innerJoin(users, eq(users.id, tenantAccess.userId))
    .where(eq(tenantAccess.tenantOwnerId, tenantOwnerId))
    .orderBy(users.name);
}

export async function grantTenantAccess(data: InsertTenantAccess) {
  const db = await requireDb();
  const existente = await getTenantAccess(data.userId, data.tenantOwnerId);
  if (existente) {
    await db
      .update(tenantAccess)
      .set({ nivel: data.nivel })
      .where(and(eq(tenantAccess.userId, data.userId), eq(tenantAccess.tenantOwnerId, data.tenantOwnerId)));
    return;
  }
  await db.insert(tenantAccess).values(data);
}

export async function revokeTenantAccess(userId: number, tenantOwnerId: number) {
  const db = await requireDb();
  await db.delete(tenantAccess).where(and(eq(tenantAccess.userId, userId), eq(tenantAccess.tenantOwnerId, tenantOwnerId)));
}

/**
 * Empresas clientes do sistema.
 *
 * Contas de escritório (`role = admin`) ficam de fora: o escritório não é um cliente, é quem
 * atende os clientes. Sem essa exclusão ele apareceria na própria lista de empresas, junto com a
 * carteira, e o contador teria de escolher entre operar "a si mesmo" ou um cliente de verdade.
 */
export async function listTenants() {
  const db = await requireDb();
  return db
    .select({
      id: users.id,
      razaoSocial: users.razaoSocial,
      cnpj: users.cnpj,
      nomeResponsavel: users.nomeResponsavel,
      name: users.name,
      email: users.email,
      telefone: users.telefone,
      userType: users.userType,
    })
    .from(users)
    .where(and(isNull(users.invitedBy), ne(users.role, "admin")))
    .orderBy(users.razaoSocial);
}

/**
 * Cadastra uma empresa cliente nova, pelo escritório, sem passar pelo formulário público de
 * cadastro — reaproveita a mesma forma de gravar dados que /api/auth/register usa.
 */
export async function createTenant(data: {
  razaoSocial: string;
  cnpj: string;
  email: string;
  telefone?: string;
  nomeResponsavel?: string;
  userType: string;
  senhaInicial: string;
}) {
  const db = await requireDb();
  const bcrypt = await import("bcryptjs");
  const { nanoid } = await import("nanoid");

  const email = data.email.toLowerCase().trim();
  const existente = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existente.length > 0) throw new Error("Este e-mail já está cadastrado.");

  const passwordHash = await bcrypt.hash(data.senhaInicial, 12);
  const openId = `local_${nanoid(20)}`;

  const inserido = await db.insert(users).values({
    openId,
    name: data.razaoSocial.trim(),
    email,
    passwordHash,
    loginMethod: "email",
    tipoCadastro: "pj",
    userType: data.userType as InsertUser["userType"],
    cnpj: data.cnpj.replace(/\D/g, ""),
    razaoSocial: data.razaoSocial.trim(),
    nomeResponsavel: data.nomeResponsavel?.trim() || null,
    telefone: data.telefone ? data.telefone.replace(/\D/g, "") : null,
    lastSignedIn: new Date(),
  });
  const novoId = (inserido as unknown as { insertId: number }[])[0]?.insertId
    ?? (inserido as unknown as { insertId: number }).insertId;

  // Sem esta linha o dono não teria acesso à própria empresa — mesma regra do cadastro público.
  await db.insert(tenantAccess).values({ userId: novoId, tenantOwnerId: novoId, nivel: "total" });

  return novoId;
}

/** Corrige dados de cadastro de uma empresa — o caso comum é um e-mail de teste virando o oficial. */
export async function updateTenant(
  empresaId: number,
  data: { razaoSocial?: string; cnpj?: string; email?: string; telefone?: string },
) {
  const db = await requireDb();
  const values: Partial<InsertUser> = {};
  if (data.razaoSocial !== undefined) {
    values.razaoSocial = data.razaoSocial.trim();
    values.name = data.razaoSocial.trim(); // mesma sincronia que profile.update já faz numa conta PJ
  }
  if (data.cnpj !== undefined) values.cnpj = data.cnpj.replace(/\D/g, "");
  if (data.telefone !== undefined) values.telefone = data.telefone.replace(/\D/g, "");
  if (data.email !== undefined) {
    const email = data.email.toLowerCase().trim();
    const emUso = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (emUso.length > 0 && emUso[0].id !== empresaId) throw new Error("Este e-mail já está em uso por outra conta.");
    values.email = email;
  }
  if (Object.keys(values).length === 0) return;
  await db.update(users).set(values).where(eq(users.id, empresaId));
}

// ------------------------------------------------------- plano de contas (chart accounts)
type ChartAccountGrupo = "despesa_fixa" | "despesa_variavel" | "receita" | "aporte_capital";

export async function listChartAccounts(ownerId: number, grupo?: ChartAccountGrupo) {
  const db = await requireDb();
  const conds = [eq(chartAccounts.ownerId, ownerId)];
  if (grupo) conds.push(eq(chartAccounts.grupo, grupo));
  return db.select().from(chartAccounts).where(and(...conds)).orderBy(chartAccounts.grupo, chartAccounts.id);
}

export async function createChartAccount(data: InsertChartAccount) {
  const db = await requireDb();
  const res = await db.insert(chartAccounts).values(data);
  return (res as unknown as { insertId: number }[])[0]?.insertId ?? (res as unknown as { insertId: number }).insertId;
}

export async function updateChartAccount(ownerId: number, id: number, data: Partial<Pick<InsertChartAccount, "nome" | "ativa">>) {
  const db = await requireDb();
  await db.update(chartAccounts).set(data).where(and(eq(chartAccounts.ownerId, ownerId), eq(chartAccounts.id, id)));
}

/** Remove a conta e toda a sua descendência (sub-contas em qualquer profundidade). */
export async function deleteChartAccount(ownerId: number, id: number) {
  const db = await requireDb();
  const all = await listChartAccounts(ownerId);
  const toDelete = new Set<number>([id]);
  // Percorre repetidamente até não achar mais filhos novos (profundidade livre).
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of all) {
      if (c.parentId !== null && toDelete.has(c.parentId) && !toDelete.has(c.id)) {
        toDelete.add(c.id);
        changed = true;
      }
    }
  }
  for (const accountId of Array.from(toDelete)) {
    await db.delete(chartAccounts).where(and(eq(chartAccounts.ownerId, ownerId), eq(chartAccounts.id, accountId)));
  }
}

/** Semeia a conta principal padrão (uma por grupo/natureza) na primeira vez que o usuário acessa o plano de contas. */
export async function seedDefaultChartAccountsIfNeeded(ownerId: number) {
  const existing = await listChartAccounts(ownerId);
  if (existing.length > 0) return existing;
  for (const [grupo, nome] of Object.entries(DEFAULT_CHART_ACCOUNTS) as [keyof typeof DEFAULT_CHART_ACCOUNTS, string][]) {
    await createChartAccount({ ownerId, grupo, nome, ativa: 1 });
  }
  return listChartAccounts(ownerId);
}

// ----------------------------------------------------------------- imobiliarias
export async function listImobiliarias(ownerId: number) {
  const db = await requireDb();
  return db.select().from(imobiliarias).where(eq(imobiliarias.ownerId, ownerId)).orderBy(desc(imobiliarias.createdAt));
}

export async function createImobiliaria(data: InsertImobiliaria) {
  const db = await requireDb();
  await db.insert(imobiliarias).values(data);
}

export async function updateImobiliaria(ownerId: number, id: number, data: Partial<InsertImobiliaria>) {
  const db = await requireDb();
  await db.update(imobiliarias).set(data).where(and(eq(imobiliarias.ownerId, ownerId), eq(imobiliarias.id, id)));
}

export async function deleteImobiliaria(ownerId: number, id: number) {
  const db = await requireDb();
  await db.delete(imobiliarias).where(and(eq(imobiliarias.ownerId, ownerId), eq(imobiliarias.id, id)));
}

// -------------------------------------------------------------- curta managers
export async function listCurtaManagers(ownerId: number) {
  const db = await requireDb();
  return db.select().from(curtaManagers).where(eq(curtaManagers.ownerId, ownerId)).orderBy(desc(curtaManagers.createdAt));
}

export async function createCurtaManager(data: InsertCurtaManager) {
  const db = await requireDb();
  await db.insert(curtaManagers).values(data);
}

export async function updateCurtaManager(ownerId: number, id: number, data: Partial<InsertCurtaManager>) {
  const db = await requireDb();
  await db.update(curtaManagers).set(data).where(and(eq(curtaManagers.ownerId, ownerId), eq(curtaManagers.id, id)));
}

export async function deleteCurtaManager(ownerId: number, id: number) {
  const db = await requireDb();
  await db.delete(curtaManagers).where(and(eq(curtaManagers.ownerId, ownerId), eq(curtaManagers.id, id)));
}

// --------------------------------------------------------------- guarantee types
export async function listGuaranteeTypes(ownerId: number) {
  const db = await requireDb();
  return db.select().from(guaranteeTypes).where(eq(guaranteeTypes.ownerId, ownerId)).orderBy(guaranteeTypes.id);
}

export async function createGuaranteeType(data: InsertGuaranteeType) {
  const db = await requireDb();
  await db.insert(guaranteeTypes).values(data);
}

export async function updateGuaranteeType(ownerId: number, id: number, data: Partial<Pick<InsertGuaranteeType, "nome" | "ativa">>) {
  const db = await requireDb();
  await db.update(guaranteeTypes).set(data).where(and(eq(guaranteeTypes.ownerId, ownerId), eq(guaranteeTypes.id, id)));
}

export async function deleteGuaranteeType(ownerId: number, id: number) {
  const db = await requireDb();
  await db.delete(guaranteeTypes).where(and(eq(guaranteeTypes.ownerId, ownerId), eq(guaranteeTypes.id, id)));
}

/** Seed default guarantee types if user has none yet */
export async function seedDefaultGuaranteeTypesIfNeeded(ownerId: number) {
  const existing = await listGuaranteeTypes(ownerId);
  if (existing.length > 0) return existing;
  for (const nome of DEFAULT_GUARANTEE_TYPES) {
    await createGuaranteeType({ ownerId, nome, ativa: 1 });
  }
  return listGuaranteeTypes(ownerId);
}

// -------------------------------------------------------------------- fornecedores
export async function listFornecedores(ownerId: number) {
  const db = await requireDb();
  return db.select().from(fornecedores).where(eq(fornecedores.ownerId, ownerId)).orderBy(fornecedores.nome);
}

export async function createFornecedor(data: InsertFornecedor) {
  const db = await requireDb();
  await db.insert(fornecedores).values(data);
}

export async function updateFornecedor(
  ownerId: number,
  id: number,
  data: Partial<Pick<InsertFornecedor, "nome" | "cpfCnpj" | "telefone" | "email" | "chartAccountId" | "ativo">>,
) {
  const db = await requireDb();
  await db.update(fornecedores).set(data).where(and(eq(fornecedores.ownerId, ownerId), eq(fornecedores.id, id)));
}

export async function deleteFornecedor(ownerId: number, id: number) {
  const db = await requireDb();
  await db.delete(fornecedores).where(and(eq(fornecedores.ownerId, ownerId), eq(fornecedores.id, id)));
}

// -------------------------------------------------------------------- sócios
export async function listSocios(ownerId: number) {
  const db = await requireDb();
  return db.select().from(socios).where(eq(socios.ownerId, ownerId)).orderBy(socios.nome);
}

export async function createSocio(data: InsertSocio) {
  const db = await requireDb();
  await db.insert(socios).values(data);
}

export async function updateSocio(ownerId: number, id: number, data: Partial<Pick<InsertSocio, "nome" | "cpf" | "grupoId">>) {
  const db = await requireDb();
  await db.update(socios).set(data).where(and(eq(socios.ownerId, ownerId), eq(socios.id, id)));
}

export async function deleteSocio(ownerId: number, id: number) {
  const db = await requireDb();
  await db.delete(socios).where(and(eq(socios.ownerId, ownerId), eq(socios.id, id)));
}

// -------------------------------------------------------------- grupos de sócios
export async function listSocioGrupos(ownerId: number) {
  const db = await requireDb();
  return db.select().from(socioGrupos).where(eq(socioGrupos.ownerId, ownerId)).orderBy(socioGrupos.nome);
}

export async function createSocioGrupo(data: InsertSocioGrupo) {
  const db = await requireDb();
  const res = await db.insert(socioGrupos).values(data);
  return (res as unknown as { insertId: number }[])[0]?.insertId ?? (res as unknown as { insertId: number }).insertId;
}

export async function updateSocioGrupo(ownerId: number, id: number, data: Partial<Pick<InsertSocioGrupo, "nome">>) {
  const db = await requireDb();
  await db.update(socioGrupos).set(data).where(and(eq(socioGrupos.ownerId, ownerId), eq(socioGrupos.id, id)));
}

export async function deleteSocioGrupo(ownerId: number, id: number) {
  const db = await requireDb();
  // Sócios do grupo não são apagados — só ficam sem grupo.
  await db.update(socios).set({ grupoId: null }).where(and(eq(socios.ownerId, ownerId), eq(socios.grupoId, id)));
  await db.delete(socioGrupos).where(and(eq(socioGrupos.ownerId, ownerId), eq(socioGrupos.id, id)));
}

// -------------------------------------------------------------- inventory items
export async function listInventoryItems(ownerId: number, propertyId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.ownerId, ownerId), eq(inventoryItems.propertyId, propertyId)))
    .orderBy(desc(inventoryItems.createdAt));
}

export async function createInventoryItem(data: InsertInventoryItem) {
  const db = await requireDb();
  await db.insert(inventoryItems).values(data);
}

export async function updateInventoryItem(ownerId: number, id: number, data: Partial<InsertInventoryItem>) {
  const db = await requireDb();
  await db.update(inventoryItems).set(data).where(and(eq(inventoryItems.ownerId, ownerId), eq(inventoryItems.id, id)));
}

export async function deleteInventoryItem(ownerId: number, id: number) {
  const db = await requireDb();
  await db.delete(inventoryItems).where(and(eq(inventoryItems.ownerId, ownerId), eq(inventoryItems.id, id)));
}

// ------------------------------------------------------------- property costs
export async function listPropertyCosts(ownerId: number, propertyId?: number) {
  const db = await requireDb();
  const conds = [eq(propertyCosts.ownerId, ownerId)];
  if (propertyId) conds.push(eq(propertyCosts.propertyId, propertyId));
  return db.select().from(propertyCosts).where(and(...conds)).orderBy(desc(propertyCosts.competenciaInicio));
}

export async function getPropertyCost(ownerId: number, id: number) {
  const db = await requireDb();
  const [row] = await db.select().from(propertyCosts).where(and(eq(propertyCosts.ownerId, ownerId), eq(propertyCosts.id, id))).limit(1);
  return row;
}

export async function createPropertyCost(data: InsertPropertyCost) {
  const db = await requireDb();
  const res = await db.insert(propertyCosts).values(data);
  return (res as unknown as { insertId: number }[])[0]?.insertId ?? (res as unknown as { insertId: number }).insertId;
}

export async function updatePropertyCost(ownerId: number, id: number, data: Partial<InsertPropertyCost>) {
  const db = await requireDb();
  await db.update(propertyCosts).set(data).where(and(eq(propertyCosts.ownerId, ownerId), eq(propertyCosts.id, id)));
}

export async function deletePropertyCost(ownerId: number, id: number) {
  const db = await requireDb();
  await db.delete(propertyCosts).where(and(eq(propertyCosts.ownerId, ownerId), eq(propertyCosts.id, id)));
}

export async function deleteLedgerEntriesByPropertyCost(ownerId: number, propertyCostId: number) {
  const db = await requireDb();
  await db.delete(ledgerEntries).where(and(eq(ledgerEntries.ownerId, ownerId), eq(ledgerEntries.propertyCostId, propertyCostId)));
}

/**
 * Encerra a vigência de um custo em aberto na competência informada, para que o valor antigo
 * continue valendo nos meses passados. Usado quando entra um valor novo de condomínio: em vez de
 * sobrescrever o registro (o que reescreveria a DRE de meses já fechados), corta a série anterior.
 */
export function encerrarSerieAntes(competenciaInicio: string, novaCompetencia: string): number {
  const [y0, m0] = competenciaInicio.split("-").map(Number);
  const [y1, m1] = novaCompetencia.split("-").map(Number);
  return Math.max(0, y1 * 12 + (m1 - 1) - (y0 * 12 + (m0 - 1)));
}

/** Um contrato responde pela competência quando ela cai dentro da vigência (ou da renovação por prazo indeterminado). */
export function contratoCobreCompetencia(contrato: LongTermContract, competencia: string): boolean {
  const inicio = contrato.dataInicio.slice(0, 7);
  const fim = contrato.dataFim.slice(0, 7);
  if (competencia >= inicio && competencia < fim) return true;
  if (contrato.renovacaoAutomatica === "prazo_indeterminado" && contrato.prazoIndeterminadoDataInicio) {
    return competencia >= contrato.prazoIndeterminadoDataInicio.slice(0, 7);
  }
  return false;
}

/**
 * Quem paga um custo numa competência — a única fonte dessa decisão no sistema.
 *
 * Sem contrato cobrindo o mês (imóvel vago) o custo é do proprietário: não há a quem repassar.
 * Nos rateios extraordinários a responsabilidade vem do próprio registro, porque é negociada caso
 * a caso; quando ela recai sobre o inquilino, o custo segue a forma de cobrança que o contrato já
 * usa para o condomínio (direto ou junto com o aluguel).
 */
export function responsavelPeloCusto(custo: PropertyCost, contrato: LongTermContract | null): CostResponsibility {
  if (!contrato) return "proprietario";
  if (custo.tipo === "condominio_extra") {
    if (custo.responsavel !== "inquilino") return "proprietario";
    return contrato.condominioPor === "inquilino_via_repasse" ? "inquilino_via_repasse" : "inquilino_direto";
  }
  return (custo.tipo === "iptu" ? contrato.iptuPor : contrato.condominioPor) as CostResponsibility;
}

/** Custos cuja série cobre a competência, já resolvidos com quem responde por cada um. */
export async function custosDaCompetencia(ownerId: number, propertyId: number, competencia: string) {
  const custos = await listPropertyCosts(ownerId, propertyId);
  const vigentes = custos.filter((c) => competenciaNaSerie(c.competenciaInicio, c.qtdMeses, competencia));
  if (vigentes.length === 0) return [];
  const contratos = await listLongTermContracts(ownerId, propertyId);
  const contrato = contratos.find((c) => contratoCobreCompetencia(c, competencia)) ?? null;
  return vigentes.map((custo) => ({ custo, responsavel: responsavelPeloCusto(custo, contrato) }));
}

// --------------------------------------------------------- long term contracts
export async function listLongTermContracts(ownerId: number, propertyId?: number) {
  const db = await requireDb();
  const conds = [eq(longTermContracts.ownerId, ownerId)];
  if (propertyId) conds.push(eq(longTermContracts.propertyId, propertyId));
  return db.select().from(longTermContracts).where(and(...conds)).orderBy(desc(longTermContracts.createdAt));
}

export async function getLongTermContract(ownerId: number, id: number) {
  const db = await requireDb();
  const rows = await db.select().from(longTermContracts).where(and(eq(longTermContracts.ownerId, ownerId), eq(longTermContracts.id, id))).limit(1);
  return rows[0];
}

export async function createLongTermContract(data: InsertLongTermContract) {
  const db = await requireDb();
  const res = await db.insert(longTermContracts).values(data);
  return (res as unknown as { insertId: number }[])[0]?.insertId ?? (res as unknown as { insertId: number }).insertId;
}

export async function updateLongTermContract(ownerId: number, id: number, data: Partial<InsertLongTermContract>) {
  const db = await requireDb();
  await db.update(longTermContracts).set(data).where(and(eq(longTermContracts.ownerId, ownerId), eq(longTermContracts.id, id)));
}

export async function deleteLongTermContract(ownerId: number, id: number) {
  const db = await requireDb();
  await db.delete(longTermContracts).where(and(eq(longTermContracts.ownerId, ownerId), eq(longTermContracts.id, id)));
  await db.delete(contractRentCharges).where(and(eq(contractRentCharges.ownerId, ownerId), eq(contractRentCharges.contractId, id)));
}

// ---------------------------------------------------- contract rent charges
export async function listContractRentCharges(ownerId: number, contractId?: number) {
  const db = await requireDb();
  const conds = [eq(contractRentCharges.ownerId, ownerId)];
  if (contractId) conds.push(eq(contractRentCharges.contractId, contractId));
  return db.select().from(contractRentCharges).where(and(...conds)).orderBy(contractRentCharges.dataVencimento);
}

/** Parcelas de aluguel de longa duração de um imóvel numa competência específica (usado na DRE). */
export async function listContractRentChargesByProperty(ownerId: number, propertyId: number, competencia: string) {
  const db = await requireDb();
  return db
    .select()
    .from(contractRentCharges)
    .where(and(eq(contractRentCharges.ownerId, ownerId), eq(contractRentCharges.propertyId, propertyId), eq(contractRentCharges.competencia, competencia)));
}

/** Parcelas de aluguel de longa duração de TODOS os imóveis numa competência (usado no relatório de contabilidade). */
export async function listContractRentChargesByCompetencia(ownerId: number, competencia: string) {
  const db = await requireDb();
  return db
    .select()
    .from(contractRentCharges)
    .where(and(eq(contractRentCharges.ownerId, ownerId), eq(contractRentCharges.competencia, competencia)));
}

/** Parcelas de aluguel de longa duração de TODOS os imóveis num ano, usado no relatório DIMOB. */
export async function listContractRentChargesByYear(ownerId: number, ano: string) {
  const db = await requireDb();
  return db
    .select()
    .from(contractRentCharges)
    .where(and(eq(contractRentCharges.ownerId, ownerId), like(contractRentCharges.competencia, `${ano}-%`)));
}

/**
 * Parcelas efetivamente RECEBIDAS dentro do ano, pela data de recebimento.
 *
 * Diferente de `listContractRentChargesByYear`, que filtra por competência: o informe de IR segue
 * regime de caixa, então o aluguel de dezembro pago em janeiro pertence ao ano seguinte.
 */
export async function listContractRentChargesRecebidasNoAno(ownerId: number, ano: string, contractId?: number) {
  const db = await requireDb();
  const conds = [eq(contractRentCharges.ownerId, ownerId), eq(contractRentCharges.status, "recebido"), like(contractRentCharges.dataRecebimento, `${ano}-%`)];
  if (contractId) conds.push(eq(contractRentCharges.contractId, contractId));
  return db.select().from(contractRentCharges).where(and(...conds)).orderBy(contractRentCharges.dataRecebimento);
}

export async function getContractRentCharge(ownerId: number, id: number) {
  const db = await requireDb();
  const rows = await db.select().from(contractRentCharges).where(and(eq(contractRentCharges.ownerId, ownerId), eq(contractRentCharges.id, id))).limit(1);
  return rows[0];
}

export async function createContractRentCharge(data: InsertContractRentCharge) {
  const db = await requireDb();
  const res = await db.insert(contractRentCharges).values(data);
  return (res as unknown as { insertId: number }[])[0]?.insertId ?? (res as unknown as { insertId: number }).insertId;
}

export async function updateContractRentCharge(ownerId: number, id: number, data: Partial<InsertContractRentCharge>) {
  const db = await requireDb();
  await db.update(contractRentCharges).set(data).where(and(eq(contractRentCharges.ownerId, ownerId), eq(contractRentCharges.id, id)));
}

export async function deleteContractRentCharge(ownerId: number, id: number) {
  const db = await requireDb();
  await db.delete(contractRentCharges).where(and(eq(contractRentCharges.ownerId, ownerId), eq(contractRentCharges.id, id)));
}
