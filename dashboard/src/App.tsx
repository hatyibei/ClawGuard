import { useState, useEffect, useCallback, useRef } from "react";

// --- Simulated live data generator ---
const PROVIDERS = ["anthropic", "openai", "openrouter"];
const MODELS: Record<string, string[]> = {
  anthropic: ["claude-opus-4", "claude-sonnet-4.5", "claude-haiku-4.5"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-5-nano"],
  openrouter: ["deepseek/r2", "kimi/k2.5", "glm/glm-5"],
};
const STATUS_TYPES = ["allowed", "blocked_compliance", "blocked_security", "blocked_budget", "routed"] as const;

type Status = (typeof STATUS_TYPES)[number];

interface Event {
  id: number;
  timestamp: Date;
  provider: string;
  model: string;
  status: Status;
  layer: string | null;
  detail: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  savedCost: number;
  latencyMs: number;
  session: string;
}

function generateEvent(id: number): Event {
  const provider = PROVIDERS[Math.floor(Math.random() * PROVIDERS.length)];
  const models = MODELS[provider];
  const model = models[Math.floor(Math.random() * models.length)];
  const rand = Math.random();
  let status: Status, layer: string | null, detail: string | null;

  if (rand < 0.6) {
    status = "allowed";
    layer = null;
    detail = null;
  } else if (rand < 0.72) {
    status = "blocked_compliance";
    layer = "compliance";
    detail = ["OAuth token detected in header", "Rate limit self-cap exceeded (80%)", "Duplicate request within dedup window"][Math.floor(Math.random() * 3)];
  } else if (rand < 0.82) {
    status = "blocked_security";
    layer = "security";
    detail = ["Outbound to blocklisted domain: ngrok.io", "Credential pattern detected in prompt (AWS key)", "Suspicious URL in tool_use content: pastebin.com", "Data exfiltration pattern: bulk PII in response"][Math.floor(Math.random() * 4)];
  } else if (rand < 0.90) {
    status = "blocked_budget";
    layer = "cost";
    detail = ["Daily budget exceeded ($15.00/$15.00)", "Loop detected: same hash 6x in 5min", "Cost spiral: $3.20 in 5min window"][Math.floor(Math.random() * 3)];
  } else {
    status = "routed";
    layer = "cost";
    const from = "claude-opus-4";
    const to = "claude-haiku-4.5";
    detail = `Smart routed: ${from} → ${to} (saved ~$0.014)`;
  }

  const inputTokens = Math.floor(Math.random() * 4000) + 100;
  const outputTokens = Math.floor(Math.random() * 2000) + 50;
  const costMap: Record<string, number> = { "claude-opus-4": 15, "claude-sonnet-4.5": 3, "claude-haiku-4.5": 0.8, "gpt-5": 10, "gpt-5-mini": 1.5, "gpt-5-nano": 0.3, "deepseek/r2": 0.55, "kimi/k2.5": 0.4, "glm/glm-5": 0.6 };
  const rate = costMap[model] || 1;
  const cost = ((inputTokens + outputTokens) / 1_000_000) * rate;

  return {
    id,
    timestamp: new Date(),
    provider,
    model,
    status,
    layer,
    detail,
    inputTokens,
    outputTokens,
    cost: status === "allowed" || status === "routed" ? cost : 0,
    savedCost: status === "routed" ? cost * 0.9 : 0,
    latencyMs: Math.floor(Math.random() * 300) + 20,
    session: `sess_${String(Math.floor(Math.random() * 5) + 1).padStart(3, "0")}`,
  };
}

// --- Components ---
function StatCard({ label, value, sub, color, icon }: { label: string; value: string | number; sub?: string; color: string; icon: string }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold tracking-tight font-mono" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function ComplianceBadge({ events }: { events: Event[] }) {
  const blocked = events.filter(e => e.status === "blocked_compliance").length;
  const total = events.length;
  const rate = total > 0 ? ((total - blocked) / total * 100) : 100;
  const color = rate >= 99 ? "#22c55e" : rate >= 95 ? "#eab308" : "#ef4444";
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🛡️</span>
        <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">ToS Compliance</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold font-mono" style={{ color }}>
          {rate.toFixed(1)}%
        </span>
        <span className="text-xs text-slate-500 pb-1">pass rate</span>
      </div>
      <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${rate}%`, backgroundColor: color }} />
      </div>
      <div className="text-xs text-slate-500 mt-2">{blocked} OAuth/ToS violations blocked</div>
    </div>
  );
}

function SecurityScore({ events }: { events: Event[] }) {
  const threats = events.filter(e => e.status === "blocked_security");
  const critical = threats.filter(e => e.detail?.includes("Credential") || e.detail?.includes("exfiltration")).length;
  const high = threats.length - critical;
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🔒</span>
        <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Threats Blocked</span>
      </div>
      <div className="flex items-end gap-3">
        <div>
          <span className="text-3xl font-bold text-red-400 font-mono">{threats.length}</span>
        </div>
      </div>
      <div className="flex gap-3 mt-2">
        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
          {critical} critical
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/20">
          {high} high
        </span>
      </div>
    </div>
  );
}

function CostSummary({ events }: { events: Event[] }) {
  const totalCost = events.reduce((s, e) => s + e.cost, 0);
  const savedCost = events.reduce((s, e) => s + e.savedCost, 0);
  const budgetBlocked = events.filter(e => e.status === "blocked_budget").length;
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">💰</span>
        <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Cost Today</span>
      </div>
      <div className="flex items-end gap-1">
        <span className="text-3xl font-bold text-emerald-400 font-mono">
          ${totalCost.toFixed(2)}
        </span>
        <span className="text-xs text-slate-500 pb-1">/ $15.00</span>
      </div>
      <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.min((totalCost / 15) * 100, 100)}%` }} />
      </div>
      <div className="flex justify-between mt-2">
        <span className="text-xs text-emerald-500">Saved: ${savedCost.toFixed(2)}</span>
        <span className="text-xs text-amber-500">{budgetBlocked} overage blocks</span>
      </div>
    </div>
  );
}

function MiniChart({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 200;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - (v / max) * (height - 4)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} className="mt-1">
      <polyline points={`0,${height} ${points} ${w},${height}`} fill={`${color}15`} stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function EventRow({ event }: { event: Event }) {
  const statusConfig: Record<Status, { color: string; bg: string; label: string; icon: string }> = {
    allowed: { color: "#22c55e", bg: "#22c55e10", label: "PASS", icon: "✓" },
    blocked_compliance: { color: "#ef4444", bg: "#ef444410", label: "BLOCKED:ToS", icon: "⛔" },
    blocked_security: { color: "#f97316", bg: "#f9731610", label: "BLOCKED:SEC", icon: "🔒" },
    blocked_budget: { color: "#eab308", bg: "#eab30810", label: "BLOCKED:$$$", icon: "💸" },
    routed: { color: "#3b82f6", bg: "#3b82f610", label: "ROUTED", icon: "🔀" },
  };
  const cfg = statusConfig[event.status];
  const time = event.timestamp.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-transparent hover:border-slate-700/50 transition-colors text-sm group"
      style={{ backgroundColor: event.status !== "allowed" ? cfg.bg : "transparent" }}>
      <span className="text-xs text-slate-600 w-16 flex-shrink-0 font-mono">{time}</span>
      <span className="text-xs w-5 text-center">{cfg.icon}</span>
      <span className="text-xs px-1.5 py-0.5 rounded font-medium w-24 text-center flex-shrink-0 font-mono"
        style={{ color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.color}20` }}>
        {cfg.label}
      </span>
      <span className="text-xs text-slate-400 w-28 flex-shrink-0 truncate">{event.model}</span>
      <span className="text-xs text-slate-500 flex-1 truncate">
        {event.detail || `${event.inputTokens}→${event.outputTokens} tok`}
      </span>
      {event.cost > 0 && (
        <span className="text-xs text-slate-400 flex-shrink-0 font-mono">
          ${event.cost.toFixed(4)}
        </span>
      )}
      <span className="text-xs text-slate-600 flex-shrink-0 w-12 text-right font-mono">
        {event.latencyMs}ms
      </span>
    </div>
  );
}

function LayerBreakdown({ events }: { events: Event[] }) {
  const layers = [
    { key: "compliance", label: "Compliance (ToS)", color: "#ef4444", icon: "🛡️", blocked: events.filter(e => e.layer === "compliance").length },
    { key: "security", label: "Security", color: "#f97316", icon: "🔒", blocked: events.filter(e => e.layer === "security" && e.status.startsWith("blocked")).length },
    { key: "cost", label: "Cost", color: "#eab308", icon: "💰", blocked: events.filter(e => e.layer === "cost" && e.status === "blocked_budget").length },
  ];
  const maxBlocked = Math.max(...layers.map(l => l.blocked), 1);

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 backdrop-blur-sm">
      <h3 className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-3">Protection Layers</h3>
      <div className="space-y-3">
        {layers.map(layer => (
          <div key={layer.key}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-300">{layer.icon} {layer.label}</span>
              <span className="text-xs font-bold font-mono" style={{ color: layer.color }}>
                {layer.blocked} blocked
              </span>
            </div>
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(layer.blocked / maxBlocked) * 100}%`, backgroundColor: layer.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main Dashboard ---
export default function ClawGuardDashboard() {
  const [events, setEvents] = useState<Event[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [costHistory, setCostHistory] = useState<number[]>([]);
  const [tab, setTab] = useState("all");
  const counterRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addEvent = useCallback(() => {
    counterRef.current += 1;
    const evt = generateEvent(counterRef.current);
    setEvents(prev => [evt, ...prev].slice(0, 100));
    setCostHistory(prev => {
      const next = [...prev, evt.cost];
      return next.slice(-30);
    });
  }, []);

  const toggleLive = useCallback(() => {
    if (isLive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    } else {
      // Burst initial events
      for (let i = 0; i < 12; i++) {
        setTimeout(() => addEvent(), i * 80);
      }
      intervalRef.current = setInterval(addEvent, 1500 + Math.random() * 2000);
    }
    setIsLive(prev => !prev);
  }, [isLive, addEvent]);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const filteredEvents = tab === "all" ? events :
    tab === "blocked" ? events.filter(e => e.status.startsWith("blocked")) :
    tab === "compliance" ? events.filter(e => e.layer === "compliance") :
    tab === "security" ? events.filter(e => e.layer === "security" && e.status.startsWith("blocked")) :
    tab === "cost" ? events.filter(e => e.layer === "cost") :
    events;

  const tabs = [
    { key: "all", label: "All", count: events.length },
    { key: "blocked", label: "Blocked", count: events.filter(e => e.status.startsWith("blocked")).length },
    { key: "compliance", label: "ToS", count: events.filter(e => e.layer === "compliance").length },
    { key: "security", label: "Security", count: events.filter(e => e.layer === "security" && e.status.startsWith("blocked")).length },
    { key: "cost", label: "Cost", count: events.filter(e => e.layer === "cost").length },
  ];

  return (
    <div className="min-h-screen text-white" style={{
      background: "linear-gradient(165deg, #020617 0%, #0a0e1a 50%, #0d0a18 100%)",
    }}>
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center text-sm font-bold">CG</div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">ClawGuard</h1>
              <p className="text-xs text-slate-500">Safety Proxy for OpenClaw</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-400 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50">
              <span className="font-mono">localhost:4200</span>
              <span className={`w-2 h-2 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
            </div>
            <button onClick={toggleLive}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all border"
              style={{
                background: isLive ? "linear-gradient(135deg, #dc2626, #b91c1c)" : "linear-gradient(135deg, #059669, #047857)",
                borderColor: isLive ? "#ef444440" : "#22c55e40",
              }}>
              {isLive ? "⏹ Stop" : "▶ Start"} Live Feed
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-5">
        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-4 mb-5">
          <ComplianceBadge events={events} />
          <SecurityScore events={events} />
          <CostSummary events={events} />
          <StatCard
            label="Requests"
            value={events.length}
            sub={`${events.filter(e => e.status === "allowed").length} passed · ${events.filter(e => e.status.startsWith("blocked")).length} blocked`}
            color="#a78bfa"
            icon="📊"
          />
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-3 gap-4">
          {/* Event Log - 2 columns */}
          <div className="col-span-2 rounded-xl border border-slate-700/50 bg-slate-800/40 backdrop-blur-sm overflow-hidden">
            {/* Tabs */}
            <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-slate-700/30">
              {tabs.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${tab === t.key ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}>
                  {t.label}
                  {t.count > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-slate-700/50 font-mono"
                      style={{ fontSize: "10px" }}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Events */}
            <div className="overflow-y-auto" style={{ maxHeight: "420px" }}>
              {filteredEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-600">
                  <span className="text-3xl mb-2">{isLive ? "⏳" : "🛡️"}</span>
                  <span className="text-sm">{isLive ? "Waiting for requests..." : "Start the live feed to see events"}</span>
                </div>
              ) : (
                <div className="p-2 space-y-0.5">
                  {filteredEvents.map(evt => (
                    <div key={evt.id} className="fade-slide">
                      <EventRow event={evt} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <LayerBreakdown events={events} />

            {/* Cost Mini Chart */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 backdrop-blur-sm">
              <h3 className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-2">Cost per Request</h3>
              <MiniChart data={costHistory} color="#22c55e" height={50} />
              <div className="flex justify-between mt-2 text-xs text-slate-500">
                <span>30 requests ago</span>
                <span>now</span>
              </div>
            </div>

            {/* Quick Config */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 backdrop-blur-sm">
              <h3 className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-3">Active Rules</h3>
              <div className="space-y-2">
                {[
                  { label: "Block OAuth Tokens", enabled: true, layer: "compliance" },
                  { label: "Rate Limit (80% cap)", enabled: true, layer: "compliance" },
                  { label: "Outbound Blocklist", enabled: true, layer: "security" },
                  { label: "Credential Leak Detection", enabled: true, layer: "security" },
                  { label: "Daily Budget ($15)", enabled: true, layer: "cost" },
                  { label: "Loop Detection", enabled: true, layer: "cost" },
                  { label: "Smart Routing (Opus→Haiku)", enabled: true, layer: "cost" },
                ].map((rule, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${rule.layer === "compliance" ? "bg-red-400" : rule.layer === "security" ? "bg-orange-400" : "bg-emerald-400"}`} />
                      <span className="text-xs text-slate-300">{rule.label}</span>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${rule.enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-700 text-slate-500"}`}>
                      {rule.enabled ? "ON" : "OFF"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
