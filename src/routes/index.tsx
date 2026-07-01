import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import heroFlow from "@/assets/hero-flow.jpg";
import {
  ArrowRight,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  Database,
  FileText,
  Gauge,
  Globe2,
  Layers,
  Network,
  ScanLine,
  ShieldCheck,
  Sparkles,
  UserCheck,
  AlertTriangle,
  Workflow,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title:
          "IV Doc — From Unstructured Chaos to Straight-Through Processing",
      },
      {
        name: "description",
        content:
          "IV Doc is an AI document processing and management engine that turns raw banking documents into verified, structured payloads ready for core systems.",
      },
      {
        property: "og:title",
        content: "IV Doc — Document Processing & Management Engine",
      },
      {
        property: "og:description",
        content:
          "AI-powered Straight-Through Processing for banking. OCR, classification, three-tier validation, core system delivery.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Index,
});

function Nav() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-background/75 border-b hairline">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2.5">
          <Logo />
          <span className="font-display font-semibold tracking-tight text-lg">
            IV Doc
          </span>
        </a>
        <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <a
            href="#pipeline"
            className="hover:text-foreground transition-colors"
          >
            Pipeline
          </a>
          <a
            href="#extraction"
            className="hover:text-foreground transition-colors"
          >
            Extraction
          </a>
          <a
            href="#validation"
            className="hover:text-foreground transition-colors"
          >
            Validation
          </a>
          <a
            href="#decisioning"
            className="hover:text-foreground transition-colors"
          >
            Decisioning
          </a>
          <a
            href="#outcome"
            className="hover:text-foreground transition-colors"
          >
            Outcome
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/auth"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-hairline)] px-4 py-2 text-sm font-medium hover:border-[var(--color-accent)] transition-colors"
          >
            Sign in
          </Link>
          <Link
            to="/process"
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ink)] text-[var(--color-mist)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-primary)] transition-colors"
          >
            Try it live <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-60 pointer-events-none" />
      <div className="mx-auto max-w-7xl px-6 pt-20 pb-12 lg:pt-28 lg:pb-20 relative">
        <div className="grid lg:grid-cols-12 gap-10 items-end">
          <div className="lg:col-span-7">
            <span className="chip">
              <Sparkles className="h-3.5 w-3.5" /> Document Processing &
              Management Engine
            </span>
            <h1 className="mt-6 text-5xl md:text-6xl lg:text-7xl font-semibold leading-[0.95] tracking-tight">
              From{" "}
              <span className="italic font-light text-[var(--color-primary)]">
                unstructured
              </span>{" "}
              chaos to
              <br />
              straight-through processing.
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-muted-foreground leading-relaxed">
              IV Doc ingests raw multilingual enterprise documents, extracts the
              data that matters, enforces business logic, and delivers verified
              payloads into core banking and ECM systems — with minimal manual
              intervention.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/process"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--color-ink)] text-[var(--color-mist)] px-5 py-3 text-sm font-medium hover:bg-[var(--color-primary)] transition-colors"
              >
                Process a document <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#pipeline"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--color-hairline)] px-5 py-3 text-sm font-medium hover:border-[var(--color-accent)] transition-colors"
              >
                Explore the pipeline
              </a>
            </div>

            <dl className="mt-12 grid grid-cols-3 gap-6 max-w-xl">
              {[
                { k: "100%", v: "Verified payloads" },
                { k: "2", v: "Native languages" },
                { k: "3-tier", v: "Validation shield" },
              ].map((s) => (
                <div key={s.k}>
                  <dt className="font-display text-3xl font-semibold tracking-tight">
                    {s.k}
                  </dt>
                  <dd className="text-xs uppercase tracking-wider text-muted-foreground mt-1">
                    {s.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="lg:col-span-5">
            <div className="relative bento-dark p-2 overflow-hidden">
              <img
                src={heroFlow}
                alt="Documents flowing through IV Doc's AI extraction pipeline"
                width={1600}
                height={1200}
                className="rounded-[calc(var(--radius-2xl)-6px)] w-full h-auto object-cover aspect-[4/5]"
              />
              <div className="absolute left-6 right-6 bottom-6 flex items-center justify-between">
                <div className="chip chip-dark">
                  <span className="glow-dot !w-2 !h-2" /> Live pipeline
                </div>
                <span className="text-[var(--color-mist)]/70 text-xs font-mono">
                  stp.engine
                </span>
              </div>
            </div>
          </div>
        </div>

        <FlowStrip />
      </div>
    </section>
  );
}

function FlowStrip() {
  const stages = [
    { label: "Raw documents", icon: FileText },
    { label: "OCR & AI extraction", icon: ScanLine },
    { label: "Classification", icon: Network },
    { label: "Validation", icon: ShieldCheck },
    { label: "Core / ECM", icon: Database },
  ];
  return (
    <div className="mt-16 bento p-2">
      <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x hairline">
        {stages.map((s, i) => (
          <div key={s.label} className="flex items-center gap-3 px-5 py-4">
            <div className="h-9 w-9 rounded-lg bg-[var(--color-mist)] grid place-items-center text-[var(--color-primary)]">
              <s.icon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[10px] tracking-widest text-muted-foreground uppercase">
                Stage {i + 1}
              </div>
              <div className="text-sm font-medium">{s.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: React.ReactNode;
  copy?: string;
}) {
  return (
    <div className="max-w-3xl mb-10">
      <div className="chip mb-4">{eyebrow}</div>
      <h2 className="text-4xl md:text-5xl font-semibold tracking-tight">
        {title}
      </h2>
      {copy && (
        <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
          {copy}
        </p>
      )}
    </div>
  );
}

function Ingest() {
  const docs = [
    "SWIFT Remittance",
    "Account Opening Forms",
    "KYC Passports",
    "Salary Slips",
    "Legal Agreements",
    "Bank Statements",
  ];
  return (
    <section id="pipeline" className="mx-auto max-w-7xl px-6 py-24">
      <SectionHeader
        eyebrow="Ingesting the unstructured enterprise"
        title={<>One engine for every document your bank already receives.</>}
        copy="Highly structured forms, semi-structured banking documents, or completely unstructured contracts — IV Doc treats them as one unified input."
      />

      <div className="grid lg:grid-cols-6 gap-4">
        <div className="bento lg:col-span-4 p-8">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-primary)]">
            <Globe2 className="h-4 w-4" /> Bilingual readiness
          </div>
          <h3 className="font-display text-2xl md:text-3xl mt-3 tracking-tight">
            Native English & Arabic — processed simultaneously, not as an
            afterthought.
          </h3>
          <div className="mt-8 grid grid-cols-2 gap-3 max-w-md">
            <LangBlock label="English" sample="Beneficiary Account Number" />
            <LangBlock label="العربية" sample="رقم حساب المستفيد" rtl />
          </div>
        </div>

        <div className="bento-dark lg:col-span-2 p-8 flex flex-col">
          <div className="chip chip-dark self-start">
            <Layers className="h-3.5 w-3.5" /> Format agnostic
          </div>
          <p className="font-display text-2xl mt-4 leading-snug">
            Structured, semi-structured, unstructured, identity — handled by a
            single pipeline.
          </p>
          <div className="mt-auto pt-8 text-[var(--color-mist)]/60 text-sm">
            No template wrangling required.
          </div>
        </div>

        <div className="bento lg:col-span-6 p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-widest">
              Supported inputs
            </div>
            <div className="text-xs text-muted-foreground">
              + custom document types on request
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {docs.map((d) => (
              <div
                key={d}
                className="rounded-xl border hairline p-4 flex items-center gap-3 hover:border-[var(--color-accent)] transition-colors"
              >
                <FileText className="h-4 w-4 text-[var(--color-accent)]" />
                <span className="text-sm font-medium">{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function LangBlock({
  label,
  sample,
  rtl = false,
}: {
  label: string;
  sample: string;
  rtl?: boolean;
}) {
  return (
    <div className="rounded-xl bg-[var(--color-elevated)] border hairline p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        dir={rtl ? "rtl" : "ltr"}
        className="font-mono text-sm mt-2 text-[var(--color-ink)]"
      >
        {sample}
      </div>
    </div>
  );
}

function Routing() {
  const items = [
    {
      icon: Layers,
      title: "Structural analysis",
      copy: "Detects predictable banking layouts and routes them to template engines instantly.",
    },
    {
      icon: Brain,
      title: "Natural language processing",
      copy: "Reads context across contracts and statements to understand intent, not just glyphs.",
    },
    {
      icon: Network,
      title: "Visual pattern CNN",
      copy: "Recognizes signatures, stamps, logos, and identity patterns even on noisy scans.",
    },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <SectionHeader
        eyebrow="Intelligent document routing"
        title={
          <>
            A triage switchboard that decides where each page goes — in
            milliseconds.
          </>
        }
      />
      <div className="grid md:grid-cols-3 gap-4">
        {items.map((i) => (
          <div key={i.title} className="bento p-7">
            <div className="h-10 w-10 rounded-lg bg-[var(--color-ink)] text-[var(--color-mist)] grid place-items-center">
              <i.icon className="h-5 w-5" />
            </div>
            <h3 className="font-display text-xl mt-5">{i.title}</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              {i.copy}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Extraction() {
  return (
    <section id="extraction" className="mx-auto max-w-7xl px-6 py-24">
      <SectionHeader
        eyebrow="Dual-engine extraction"
        title={<>Two complementary engines. One verified output.</>}
        copy="Template-based OCR for the layouts you know. AI-assisted deep learning for everything else. IV Doc routes to the right one automatically."
      />

      <div className="grid lg:grid-cols-12 gap-4">
        <EngineCard
          className="lg:col-span-6"
          title="Template-based OCR"
          tech="Rules & coordinate geometry"
          tolerance="Low variation tolerance"
          best="Standardized banking forms"
          speed="Instant for known templates"
          tone="light"
        />
        <EngineCard
          className="lg:col-span-6"
          title="AI-assisted IDP"
          tech="Agentic AI, OCR, Visual CNN"
          tolerance="High variation tolerance"
          best="External KYC & variable layouts"
          speed="Supervised learning, adaptive"
          tone="dark"
        />

        <div className="bento lg:col-span-12 p-8 lg:p-10">
          <div className="grid lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-5">
              <div className="chip mb-4">
                <Workflow className="h-3.5 w-3.5" /> Example · SWIFT Remittance
              </div>
              <h3 className="font-display text-3xl tracking-tight">
                From scanned remittance to database-ready JSON in one pass.
              </h3>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                The extraction layer outputs a clean, typed payload — every
                field traceable to its source coordinates and confidence score.
              </p>
              <ul className="mt-6 space-y-2 text-sm">
                {[
                  "Sender & beneficiary entities",
                  "IBAN with checksum validation",
                  "Amount & currency normalization",
                  "SWIFT / BIC structural check",
                ].map((x) => (
                  <li key={x} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[var(--color-accent)]" />{" "}
                    {x}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:col-span-7">
              <CodeBlock />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EngineCard({
  className,
  title,
  tech,
  tolerance,
  best,
  speed,
  tone,
}: {
  className?: string;
  title: string;
  tech: string;
  tolerance: string;
  best: string;
  speed: string;
  tone: "light" | "dark";
}) {
  const isDark = tone === "dark";
  return (
    <div
      className={`${isDark ? "bento-dark" : "bento"} p-8 ${className ?? ""}`}
    >
      <div
        className={`text-xs uppercase tracking-widest ${isDark ? "text-[var(--color-mist)]/60" : "text-muted-foreground"}`}
      >
        Engine
      </div>
      <h3 className="font-display text-3xl mt-2">{title}</h3>
      <dl
        className={`mt-6 grid grid-cols-1 gap-4 text-sm ${isDark ? "text-[var(--color-mist)]/90" : ""}`}
      >
        {[
          ["Technology", tech],
          ["Tolerance", tolerance],
          ["Best for", best],
          ["Speed", speed],
        ].map(([k, v]) => (
          <div
            key={k}
            className={`flex justify-between gap-6 border-t pt-3 ${isDark ? "border-white/10" : "hairline"}`}
          >
            <dt
              className={`uppercase text-[10px] tracking-widest ${isDark ? "text-[var(--color-mist)]/50" : "text-muted-foreground"}`}
            >
              {k}
            </dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CodeBlock() {
  const json = `{
  "sender_details":       "CORP LLC INTL",
  "beneficiary_details":  "GLOBAL LOGISTICS INC",
  "iban_account_num":     "AE98000000123456789",
  "amount_currency":      "USD 250,000.00",
  "swift_bic_code":       "BOFAUS3N",
  "transaction_ref":      "TXN-9988-7766A"
}`;
  return (
    <div className="rounded-2xl overflow-hidden border border-white/10 bg-[var(--color-ink)] text-[var(--color-mist)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        </div>
        <span className="font-mono text-xs text-[var(--color-mist)]/60">
          payload.json
        </span>
        <span className="chip chip-dark !py-1 !px-2 !text-[10px]">
          verified
        </span>
      </div>
      <pre className="font-mono text-sm leading-relaxed p-5 overflow-x-auto">
        <code>{json}</code>
      </pre>
    </div>
  );
}

function Validation() {
  const tiers = [
    {
      n: "01",
      title: "Core data validation",
      copy: "Missing field detection, syntax checks, formatting enforcement.",
      bullets: ["IBAN checksum", "SWIFT/BIC structure", "Date normalization"],
    },
    {
      n: "02",
      title: "Cross-field validation",
      copy: "Context-aware checks across fields within a single document.",
      bullets: ["Entity matching", "Geographic logic", "Risk-limit triggers"],
    },
    {
      n: "03",
      title: "Cross-document triangulation",
      copy: "Correlates evidence across the entire application package.",
      bullets: ["Identity assurance", "Income verification", "Legal alignment"],
    },
  ];
  return (
    <section id="validation" className="mx-auto max-w-7xl px-6 py-24">
      <SectionHeader
        eyebrow="Three-tier validation shield"
        title={
          <>Only validated, rule-compliant data reaches your core systems.</>
        }
        copy="Every payload is filtered through three layers of business logic before it's accepted. Ambiguous cases route to a human queue — never silently dropped."
      />
      <div className="grid md:grid-cols-3 gap-4">
        {tiers.map((t) => (
          <div key={t.n} className="bento p-8 relative overflow-hidden">
            <div className="absolute -top-6 -right-2 font-display text-[120px] font-semibold text-[var(--color-mist)] leading-none select-none">
              {t.n}
            </div>
            <div className="relative">
              <div className="text-xs uppercase tracking-widest text-[var(--color-accent)]">
                Tier {t.n}
              </div>
              <h3 className="font-display text-2xl mt-2">{t.title}</h3>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                {t.copy}
              </p>
              <ul className="mt-5 space-y-2">
                {t.bullets.map((b) => (
                  <li key={b} className="flex items-center gap-2 text-sm">
                    <span className="glow-dot !h-1.5 !w-1.5" /> {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Deployment() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <SectionHeader
        eyebrow="Flexible deployment · continuous learning"
        title={<>Live from day one. Smarter every day after.</>}
      />
      <div className="grid lg:grid-cols-12 gap-4">
        <div className="bento lg:col-span-4 p-7">
          <Gauge className="h-6 w-6 text-[var(--color-accent)]" />
          <h3 className="font-display text-xl mt-4">Day-one readiness</h3>
          <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
            Pre-trained models optimized for standard banking documents, ready
            to deploy without historical data.
          </p>
        </div>
        <div className="bento lg:col-span-4 p-7">
          <Brain className="h-6 w-6 text-[var(--color-accent)]" />
          <h3 className="font-display text-xl mt-4">Bank-specific training</h3>
          <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
            Custom learning layers trained on your institutional history and
            document quirks.
          </p>
        </div>
        <div className="bento lg:col-span-4 p-7">
          <Workflow className="h-6 w-6 text-[var(--color-accent)]" />
          <h3 className="font-display text-xl mt-4">Exception feedback loop</h3>
          <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
            Human-reviewed edge cases flow back into the pipeline. The system
            adapts to new layouts, novel formats, and your workflows.
          </p>
        </div>
      </div>
    </section>
  );
}

function Decisioning() {
  return (
    <section id="decisioning" className="mx-auto max-w-7xl px-6 py-24">
      <SectionHeader
        eyebrow="Decisioning & exception handling"
        title={
          <>
            Auto-approve the clear cases. Escalate the ambiguous ones — never
            silently.
          </>
        }
        copy="Every verified payload is either streamed to your core systems or routed to a human queue with full context, source coordinates, and confidence scores attached."
      />
      <div className="grid lg:grid-cols-12 gap-4">
        <div className="bento lg:col-span-7 p-8 lg:p-10">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-accent)]">
            <CheckCircle2 className="h-4 w-4" /> Straight-through path
          </div>
          <h3 className="font-display text-2xl md:text-3xl mt-3 tracking-tight">
            Auto-approved payloads stream directly into core banking & ECM.
          </h3>
          <div className="mt-8 grid sm:grid-cols-3 gap-3">
            {[
              { k: "Validated", v: "All three tiers passed" },
              { k: "Typed", v: "Schema-conformant JSON" },
              { k: "Traceable", v: "Field-level provenance" },
            ].map((s) => (
              <div key={s.k} className="rounded-xl border hairline p-4">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  {s.k}
                </div>
                <div className="text-sm font-medium mt-1">{s.v}</div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex items-center gap-3 text-sm text-muted-foreground">
            <Database className="h-4 w-4 text-[var(--color-primary)]" />
            <span>
              API-driven delivery — no middleware, no manual handoffs.
            </span>
          </div>
        </div>

        <div className="bento-dark lg:col-span-5 p-8 lg:p-10 flex flex-col">
          <div className="chip chip-dark self-start">
            <AlertTriangle className="h-3.5 w-3.5" /> Exception queue
          </div>
          <h3 className="font-display text-2xl mt-4">
            Ambiguous or low-confidence cases reach a human reviewer with
            everything they need.
          </h3>
          <ul className="mt-6 space-y-3 text-sm text-[var(--color-mist)]/85">
            {[
              {
                i: UserCheck,
                t: "Reviewer dashboard with side-by-side document & extracted fields",
              },
              {
                i: ShieldCheck,
                t: "Confidence scores and the exact rule that flagged the case",
              },
              {
                i: Workflow,
                t: "Corrections flow back into training — the model gets sharper",
              },
            ].map(({ i: Icon, t }) => (
              <li key={t} className="flex items-start gap-3">
                <Icon className="h-4 w-4 mt-0.5 text-[var(--color-accent)] shrink-0" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Outcome() {
  return (
    <section id="outcome" className="mx-auto max-w-7xl px-6 py-24">
      <div className="bento-dark p-10 lg:p-16 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-10" />
        <div className="relative grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7">
            <div className="chip chip-dark">
              <ShieldCheck className="h-3.5 w-3.5" /> The STP shield
            </div>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl mt-6 tracking-tight">
              100% verified payloads.
              <br />
              <span className="text-[var(--color-mist)]/60">
                Zero-friction handoff.
              </span>
            </h2>
            <p className="mt-5 max-w-xl text-[var(--color-mist)]/75 leading-relaxed">
              Faster operations. Reduced compliance risk. The end of manual
              data-entry bottlenecks — and a measurable lift in straight-through
              processing rates.
            </p>
          </div>
          <div className="lg:col-span-5">
            <div className="grid grid-cols-2 gap-3">
              {[
                { k: "STP", v: "Straight-through pipeline" },
                { k: "API", v: "Downstream-ready integrations" },
                { k: "JSON", v: "Clean structured output" },
                { k: "AML", v: "Risk-aware validation" },
              ].map((s) => (
                <div
                  key={s.k}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
                >
                  <div className="font-display text-2xl">{s.k}</div>
                  <div className="text-xs uppercase tracking-widest text-[var(--color-mist)]/55 mt-2">
                    {s.v}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section id="contact" className="mx-auto max-w-7xl px-6 pb-24">
      <div className="bento p-10 lg:p-14 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
        <div>
          <h3 className="font-display text-3xl md:text-4xl tracking-tight max-w-xl">
            See IV Doc process your documents in real time.
          </h3>
          <p className="mt-3 text-muted-foreground max-w-lg">
            Bring a SWIFT remittance, a KYC packet, or a stack of contracts.
            We'll show you the verified payload in minutes.
          </p>
        </div>
        <Link
          to="/process"
          className="inline-flex items-center gap-2 rounded-full bg-[var(--color-ink)] text-[var(--color-mist)] px-6 py-3.5 text-sm font-medium hover:bg-[var(--color-primary)] transition-colors"
        >
          Process a document <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t hairline">
      <div className="mx-auto max-w-7xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2.5">
          <Logo className="h-7 w-7" />
          <span className="font-display font-semibold text-foreground">
            IV Doc
          </span>
          <span>· Document Processing & Management Engine</span>
        </div>
        <div>© {new Date().getFullYear()} IV Doc. All rights reserved.</div>
      </div>
    </footer>
  );
}

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main>
        <Hero />
        <Ingest />
        <Routing />
        <Extraction />
        <Validation />
        <Decisioning />
        <Deployment />
        <Outcome />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
