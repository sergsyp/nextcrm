import { prismadb } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fmt = new Intl.NumberFormat("ru-RU");
const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

export default async function AiObservabilityPage() {
  // Server-rendered operational snapshot; the request time is the intended reporting boundary.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [usage, events, incidents, cycles] = await Promise.all([
    prismadb.ai_UsageLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prismadb.ai_PipelineEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prismadb.ai_Incident.findMany({ orderBy: [{ status: "asc" }, { lastOccurredAt: "desc" }], take: 100 }),
    prismadb.ai_ProspectingCycle.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const totals = usage.reduce((acc, item) => ({
    tokens: acc.tokens + item.totalTokens,
    cost: acc.cost + (item.estimatedCostUsd ?? 0),
    requests: acc.requests + 1,
    failed: acc.failed + (item.status === "completed" ? 0 : 1),
  }), { tokens: 0, cost: 0, requests: 0, failed: 0 });
  const openIncidents = incidents.filter((item) => item.status !== "RESOLVED").length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI и конвейер продаж</h1>
        <p className="text-sm text-muted-foreground mt-1">Расходы агентов, ночные циклы, значимые события и стопоры.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Metric title="AI-запросов за 24 часа" value={fmt.format(totals.requests)} />
        <Metric title="Токенов за 24 часа" value={fmt.format(totals.tokens)} />
        <Metric title="Оценка расходов" value={totals.cost ? money.format(totals.cost) : "тарифы не заданы"} />
        <Metric title="Активные инциденты" value={fmt.format(openIncidents)} danger={openIncidents > 0} />
      </div>

      <Card><CardHeader><CardTitle>Ночные циклы поиска</CardTitle></CardHeader><CardContent><Table>
        <TableHeader><TableRow><TableHead>Дата</TableHead><TableHead>Направление</TableHead><TableHead>Попытка</TableHead><TableHead>План</TableHead><TableHead>Target</TableHead><TableHead>Статус</TableHead></TableRow></TableHeader>
        <TableBody>{cycles.map((item) => <TableRow key={item.id}><TableCell>{item.businessDate}</TableCell><TableCell>{item.direction}</TableCell><TableCell>{item.attempt}</TableCell><TableCell>{item.quota}</TableCell><TableCell>{item.acceptedCount}</TableCell><TableCell><Badge variant={item.status === "COMPLETED" ? "default" : "secondary"}>{item.status}</Badge></TableCell></TableRow>)}</TableBody>
      </Table></CardContent></Card>

      <Card><CardHeader><CardTitle>Активные и последние инциденты</CardTitle></CardHeader><CardContent><Table>
        <TableHeader><TableRow><TableHead>Когда</TableHead><TableHead>Код</TableHead><TableHead>Уровень</TableHead><TableHead>Направление</TableHead><TableHead>Повторы</TableHead><TableHead>Статус</TableHead></TableRow></TableHeader>
        <TableBody>{incidents.map((item) => <TableRow key={item.id}><TableCell>{item.lastOccurredAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</TableCell><TableCell className="font-mono text-xs">{item.code}</TableCell><TableCell><Badge variant={item.severity === "BLOCKER" || item.severity === "ERROR" ? "destructive" : "secondary"}>{item.severity}</Badge></TableCell><TableCell>{item.direction ?? "—"}</TableCell><TableCell>{item.occurrences}</TableCell><TableCell>{item.status}</TableCell></TableRow>)}</TableBody>
      </Table></CardContent></Card>

      <Card><CardHeader><CardTitle>AI-расходы за 24 часа</CardTitle></CardHeader><CardContent><Table>
        <TableHeader><TableRow><TableHead>Когда</TableHead><TableHead>Агент</TableHead><TableHead>Модель</TableHead><TableHead>Назначение</TableHead><TableHead>Токены</TableHead><TableHead>Время</TableHead><TableHead>Стоимость</TableHead><TableHead>Статус</TableHead></TableRow></TableHeader>
        <TableBody>{usage.map((item) => <TableRow key={item.id}><TableCell>{item.createdAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</TableCell><TableCell>{item.agentKey}</TableCell><TableCell>{item.model}</TableCell><TableCell>{item.purpose}</TableCell><TableCell>{fmt.format(item.totalTokens)}</TableCell><TableCell>{(item.durationMs / 1000).toFixed(1)} с</TableCell><TableCell>{item.estimatedCostUsd == null ? "—" : money.format(item.estimatedCostUsd)}</TableCell><TableCell>{item.status}</TableCell></TableRow>)}</TableBody>
      </Table></CardContent></Card>

      <Card><CardHeader><CardTitle>Значимые события</CardTitle></CardHeader><CardContent><Table>
        <TableHeader><TableRow><TableHead>Когда</TableHead><TableHead>Событие</TableHead><TableHead>Уровень</TableHead><TableHead>Направление</TableHead><TableHead>Сообщение</TableHead></TableRow></TableHeader>
        <TableBody>{events.map((item) => <TableRow key={item.id}><TableCell>{item.createdAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</TableCell><TableCell className="font-mono text-xs">{item.eventType}</TableCell><TableCell><Badge variant={item.level === "BLOCKER" || item.level === "ERROR" ? "destructive" : "secondary"}>{item.level}</Badge></TableCell><TableCell>{item.direction ?? "—"}</TableCell><TableCell>{item.message}</TableCell></TableRow>)}</TableBody>
      </Table></CardContent></Card>
    </div>
  );
}

function Metric({ title, value, danger = false }: { title: string; value: string; danger?: boolean }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle></CardHeader><CardContent><div className={`text-2xl font-bold ${danger ? "text-destructive" : ""}`}>{value}</div></CardContent></Card>;
}
