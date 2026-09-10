import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Login from "./pages/Login";
import Cadastro from "./pages/Cadastro";
import Painel from "./pages/Painel";
import Clientes from "./pages/Clientes";
import Imoveis from "./pages/Imoveis";
import Imobiliarias from "./pages/Imobiliarias";
import GestoresTemporada from "./pages/GestoresTemporada";
import Contratos from "./pages/Contratos";
import AlugueisReceber from "./pages/AlugueisReceber";
import Inventario from "./pages/Inventario";
import Receitas from "./pages/Receitas";
import Despesas from "./pages/Despesas";
import Relatorio from "./pages/Relatorio";
import Aportes from "./pages/Aportes";
import RepasseCaucao from "./pages/RepasseCaucao";
import Fornecedores from "./pages/Fornecedores";
import Socios from "./pages/Socios";
import PlanoContas from "./pages/PlanoContas";
import Reservas from "./pages/Reservas";
import Dre from "./pages/Dre";
import DreEmpresa from "./pages/DreEmpresa";
import EfdContribuicoes from "./pages/EfdContribuicoes";
import Dimob from "./pages/Dimob";
import InformeIr from "./pages/InformeIr";
import Repasse from "./pages/Repasse";
import ImportarCsv from "./pages/ImportarCsv";
import Onboarding from "./pages/Onboarding";
import Perfil from "./pages/Perfil";
import Usuarios from "./pages/Usuarios";
import Escritorio from "./pages/Escritorio";
import { useAuth } from "@/_core/hooks/useAuth";
import { DashboardLayoutSkeleton } from "./components/DashboardLayoutSkeleton";
import RequireEmpresa from "./components/RequireEmpresa";

/** Redireciona para / (cadastro) se não autenticado, e para /onboarding se não escolheu perfil */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) return <DashboardLayoutSkeleton />;
  if (!isAuthenticated) return <Redirect to="/" />;

  // A escolha de perfil descreve a EMPRESA (holding, administradora, gestor). Só quem está criando
  // a própria empresa responde isso — um funcionário convidado herda a empresa de quem o convidou,
  // e perguntar a ele fazia com que marcasse um perfil qualquer, que depois valia como se fosse da
  // empresa dele.
  if (!user?.userType && !user?.invitedBy) {
    return <Redirect to="/onboarding" />;
  }

  // Toda tela de dados opera uma empresa específica. Quem atende mais de uma escolhe antes de
  // entrar; sem isso o servidor recusaria as consultas, e a tela apareceria quebrada em vez de
  // pedir a escolha.
  return <RequireEmpresa>{children}</RequireEmpresa>;
}

/** Redireciona usuários já autenticados para o painel (evita ver tela de login/cadastro) */
function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) return <DashboardLayoutSkeleton />;
  if (isAuthenticated) {
    // Mesma regra do RequireAuth: convidado não escolhe perfil de empresa.
    if (!user?.userType && !user?.invitedBy) return <Redirect to="/onboarding" />;
    return <Redirect to="/painel" />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Switch>
            {/* Primeira tela: cadastro */}
            <Route path="/">
              <GuestOnly><Cadastro /></GuestOnly>
            </Route>
            <Route path="/login">
              <GuestOnly><Login /></GuestOnly>
            </Route>
            <Route path="/cadastro">
              <GuestOnly><Cadastro /></GuestOnly>
            </Route>

            {/* Segunda tela: escolha de perfil */}
            <Route path="/onboarding" component={Onboarding} />

            {/* Painel principal (requer auth + perfil) */}
            <Route path="/painel">
              <RequireAuth>
                <DashboardLayout><Painel /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/app">
              <RequireAuth>
                <DashboardLayout><Painel /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/clientes">
              <RequireAuth>
                <DashboardLayout><Clientes /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/imoveis">
              <RequireAuth>
                <DashboardLayout><Imoveis /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/imobiliarias">
              <RequireAuth>
                <DashboardLayout><Imobiliarias /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/gestores-temporada">
              <RequireAuth>
                <DashboardLayout><GestoresTemporada /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/reservas">
              <RequireAuth>
                <DashboardLayout><Reservas /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/contratos">
              <RequireAuth>
                <DashboardLayout><Contratos /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/alugueis-receber">
              <RequireAuth>
                <DashboardLayout><AlugueisReceber /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/receitas">
              <RequireAuth>
                <DashboardLayout><Receitas /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/despesas">
              <RequireAuth>
                <DashboardLayout><Despesas /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/relatorio">
              <RequireAuth>
                <DashboardLayout><Relatorio /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/aportes">
              <RequireAuth>
                <DashboardLayout><Aportes /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/repasse-caucao">
              <RequireAuth>
                <DashboardLayout><RepasseCaucao /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/fornecedores">
              <RequireAuth>
                <DashboardLayout><Fornecedores /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/socios">
              <RequireAuth>
                <DashboardLayout><Socios /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/plano-contas">
              <RequireAuth>
                <DashboardLayout><PlanoContas /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/inventario">
              <RequireAuth>
                <DashboardLayout><Inventario /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/dre">
              <RequireAuth>
                <DashboardLayout><Dre /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/dre-empresa">
              <RequireAuth>
                <DashboardLayout><DreEmpresa /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/efd-contribuicoes">
              <RequireAuth>
                <DashboardLayout><EfdContribuicoes /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/dimob">
              <RequireAuth>
                <DashboardLayout><Dimob /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/informe-ir">
              <RequireAuth>
                <DashboardLayout><InformeIr /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/escritorio">
              <RequireAuth>
                <DashboardLayout><Escritorio /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/repasse">
              <RequireAuth>
                <DashboardLayout><Repasse /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/importar">
              <RequireAuth>
                <DashboardLayout><ImportarCsv /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/perfil">
              <RequireAuth>
                <DashboardLayout><Perfil /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/usuarios">
              <RequireAuth>
                <DashboardLayout><Usuarios /></DashboardLayout>
              </RequireAuth>
            </Route>
            <Route path="/404" component={NotFound} />
            <Route component={NotFound} />
          </Switch>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
