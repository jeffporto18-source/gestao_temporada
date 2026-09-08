import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

import { useIsMobile } from "@/hooks/useMobile";
import { LayoutDashboard, LogOut, PanelLeft, Users, Building2, Receipt, BookOpen, CalendarDays, FileText, BarChart3, Upload, UserCog, UsersRound, Landmark, UserCog2, FileSignature, Package, Wallet, TrendingUp, Truck, PieChart, ClipboardList, ClipboardCheck, ScrollText, UserRound, ShieldCheck } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { USER_TYPES } from "@/lib/userTypes";
import { trpc } from "@/lib/trpc";
import { NIVEL_ROTULO } from "./RequireEmpresa";

const allMenuItems = [
  { icon: LayoutDashboard, label: "Painel", path: "/app", hideFor: [] as string[] },
  { icon: Users, label: "Clientes", path: "/clientes", hideFor: ["holding"] },
  { icon: Building2, label: "Cadastrar Imóveis", path: "/imoveis", hideFor: [] as string[] },
  { icon: Landmark, label: "Imobiliárias", path: "/imobiliarias", hideFor: [] as string[] },
  { icon: UserCog2, label: "Gestores de Temporada", path: "/gestores-temporada", hideFor: [] as string[] },
  { icon: CalendarDays, label: "Reservas de Curta Temporada", path: "/reservas", hideFor: [] as string[] },
  { icon: FileSignature, label: "Cadastrar Contratos", path: "/contratos", hideFor: [] as string[] },
  { icon: Wallet, label: "Aluguéis a Receber", path: "/alugueis-receber", hideFor: [] as string[] },
  { icon: TrendingUp, label: "Contas a Receber", path: "/receitas", hideFor: [] as string[] },
  { icon: Receipt, label: "Contas a Pagar", path: "/despesas", hideFor: [] as string[] },
  { icon: ClipboardCheck, label: "Relatório", path: "/relatorio", hideFor: [] as string[] },
  { icon: Truck, label: "Fornecedores", path: "/fornecedores", hideFor: [] as string[] },
  { icon: BookOpen, label: "Plano de Contas", path: "/plano-contas", hideFor: [] as string[] },
  { icon: Package, label: "Inventário", path: "/inventario", hideFor: [] as string[] },
  // `somenteTotal` esconde as telas de resultado financeiro de quem não tem acesso a elas. O
  // servidor já recusa essas rotas por conta própria; esconder aqui evita oferecer ao usuário um
  // caminho que terminaria em erro.
  { icon: BarChart3, label: "DRE por Unidade", path: "/dre", hideFor: [] as string[], somenteTotal: true },
  { icon: PieChart, label: "DRE Empresa", path: "/dre-empresa", hideFor: [] as string[], somenteTotal: true },
  { icon: ClipboardList, label: "EFD Contribuições", path: "/efd-contribuicoes", hideFor: [] as string[], somenteTotal: true },
  { icon: ScrollText, label: "DIMOB", path: "/dimob", hideFor: [] as string[], somenteTotal: true },
  { icon: FileText, label: "Informe de IR", path: "/informe-ir", hideFor: [] as string[], somenteTotal: true },
  { icon: FileText, label: "Repasse ao Proprietário", path: "/repasse", hideFor: ["holding"], somenteTotal: true },
  { icon: Upload, label: "Importar CSV", path: "/importar", hideFor: [] as string[] },
  { icon: UsersRound, label: "Usuários", path: "/usuarios", hideFor: [] as string[], somenteDono: true },
  { icon: ShieldCheck, label: "Escritório", path: "/escritorio", hideFor: [] as string[], somenteAdmin: true },
  { icon: UserRound, label: "Sócios", path: "/socios", hideFor: [] as string[] },
];

function getMenuItems(userType?: string | null, nivel?: string | null, ehDono?: boolean, ehAdmin?: boolean) {
  return allMenuItems.filter((item) => {
    if (item.hideFor.includes(userType || "")) return false;
    if (item.somenteTotal && nivel !== "total") return false;
    if (item.somenteDono && !ehDono) return false;
    if (item.somenteAdmin && !ehAdmin) return false;
    return true;
  });
}

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Access to this dashboard requires authentication. Continue to launch the login flow.
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = "/login";
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const { data: empresaAtual } = trpc.empresas.atual.useQuery(undefined, { retry: false });
  const { data: minhasEmpresas } = trpc.empresas.minhas.useQuery();
  // Trocar de empresa invalida tudo que está em cache: o que estava carregado é da anterior.
  const trocarEmpresa = trpc.empresas.selecionar.useMutation({
    onSuccess: () => {
      utils.invalidate();
      window.location.reload();
    },
  });
  // O menu reflete a EMPRESA aberta, não o perfil de quem entrou: um contador holding operando um
  // cliente administradora precisa ver Clientes e Repasse, telas que o perfil dele esconderia.
  const menuItems = getMenuItems(
    empresaAtual?.userType ?? user?.userType,
    empresaAtual?.nivel,
    !user?.invitedBy,
    user?.role === "admin",
  );
  const activeMenuItem = menuItems.find(item => item.path === location);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-serif text-lg font-semibold tracking-tight truncate">
                    Temporada<span className="text-primary">.</span>
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {menuItems.map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`h-10 transition-all font-normal border-l-2 ${isActive ? "border-orange-500" : "border-transparent"}`}
                    >
                      <item.icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                      />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {USER_TYPES.find((t) => t.value === user?.userType)?.label ?? ""}
                      {user?.fiscalCategory ? " \u2022 " : ""}
                      {user?.fiscalCategory === "pj" ? "PJ" : user?.fiscalCategory === "pf_cbs_ibs" ? "PF c/ CBS/IBS" : user?.fiscalCategory === "pf_isento" ? "PF Isento" : ""}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onClick={() => setLocation("/perfil")}
                  className="cursor-pointer"
                >
                  <UserCog className="mr-2 h-4 w-4" />
                  <span>Meu Perfil</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setLocation("/onboarding")}
                  className="cursor-pointer"
                >
                  <span>Alterar classificação</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    await logout();
                    window.location.href = "/";
                  }}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sair</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-foreground">
                    {activeMenuItem?.label ?? "Menu"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Quem atende várias empresas precisa saber onde está ANTES de lançar qualquer coisa: um
            lançamento na empresa errada só aparece semanas depois, na conciliação. Por isso a
            barra é destacada, e não um detalhe discreto. Para quem atende uma empresa só ela não
            faz sentido e some por completo.

            Âmbar, não vermelho: vermelho significa erro no resto do sistema, e gastá-lo num estado
            normal faria o usuário parar de reagir a ele quando houvesse erro de verdade. Âmbar diz
            "preste atenção" sem dizer "algo deu errado". */}
        {(minhasEmpresas?.length ?? 0) > 1 && empresaAtual && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b-4 border-amber-500 bg-amber-100 px-4 py-2.5 dark:bg-amber-950/60">
            <Landmark className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
            <span className="text-sm font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
              Você está operando
            </span>
            <Select
              value={String(empresaAtual.id)}
              onValueChange={(v) => trocarEmpresa.mutate({ empresaId: Number(v) })}
            >
              <SelectTrigger className="h-9 w-auto min-w-[280px] border-2 border-amber-600 bg-white px-3 text-base font-bold text-amber-950 shadow-sm dark:bg-amber-900 dark:text-amber-50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(minhasEmpresas ?? []).map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="hidden text-xs text-amber-800 dark:text-amber-300 sm:inline">
              troque aqui para ver outra empresa
            </span>
            {empresaAtual.nivel !== "total" && (
              <span className="rounded border border-amber-700 bg-amber-200 px-2 py-0.5 text-xs font-bold uppercase text-amber-900 dark:bg-amber-800 dark:text-amber-100">
                {NIVEL_ROTULO[empresaAtual.nivel] ?? empresaAtual.nivel}
              </span>
            )}
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>
    </>
  );
}
