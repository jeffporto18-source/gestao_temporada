import { describe, expect, it } from "vitest";

import { contratoCobreCompetencia, encerrarSerieAntes, responsavelPeloCusto } from "./db";
import type { LongTermContract, Property, PropertyCost } from "../drizzle/schema";

function custo(over: Partial<PropertyCost> = {}): PropertyCost {
  return {
    id: 1,
    ownerId: 1,
    propertyId: 10,
    tipo: "condominio",
    valor: "800.00",
    competenciaInicio: "2026-01",
    qtdMeses: 12,
    dia: 10,
    descricao: null,
    responsavel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as PropertyCost;
}

function contrato(over: Partial<LongTermContract> = {}): LongTermContract {
  return {
    id: 1,
    ownerId: 1,
    propertyId: 10,
    dataInicio: "2026-03-01",
    dataFim: "2027-03-01",
    condominioPor: "proprietario",
    iptuPor: "proprietario",
    renovacaoAutomatica: null,
    prazoIndeterminadoDataInicio: null,
    ...over,
  } as LongTermContract;
}

function imovel(over: Partial<Property> = {}): Pick<Property, "condominioPorPadrao" | "iptuPorPadrao"> {
  return { condominioPorPadrao: "proprietario", iptuPorPadrao: "proprietario", ...over };
}

describe("contratoCobreCompetencia", () => {
  it("cobre os meses entre o início e o fim, sem incluir o mês do encerramento", () => {
    const c = contrato();
    expect(contratoCobreCompetencia(c, "2026-02")).toBe(false);
    expect(contratoCobreCompetencia(c, "2026-03")).toBe(true);
    expect(contratoCobreCompetencia(c, "2027-02")).toBe(true);
    expect(contratoCobreCompetencia(c, "2027-03")).toBe(false);
  });

  it("segue cobrindo depois do fim quando houve renovação por prazo indeterminado", () => {
    const c = contrato({ renovacaoAutomatica: "prazo_indeterminado", prazoIndeterminadoDataInicio: "2027-03-01" });
    expect(contratoCobreCompetencia(c, "2027-03")).toBe(true);
    expect(contratoCobreCompetencia(c, "2030-08")).toBe(true);
  });
});

describe("responsavelPeloCusto", () => {
  it("sem contrato, usa o padrão cadastrado no imóvel", () => {
    expect(responsavelPeloCusto(custo(), null, imovel())).toBe("proprietario");
    expect(responsavelPeloCusto(custo({ tipo: "iptu" }), null, imovel())).toBe("proprietario");
    expect(responsavelPeloCusto(custo(), null, imovel({ condominioPorPadrao: "inquilino_direto" }))).toBe("inquilino_direto");
    expect(responsavelPeloCusto(custo({ tipo: "iptu" }), null, imovel({ iptuPorPadrao: "inquilino_direto" }))).toBe("inquilino_direto");
  });

  it("com contrato, o campo do contrato manda mesmo que o padrão do imóvel diga outra coisa", () => {
    const c = contrato({ condominioPor: "inquilino_via_repasse", iptuPor: "inquilino_direto" });
    const im = imovel({ condominioPorPadrao: "inquilino_direto", iptuPorPadrao: "proprietario" });
    expect(responsavelPeloCusto(custo({ tipo: "condominio" }), c, im)).toBe("inquilino_via_repasse");
    expect(responsavelPeloCusto(custo({ tipo: "iptu" }), c, im)).toBe("inquilino_direto");
  });

  it("não confunde condomínio com IPTU quando as responsabilidades divergem", () => {
    const c = contrato({ condominioPor: "inquilino_direto", iptuPor: "proprietario" });
    expect(responsavelPeloCusto(custo({ tipo: "condominio" }), c, imovel())).toBe("inquilino_direto");
    expect(responsavelPeloCusto(custo({ tipo: "iptu" }), c, imovel())).toBe("proprietario");
  });

  it("mantém o rateio extraordinário no proprietário mesmo quando a mensalidade é do inquilino", () => {
    const c = contrato({ condominioPor: "inquilino_via_repasse" });
    const rateio = custo({ tipo: "condominio_extra", responsavel: "proprietario", descricao: "Rateio de obra" });
    expect(responsavelPeloCusto(rateio, c, imovel())).toBe("proprietario");
  });

  it("cobra o rateio do inquilino pela mesma forma que o contrato usa para o condomínio", () => {
    const rateio = custo({ tipo: "condominio_extra", responsavel: "inquilino" });
    expect(responsavelPeloCusto(rateio, contrato({ condominioPor: "inquilino_via_repasse" }), imovel())).toBe("inquilino_via_repasse");
    expect(responsavelPeloCusto(rateio, contrato({ condominioPor: "inquilino_direto" }), imovel())).toBe("inquilino_direto");
  });

  it("trata rateio sem responsável definido como despesa do proprietário", () => {
    const rateio = custo({ tipo: "condominio_extra", responsavel: null });
    expect(responsavelPeloCusto(rateio, contrato({ condominioPor: "inquilino_via_repasse" }), imovel())).toBe("proprietario");
  });

  it("rateio extraordinário sem contrato é sempre do proprietário, independente do padrão do imóvel", () => {
    const rateio = custo({ tipo: "condominio_extra", responsavel: "inquilino" });
    expect(responsavelPeloCusto(rateio, null, imovel({ condominioPorPadrao: "inquilino_direto" }))).toBe("proprietario");
  });
});

describe("encerrarSerieAntes", () => {
  it("corta a série anterior no mês em que o valor novo passa a valer", () => {
    // Condomínio começou em janeiro; valor novo entra em abril: a série antiga cobre jan, fev, mar.
    expect(encerrarSerieAntes("2026-01", "2026-04")).toBe(3);
  });

  it("zera a série quando o valor novo começa antes dela", () => {
    expect(encerrarSerieAntes("2026-06", "2026-01")).toBe(0);
  });

  it("atravessa a virada de ano", () => {
    expect(encerrarSerieAntes("2025-11", "2026-02")).toBe(3);
  });
});
