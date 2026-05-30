import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  LayoutDashboard,
  MessageCircle,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
  Star,
  UsersRound,
  WalletCards,
  Lock,
  Smartphone,
  Percent,
} from "lucide-react";
import { CookieBanner } from "@/components/cookie-banner";
import { APP_BRAND } from "@/lib/app-brand";

const seoTitle =
  "Software de gestão para estética, manicure, beleza e barbearia | Agenda online";
const seoDescription =
  "SaaS mobile-first para estúdios de estética, manicure, nail design, beleza e barbearias. Agenda online, clientes, financeiro, sinais, WhatsApp e página pública.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: seoTitle },
      { name: "description", content: seoDescription },
      {
        name: "keywords",
        content:
          "software para estética, sistema para salão, sistema para barbearia, agenda para manicure, gestão de estúdio, software de agendamento, sistema para clínicas estéticas, agenda online, sistema de marcação online Portugal",
      },
      { property: "og:title", content: seoTitle },
      { property: "og:description", content: seoDescription },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "pt_PT" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "index,follow,max-image-preview:large" },
      { name: "theme-color", content: "#0f1218" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: LandingPage,
});

function LandingPage() {
  const [activeTab, setActiveTab] = useState<"agenda" | "financeiro" | "clientes" | "whatsapp">("agenda");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const faqs = [
    {
      question: "Como funciona o teste gratuito de 14 dias?",
      answer: "Tem acesso total e sem restrições a todos os recursos da plataforma durante 14 dias. Não precisa de introduzir cartão de crédito para começar. Se gostar, pode ativar a sua assinatura a qualquer momento durante ou após o teste.",
    },
    {
      question: "Posso cobrar sinais/pagamentos antecipados para evitar faltas?",
      answer: "Sim! A plataforma integra diretamente com o Stripe, permitindo-lhe definir um valor de sinal (por exemplo, 30%, 50% ou o valor total) que o cliente paga obrigatoriamente para confirmar a marcação. Isso reduz os no-shows a praticamente zero.",
    },
    {
      question: "O painel funciona bem em telemóveis e tablets?",
      answer: "Absolutamente. O sistema foi desenvolvido com uma filosofia 100% mobile-first. Funciona perfeitamente como uma aplicação premium no seu iPhone, Android ou tablet, além do computador, permitindo-lhe gerir o seu estúdio onde quer que esteja.",
    },
    {
      question: "O plano único tem limite de profissionais, serviços ou clientes?",
      answer: "Não, nenhum. Ao contrário de outros softwares que cobram taxas extras por cada profissional na equipa, o nosso plano único dá-lhe acesso totalmente ilimitado: profissionais ilimitados, clientes ilimitados e marcações ilimitadas.",
    },
    {
      question: "A plataforma está em conformidade com o RGPD em Portugal?",
      answer: "Sim. A nossa base tecnológica está totalmente preparada para o RGPD (GDPR). Oferecemos ferramentas para consentimento explícito dos clientes no momento da marcação, armazenamento seguro e eliminação de dados de forma simples e legal.",
    },
  ];

  const testimonials = [
    {
      quote: "A agenda inteligente mudou o meu dia a dia. As clientes adoram a facilidade de marcar sozinhas e o controlo de sinais pelo Stripe reduziu as faltas a zero.",
      author: "Cláudia Rodrigues",
      role: "Fundadora, Glow Studio Aesthetics",
      location: "Lisboa",
      rating: 5,
    },
    {
      quote: "Com a equipa a crescer, outros sistemas ficavam caríssimos por utilizador. O plano único com profissionais ilimitados foi a melhor decisão financeira que tomei.",
      author: "Daniel Cruz",
      role: "Diretor Criativo, Barber Concept",
      location: "Porto",
      rating: 5,
    },
    {
      quote: "O link de marcação pública é lindo e super rápido. As minhas clientes fazem tudo no telemóvel em segundos. O lembrete automático do WhatsApp poupa-me horas de chat.",
      author: "Rita Santos",
      role: "Nail Artist & Formadora",
      location: "Braga",
      rating: 5,
    },
  ];

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  const softwareSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: APP_BRAND.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iOS, Android",
    description: seoDescription,
    offers: { "@type": "Offer", price: "29", priceCurrency: "EUR" },
    areaServed: "PT",
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#fcfaf7] text-[#12151d] font-sans antialiased dark:bg-[#0f1218] dark:text-[#f8fafc]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      {/* HEADER TRANSLÚCIDO E PREMIUM */}
      <header className="sticky top-0 z-50 border-b border-[#12151d]/5 bg-[#fcfaf7]/80 px-6 py-4 backdrop-blur-md transition-all dark:border-[#f8fafc]/5 dark:bg-[#0f1218]/80">
        <nav className="mx-auto flex max-w-6xl items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 font-bold tracking-tight text-[#12151d] dark:text-white" aria-label="Início">
            <span className="grid size-9 place-items-center rounded-xl bg-[#12151d] text-[#fcfaf7] dark:bg-white dark:text-[#0f1218]">
              <Sparkles className="size-4.5" />
            </span>
            <span className="text-lg font-black">{APP_BRAND.name}</span>
          </Link>
          
          <div className="hidden items-center gap-8 rounded-full border border-[#12151d]/5 bg-white/40 px-6 py-2 text-sm font-medium text-[#5f6470] shadow-sm md:flex dark:border-[#f8fafc]/5 dark:bg-white/[0.02] dark:text-[#a1a1aa]">
            <a href="#produto" className="transition hover:text-[#12151d] dark:hover:text-white">Produto</a>
            <a href="#funcionalidades" className="transition hover:text-[#12151d] dark:hover:text-white">Funcionalidades</a>
            <a href="#planos" className="transition hover:text-[#12151d] dark:hover:text-white">Preço Único</a>
            <a href="#faq" className="transition hover:text-[#12151d] dark:hover:text-white">FAQ</a>
          </div>
          
          <div className="flex items-center gap-3">
            <Link to="/login" className="rounded-full px-4 py-2 text-sm font-semibold text-[#5f6470] transition hover:text-[#12151d] dark:text-[#a1a1aa] dark:hover:text-white">
              Entrar
            </Link>
            <Link to="/signup" className="inline-flex h-10 items-center justify-center rounded-full bg-[#12151d] px-5 text-sm font-bold text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 dark:bg-white dark:text-[#0f1218]">
              Teste grátis
            </Link>
          </div>
        </nav>
      </header>

      {/* HERO SECTION DE ALTO IMPACTO */}
      <section className="relative px-6 pb-20 pt-16 md:pb-28 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-[40rem] max-w-6xl rounded-full bg-[radial-gradient(circle,rgba(176,119,76,0.12),transparent_70%)] blur-3xl" />
        
        <div className="relative mx-auto max-w-6xl text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#12151d]/8 bg-white/80 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[#666b75] shadow-sm backdrop-blur dark:border-[#f8fafc]/8 dark:bg-white/[0.03] dark:text-[#a1a1aa]">
            <span className="size-2 rounded-full bg-accent animate-pulse" />
            Software de Agendamento Premium para Portugal
          </div>
          
          <h1 className="mx-auto mt-6 max-w-4xl text-balance text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl md:text-6xl lg:text-[4.5rem]">
            A agenda que preenche o seu dia. O painel que <span className="text-accent">liberta o seu tempo.</span>
          </h1>
          
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-[#5f6470] sm:text-lg dark:text-[#a1a1aa]">
            Agenda inteligente, pagamentos automáticos de sinais, gestão de equipa e alertas via WhatsApp. Tudo num painel premium e mobile-first, desenhado para profissionais de estética, manicure e barbearia.
          </p>
          
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link to="/signup" className="group inline-flex h-12 w-full items-center justify-center rounded-full bg-[#12151d] px-7 text-base font-bold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[#1f2430] sm:w-auto dark:bg-white dark:text-[#0f1218] dark:hover:bg-slate-100">
              Começar Teste de 14 Dias <ArrowRight className="ml-2.5 size-4 transition group-hover:translate-x-0.5" />
            </Link>
            <a href="#produto" className="inline-flex h-12 w-full items-center justify-center rounded-full border border-[#12151d]/8 bg-white/70 px-7 text-base font-semibold text-[#12151d] shadow-sm transition hover:-translate-y-0.5 hover:bg-white sm:w-auto dark:border-[#f8fafc]/8 dark:bg-white/[0.02] dark:text-white dark:hover:bg-white/[0.05]">
              Ver Demonstração
            </a>
          </div>
          
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs font-bold text-[#666b75] dark:text-[#a1a1aa]">
            <span className="flex items-center gap-1.5"><Check className="size-4 text-accent" /> Sem cartão de crédito</span>
            <span className="flex items-center gap-1.5"><Check className="size-4 text-accent" /> Configuração em 2 minutos</span>
            <span className="flex items-center gap-1.5"><Check className="size-4 text-accent" /> Cancele quando quiser</span>
          </div>

          {/* MOCKUP INTERATIVO DE ALTA FIDELIDADE */}
          <div id="produto" className="mx-auto mt-16 max-w-5xl md:mt-24">
            <div className="rounded-3xl border border-[#12151d]/10 bg-white/40 p-3 shadow-2xl backdrop-blur-sm dark:border-[#f8fafc]/5 dark:bg-white/[0.01]">
              <div className="overflow-hidden rounded-[1.6rem] border border-[#12151d]/8 bg-[#0c0e12] text-white shadow-inner">
                {/* Janela de Navegação / Header do Mockup */}
                <div className="flex flex-col border-b border-white/8 px-6 py-4 sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-xl bg-white/[0.06] text-accent">
                      <Sparkles className="size-3.8" />
                    </span>
                    <div className="text-left">
                      <p className="text-[9px] uppercase tracking-[0.24em] text-white/40 font-bold">Painel de Gestão</p>
                      <p className="text-sm font-black tracking-tight">Estúdio Essence Premium</p>
                    </div>
                  </div>
                  
                  {/* Abas de Navegação Interativa */}
                  <div className="flex flex-wrap gap-1 rounded-xl bg-white/[0.05] p-1 self-start sm:self-center">
                    {(["agenda", "financeiro", "clientes", "whatsapp"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`rounded-lg px-3.5 py-1.5 text-xs font-bold capitalize transition-all ${
                          activeTab === tab
                            ? "bg-[#b0774c] text-white shadow-sm"
                            : "text-white/60 hover:bg-white/[0.03] hover:text-white"
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  <div className="hidden items-center gap-1.5 sm:flex">
                    <span className="size-2.5 rounded-full bg-[#ff5f56]" />
                    <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
                    <span className="size-2.5 rounded-full bg-[#27c93f]" />
                  </div>
                </div>

                {/* Conteúdo Dinâmico com Transições Elegantes */}
                <div className="min-h-[22rem] p-6 text-left">
                  {activeTab === "agenda" && (
                    <div className="animate-fade-in">
                      <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                          <h3 className="text-lg font-black">Agenda do Dia</h3>
                          <p className="text-xs text-white/50">Gerencie seus compromissos e horários disponíveis</p>
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-xl bg-white/[0.06] px-3.5 py-1.5 text-xs font-bold text-accent">
                          <CalendarCheck className="size-4" /> Sexta-feira, Hoje
                        </div>
                      </div>
                      
                      <div className="grid gap-3">
                        {[
                          { time: "09:00 - 10:00", service: "Design de Sobrancelhas de Linha", client: "Ana Margarida Silva", status: "Confirmado", prof: "Cláudia Costa", color: "border-l-4 border-emerald-500 bg-emerald-500/5 text-emerald-300" },
                          { time: "10:30 - 12:00", service: "Aplicação Unhas de Gel (Manutenção)", client: "Sofia Costa Martins", status: "Sinal Pago via Stripe", prof: "Maria Vieira", color: "border-l-4 border-[#b0774c] bg-[#b0774c]/5 text-[#e8ccb1]" },
                          { time: "13:30 - 14:00", service: "Massagem Facial Express", client: "Rita Santos Leite", status: "Confirmado", prof: "Cláudia Costa", color: "border-l-4 border-emerald-500 bg-emerald-500/5 text-emerald-300" },
                          { time: "14:30 - 15:30", service: "Lifting de Pestanas + Hidratação", client: "Mariana Alencar", status: "Aguardando confirmação", prof: "Maria Vieira", color: "border-l-4 border-yellow-500 bg-yellow-500/5 text-yellow-300" },
                        ].map((item, i) => (
                          <div key={i} className={`flex flex-col justify-between gap-3 rounded-2xl p-4 sm:flex-row sm:items-center ${item.color}`}>
                            <div className="flex items-start gap-4">
                              <span className="mt-0.5 text-xs font-black tracking-wide text-white/80">{item.time}</span>
                              <div>
                                <h4 className="text-sm font-bold text-white">{item.service}</h4>
                                <p className="text-xs text-white/60">Cliente: <strong className="text-white/90">{item.client}</strong> • Profissional: {item.prof}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                                {item.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeTab === "financeiro" && (
                    <div className="animate-fade-in space-y-6">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                          <h3 className="text-lg font-black">Resumo Financeiro</h3>
                          <p className="text-xs text-white/50">Fluxo de caixa em tempo real, sinais e receita</p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-white/40">Faturação Prevista (Este Mês)</span>
                          <p className="text-xl font-black text-emerald-400">4.280,00€</p>
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                          <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Receita Confirmada</span>
                          <p className="mt-2 text-2xl font-black text-white">1.840,00€</p>
                          <span className="mt-1 inline-flex items-center text-[10px] text-emerald-400 font-bold">
                            +12.4% vs semana anterior
                          </span>
                        </div>
                        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                          <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Sinais Online (Stripe)</span>
                          <p className="mt-2 text-2xl font-black text-[#e8ccb1]">620,00€</p>
                          <span className="mt-1 inline-flex items-center text-[10px] text-accent font-bold">
                            No-shows reduzidos a 0%
                          </span>
                        </div>
                        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                          <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Pagamento Presencial</span>
                          <p className="mt-2 text-2xl font-black text-white">1.220,00€</p>
                          <span className="mt-1 inline-flex items-center text-[10px] text-white/40 font-bold">
                            Recebido em dinheiro/TPA
                          </span>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                        <h4 className="mb-3 text-xs font-black uppercase tracking-wider text-white/50">Transações Recentes</h4>
                        <div className="space-y-2">
                          {[
                            { name: "Sofia Costa Martins", desc: "Sinal Pago via Cartão (Stripe)", val: "+15,00€", time: "Há 10 minutos" },
                            { name: "Joana Albuquerque", desc: "Pagamento Presencial (MBWay)", val: "+45,00€", time: "Há 45 minutos" },
                            { name: "Maria Clara Abreu", desc: "Sinal Pago via Cartão (Stripe)", val: "+22,50€", time: "Há 1 hora" },
                          ].map((t, idx) => (
                            <div key={idx} className="flex items-center justify-between rounded-xl bg-white/[0.03] p-3 text-xs">
                              <div>
                                <p className="font-bold">{t.name}</p>
                                <p className="text-white/40 text-[11px]">{t.desc} • {t.time}</p>
                              </div>
                              <span className="font-black text-emerald-400">{t.val}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === "clientes" && (
                    <div className="animate-fade-in space-y-6">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                          <h3 className="text-lg font-black">Histórico de Clientes</h3>
                          <p className="text-xs text-white/50">Base de dados completa dos seus clientes</p>
                        </div>
                        <div className="w-full max-w-[200px]">
                          <input
                            type="text"
                            disabled
                            placeholder="Procurar cliente..."
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs text-white/70 outline-none"
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        {[
                          {
                            name: "Ana Margarida Silva",
                            vip: true,
                            phone: "+351 912 345 678",
                            visits: "14 visitas este ano",
                            notes: "Prefere verniz de tom bronze e produtos sem fragrância intensa. Sempre pontual.",
                          },
                          {
                            name: "Sofia Costa Martins",
                            vip: false,
                            phone: "+351 934 567 890",
                            visits: "8 visitas este ano",
                            notes: "Alérgica a produtos com acetona. Costuma marcar as unhas de gel com a profissional Maria.",
                          },
                        ].map((c, i) => (
                          <div key={i} className="rounded-2xl border border-white/5 bg-white/[0.03] p-5 space-y-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="text-sm font-bold flex items-center gap-2">
                                  {c.name}
                                  {c.vip && (
                                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-accent">
                                      VIP
                                    </span>
                                  )}
                                </h4>
                                <p className="text-[11px] text-white/40">{c.phone}</p>
                              </div>
                              <span className="text-[11px] font-bold text-white/60">{c.visits}</span>
                            </div>
                            <div className="rounded-xl bg-white/[0.03] p-3 text-xs leading-relaxed text-white/70">
                              <span className="font-bold text-white/45">Notas da Ficha:</span> {c.notes}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeTab === "whatsapp" && (
                    <div className="animate-fade-in">
                      <div className="mb-6">
                        <h3 className="text-lg font-black">Notificações por WhatsApp</h3>
                        <p className="text-xs text-white/50">Lembretes automáticos enviados diretamente às clientes</p>
                      </div>

                      {/* Mockup de Telemóvel/Mensagem */}
                      <div className="mx-auto max-w-sm rounded-[2rem] border-8 border-white/10 bg-[#0e1117] p-3.5 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-white/5 pb-2 text-[10px] text-white/40">
                          <span>WhatsApp Business</span>
                          <span className="font-bold text-accent">Charm Auto-Notifier</span>
                        </div>
                        
                        <div className="space-y-4 py-4">
                          {/* Mensagem do Sistema */}
                          <div className="relative max-w-[85%] rounded-2xl bg-[#1f2c34] p-3.5 text-xs text-white leading-relaxed shadow-sm">
                            <p>
                              Olá <strong>Sofia</strong>! Confirmamos a sua marcação de <strong>Unhas de Gel (Manutenção)</strong> com a Prof. Cláudia para amanhã, <strong>Sábado às 10:30</strong>.
                            </p>
                            <p className="mt-2 text-white/70">
                              Se precisar de gerir, alterar ou reagendar a sua marcação, utilize o seu link exclusivo:
                            </p>
                            <p className="mt-1 text-accent font-bold underline break-all">
                              essence.charm.pt/s/sofia-gel
                            </p>
                            <span className="absolute bottom-1 right-2 text-[9px] text-white/40">18:02</span>
                          </div>

                          {/* Resposta do Cliente */}
                          <div className="relative left-[15%] max-w-[85%] rounded-2xl bg-[#005c4b] p-3.5 text-xs text-white leading-relaxed shadow-sm">
                            <p>
                              Maravilhoso! Muito obrigada pela confirmação automática, este lembrete deu-me muito jeito. Até amanhã! 😊
                            </p>
                            <span className="absolute bottom-1 right-2 text-[9px] text-white/40">18:05</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* METRICAS DE TRAÇÃO E VALOR */}
      <section className="border-y border-[#12151d]/5 bg-white/40 px-6 py-12 dark:border-white/5 dark:bg-white/[0.01]">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-2 gap-8 text-center md:grid-cols-4">
            <div className="space-y-2">
              <p className="text-3xl font-black text-[#12151d] md:text-4xl dark:text-white">+100 mil</p>
              <p className="text-xs font-black uppercase tracking-wider text-[#666b75] dark:text-[#a1a1aa]">Marcações Realizadas</p>
            </div>
            <div className="space-y-2">
              <p className="text-3xl font-black text-accent md:text-4xl">0%</p>
              <p className="text-xs font-black uppercase tracking-wider text-[#666b75] dark:text-[#a1a1aa]">Ausências (Sinais Stripe)</p>
            </div>
            <div className="space-y-2">
              <p className="text-3xl font-black text-[#12151d] md:text-4xl dark:text-white">100%</p>
              <p className="text-xs font-black uppercase tracking-wider text-[#666b75] dark:text-[#a1a1aa]">Preparado para o RGPD</p>
            </div>
            <div className="space-y-2">
              <p className="text-3xl font-black text-[#12151d] md:text-4xl dark:text-white">14 dias</p>
              <p className="text-xs font-black uppercase tracking-wider text-[#666b75] dark:text-[#a1a1aa]">Teste Sem Compromisso</p>
            </div>
          </div>
        </div>
      </section>

      {/* FUNCIONALIDADES / GRID BENTO PREMIUM */}
      <section id="funcionalidades" className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-accent">Tudo Integrado</p>
          <h2 className="mt-3 text-balance text-3xl font-black leading-tight tracking-tight sm:text-4xl md:text-5xl">
            Uma base robusta e moderna desenhada para o seu negócio de estética.
          </h2>
          <p className="mt-4 text-[#5f6470] dark:text-[#a1a1aa]">
            Esqueça as dezenas de ferramentas avulsas e as folhas soltas. Centralize tudo num único sistema moderno que trabalha para si.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Card 1: Bento Big */}
          <div className="group md:col-span-2 rounded-[2rem] border border-[#12151d]/5 bg-white p-8 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md dark:border-[#f8fafc]/5 dark:bg-white/[0.02]">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
              <div className="space-y-4 max-w-md">
                <div className="grid size-11 place-items-center rounded-2xl bg-[#b0774c]/10 text-accent">
                  <CalendarCheck className="size-5.5" />
                </div>
                <h3 className="text-xl font-black">Agenda Inteligente & Controlo de Equipas</h3>
                <p className="text-sm leading-relaxed text-[#5f6470] dark:text-[#a1a1aa]">
                  Configure turnos de trabalho, folgas e bloqueios. O sistema cruza a disponibilidade dos profissionais com a duração de cada serviço para evitar marcações sobrepostas de forma 100% autónoma.
                </p>
                <ul className="grid gap-2 text-xs font-bold text-[#666b75] dark:text-[#a1a1aa]">
                  <li className="flex items-center gap-2"><Check className="size-4 text-accent" /> Calendário semanal visualmente rico</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-accent" /> Gestão multi-profissional em simultâneo</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-accent" /> Bloqueios de férias e pausas instantâneas</li>
                </ul>
              </div>
              <div className="w-full flex-1 rounded-2xl bg-[#0c0e12] p-4 text-xs font-mono text-white/80 select-none shadow-inner border border-white/5">
                <span className="text-[10px] text-white/40 block mb-2 font-sans font-bold">FLUXO DE DISPONIBILIDADE</span>
                <div className="space-y-2 font-sans">
                  <div className="rounded-xl bg-white/[0.04] p-3">
                    <p className="font-bold text-white text-xs">Corte de Cabelo Premium (45 min)</p>
                    <p className="text-[11px] text-[#e8ccb1]">Profissional: Daniel • Disponível: 15:00, 16:30, 17:15</p>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] p-3 border border-emerald-500/20 bg-emerald-500/[0.02]">
                    <p className="font-bold text-emerald-400 text-xs">Unha de Gel Manutenção (90 min)</p>
                    <p className="text-[11px] text-white/60">Profissional: Maria • Disponível: 09:30, 14:00</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Bento Medium */}
          <div className="group rounded-[2rem] border border-[#12151d]/5 bg-white p-8 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md dark:border-[#f8fafc]/5 dark:bg-white/[0.02]">
            <div className="space-y-4">
              <div className="grid size-11 place-items-center rounded-2xl bg-[#b0774c]/10 text-accent">
                <MonitorSmartphone className="size-5.5" />
              </div>
              <h3 className="text-xl font-black">Página Pública de Agendamento</h3>
              <p className="text-sm leading-relaxed text-[#5f6470] dark:text-[#a1a1aa]">
                Ofereça um link premium e personalizado para que as suas clientes marquem sozinhas 24 horas por dia, 7 dias por semana, diretamente pelo Instagram, WhatsApp ou Google.
              </p>
              <div className="pt-2">
                <div className="rounded-2xl border border-[#12151d]/8 bg-[#fcfaf7] p-3 text-center shadow-inner dark:border-white/5 dark:bg-white/[0.04]">
                  <p className="text-[10px] font-bold text-accent">VISÃO DA CLIENTE</p>
                  <p className="text-xs font-black mt-1">essence.charm.pt</p>
                  <div className="mt-3 inline-flex items-center justify-center rounded-full bg-[#12151d] text-white px-4 py-1.5 text-[10px] font-bold dark:bg-white dark:text-[#0f1218]">
                    Agendar Serviço
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Bento Medium */}
          <div className="group rounded-[2rem] border border-[#12151d]/5 bg-white p-8 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md dark:border-[#f8fafc]/5 dark:bg-white/[0.02]">
            <div className="space-y-4">
              <div className="grid size-11 place-items-center rounded-2xl bg-[#b0774c]/10 text-accent">
                <WalletCards className="size-5.5" />
              </div>
              <h3 className="text-xl font-black">Sinais Online & Stripe</h3>
              <p className="text-sm leading-relaxed text-[#5f6470] dark:text-[#a1a1aa]">
                Garante que os agendamentos são honrados. Defina o pagamento antecipado obrigatório de um sinal (valor ou percentagem do serviço) processado de forma 100% segura por cartão de crédito.
              </p>
              <div className="pt-2">
                <div className="flex items-center gap-3 rounded-2xl bg-[#0c0e12] p-3 text-xs text-white">
                  <div className="grid size-9 place-items-center rounded-lg bg-white/10 text-accent">
                    <Lock className="size-4" />
                  </div>
                  <div>
                    <p className="font-bold">Pagamento Seguro</p>
                    <p className="text-[10px] text-white/40">Integrado diretamente com Stripe</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: Bento Big */}
          <div className="group md:col-span-2 rounded-[2rem] border border-[#12151d]/5 bg-white p-8 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md dark:border-[#f8fafc]/5 dark:bg-white/[0.02]">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
              <div className="space-y-4 max-w-md">
                <div className="grid size-11 place-items-center rounded-2xl bg-[#b0774c]/10 text-accent">
                  <MessageCircle className="size-5.5" />
                </div>
                <h3 className="text-xl font-black">Automação de WhatsApp e RGPD</h3>
                <p className="text-sm leading-relaxed text-[#5f6470] dark:text-[#a1a1aa]">
                  Reduza esquecimentos sem perder tempo a enviar mensagens manualmente. A plataforma cria a estrutura e o fluxo ideal de lembretes automáticos de agendamento, além de salvaguardar as autorizações de tratamento de dados necessárias (RGPD).
                </p>
                <div className="flex flex-wrap gap-2 text-xs font-bold text-[#666b75] dark:text-[#a1a1aa]">
                  <span className="rounded-full bg-[#12151d]/5 px-3 py-1 dark:bg-white/5">Envio Automático</span>
                  <span className="rounded-full bg-[#12151d]/5 px-3 py-1 dark:bg-white/5">Confirmações Imediatas</span>
                  <span className="rounded-full bg-[#12151d]/5 px-3 py-1 dark:bg-white/5">Consentimento Explicito</span>
                </div>
              </div>
              <div className="w-full flex-1 rounded-2xl border border-[#12151d]/5 bg-[#fcfaf7] p-5 dark:border-white/5 dark:bg-white/[0.01]">
                <div className="space-y-3">
                  <div className="rounded-xl bg-white p-3.5 shadow-sm dark:bg-white/[0.02] border border-[#12151d]/5 dark:border-white/5">
                    <p className="text-xs font-black text-accent">CONFIRMAÇÃO AUTOMÁTICA</p>
                    <p className="text-xs mt-1 text-[#5f6470] dark:text-[#a1a1aa]">
                      WhatsApp enviado 24h antes da marcação com link para remarcar de forma autónoma.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PLANO ÚNICO - SEÇÃO DE PREÇO PREMIUM */}
      <section id="planos" className="relative px-6 py-20 md:py-28 bg-[#12151d] text-white dark:bg-[#0c0e12]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(176,119,76,0.15),transparent_60%)]" />
        
        <div className="relative mx-auto max-w-6xl">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-accent">Preço Claro e Justo</p>
            <h2 className="mt-3 text-balance text-3xl font-black leading-tight tracking-tight sm:text-4xl md:text-5xl">
              Um único plano premium. Acesso absoluto.
            </h2>
            <p className="mt-4 text-white/60">
              Sem divisões confusas de funcionalidades. Teste sem introduzir cartão e desfrute do sistema completo para elevar o patamar do seu estúdio.
            </p>
          </div>

          <div className="mx-auto max-w-3xl rounded-[2.5rem] border border-[#b0774c]/20 bg-white/[0.03] p-8 md:p-12 shadow-[0_24px_80px_rgba(0,0,0,0.4)] backdrop-blur">
            <div className="grid gap-8 md:grid-cols-2 md:items-center">
              <div className="space-y-6">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-accent">
                    <Sparkles className="size-3.5" /> Acesso Total e Ilimitado
                  </span>
                  <h3 className="text-2xl font-black mt-3">Plano Estúdio Premium</h3>
                  <p className="text-sm text-white/60 mt-1">Desenhado para estúdios que vivem de agenda cheia.</p>
                </div>

                <ul className="space-y-3.5 text-sm text-white/80">
                  <li className="flex items-start gap-3">
                    <Check className="size-4.5 mt-0.5 shrink-0 text-accent" />
                    <span>Profissionais e funcionários <strong>ilimitados</strong></span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="size-4.5 mt-0.5 shrink-0 text-accent" />
                    <span>Clientes e marcações <strong>ilimitadas</strong></span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="size-4.5 mt-0.5 shrink-0 text-accent" />
                    <span>Link de página pública personalizada</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="size-4.5 mt-0.5 shrink-0 text-accent" />
                    <span>Integração com Stripe para cobrança de sinais</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="size-4.5 mt-0.5 shrink-0 text-accent" />
                    <span>Lembretes automáticos e conformidade RGPD</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-3xl bg-white/[0.04] p-8 text-center border border-white/5 shadow-inner">
                <span className="text-[10px] font-black uppercase tracking-widest text-white/40">ASSINATURA SIMPLES</span>
                
                <div className="mt-4 flex items-baseline justify-center gap-1">
                  <span className="text-5xl font-black text-white">29€</span>
                  <span className="text-base text-white/60">/mês</span>
                </div>
                <p className="text-[10px] text-white/40 mt-1">Preço final plano, sem taxas ocultas ou limites</p>

                <div className="mt-6 space-y-3">
                  <Link to="/signup" className="inline-flex h-12 w-full items-center justify-center rounded-full bg-white text-sm font-black text-[#12151d] shadow-lg transition hover:-translate-y-0.5 hover:bg-slate-100">
                    Começar 14 Dias Grátis
                  </Link>
                  <p className="text-[10px] text-white/50">Não precisa de introduzir cartão de crédito</p>
                </div>

                <div className="mt-6 border-t border-white/5 pt-6 grid grid-cols-2 gap-4 text-left text-[11px] text-white/50">
                  <div>
                    <strong className="text-white">Sem Fidelização</strong>
                    <p className="mt-0.5">Cancele online a qualquer momento.</p>
                  </div>
                  <div>
                    <strong className="text-white">Setup Gratuito</strong>
                    <p className="mt-0.5">Criamos a sua conta em minutos.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROVA SOCIAL / TESTEMUNHOS PREMIUM */}
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-accent">Casos de Sucesso</p>
          <h2 className="mt-3 text-balance text-3xl font-black leading-tight tracking-tight sm:text-4xl md:text-5xl">
            A escolha de negócios independentes que se profissionalizaram.
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {testimonials.map((t, idx) => (
            <article key={idx} className="flex flex-col justify-between rounded-[2rem] border border-[#12151d]/5 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-white/[0.01]">
              <div className="space-y-4">
                <div className="flex gap-1 text-accent">
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} className="size-4 fill-current" />
                  ))}
                </div>
                <p className="text-sm leading-relaxed text-[#5f6470] dark:text-[#a1a1aa]">
                  &ldquo;{t.quote}&rdquo;
                </p>
              </div>
              <div className="mt-6 border-t border-[#12151d]/5 pt-4 dark:border-white/5">
                <h4 className="text-sm font-black">{t.author}</h4>
                <p className="text-[11px] text-[#666b75] dark:text-[#a1a1aa]">{t.role} • {t.location}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* FAQ REFORMULADO E MINIMALISTA */}
      <section id="faq" className="mx-auto max-w-4xl px-6 py-20 md:py-28">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-accent">Perguntas Frequentes</p>
          <h2 className="mt-3 text-balance text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            Decida com toda a clareza e sem fricção.
          </h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-[#12151d]/5 bg-white shadow-sm transition duration-300 dark:border-white/5 dark:bg-white/[0.01]"
            >
              <button
                onClick={() => toggleFaq(idx)}
                className="flex w-full cursor-pointer items-center justify-between gap-4 p-5 text-left text-sm font-black focus:outline-none"
              >
                <span>{faq.question}</span>
                <ChevronRight
                  className={`size-4 shrink-0 text-accent transition-transform duration-300 ${
                    openFaq === idx ? "rotate-90" : ""
                  }`}
                />
              </button>
              
              <div
                className={`overflow-hidden transition-all duration-300 ease-out-expo ${
                  openFaq === idx ? "max-h-[300px] opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                <div className="border-t border-[#12151d]/5 p-5 text-sm leading-relaxed text-[#5f6470] dark:border-white/5 dark:text-[#a1a1aa]">
                  {faq.answer}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA DE FECHO DE ALTO IMPACTO */}
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-5xl rounded-[3rem] border border-[#b0774c]/20 bg-[#12151d] text-white p-8 md:p-14 text-center shadow-2xl relative overflow-hidden dark:bg-[#0c0e12]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(176,119,76,0.18),transparent_50%)]" />
          
          <div className="relative z-10 max-w-2xl mx-auto space-y-6">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-accent">Fácil de Começar</p>
            <h2 className="text-3xl font-black leading-tight sm:text-4xl md:text-5xl">
              Transforme a gestão do seu estúdio hoje.
            </h2>
            <p className="text-sm leading-relaxed text-white/70">
              Crie a sua conta gratuita em menos de 2 minutos. Escolha o seu segmento, adicione a sua equipa e comece a receber agendamentos premium de forma automatizada.
            </p>
            
            <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
              <Link to="/signup" className="inline-flex h-12 items-center justify-center rounded-full bg-white px-7 text-sm font-black text-[#12151d] shadow-lg transition hover:-translate-y-0.5 hover:bg-slate-100">
                Criar Conta Grátis
              </Link>
              <Link to="/login" className="inline-flex h-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-7 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-white/[0.08]">
                Já tenho uma conta
              </Link>
            </div>
            
            <p className="text-[10px] text-white/40">Sem cartão de crédito • Período de teste completo de 14 dias</p>
          </div>
        </div>
      </section>

      {/* RODAPÉ PREMIUM (DARK) */}
      <footer className="border-t border-white/5 bg-[#0c0e12] px-6 py-16 text-white">
        <div className="mx-auto max-w-6xl grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 font-black">
              <span className="grid size-8 place-items-center rounded-xl bg-white text-[#0f1218]">
                <Sparkles className="size-4" />
              </span>
              <span className="text-lg font-black">{APP_BRAND.name}</span>
            </div>
            <p className="text-sm leading-relaxed text-white/50 max-w-sm">
              Software de gestão premium, agenda online integrada e cobrança de sinais segura via Stripe. Perfeito para estúdios de estética, cabeleireiros, manicures e barbearias em Portugal.
            </p>
            <div className="text-[11px] text-[#b0774c] font-bold">
              Desenvolvido de acordo com as normas europeias e do RGPD.
            </div>
          </div>
          
          <div className="space-y-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-accent">Navegação</h4>
            <div className="grid gap-2 text-sm text-white/60">
              <a href="#produto" className="hover:text-white transition">Como Funciona</a>
              <a href="#funcionalidades" className="hover:text-white transition">Funcionalidades</a>
              <a href="#planos" className="hover:text-white transition">Preço Único</a>
              <a href="#faq" className="hover:text-white transition">FAQ</a>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-accent">Começar</h4>
            <div className="grid gap-2 text-sm text-white/60">
              <Link to="/signup" className="hover:text-white transition">Criar Conta</Link>
              <Link to="/login" className="hover:text-white transition">Iniciar Sessão</Link>
              <a href="mailto:suporte@charm.pt" className="hover:text-white transition">Pedir Suporte</a>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-accent">Legal</h4>
            <div className="grid gap-2 text-sm text-white/60">
              <Link to="/privacidade" className="hover:text-white transition">Política de Privacidade</Link>
              <Link to="/cookies" className="hover:text-white transition">Configurar Cookies</Link>
              <Link to="/termos" className="hover:text-white transition">Termos de Utilização</Link>
              <Link to="/politica-cancelamento" className="hover:text-white transition">Cancelamentos</Link>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-12 max-w-6xl border-t border-white/5 pt-8 flex flex-col gap-4 text-center text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <p>© {new Date().getFullYear()} {APP_BRAND.name}. Todos os direitos reservados. Desenhado em Portugal.</p>
          <p className="flex justify-center gap-4">
            <span>RGPD Compliant</span>
            <span>•</span>
            <span>Segurança SSL</span>
          </p>
        </div>
      </footer>

      <CookieBanner />
    </main>
  );
}
