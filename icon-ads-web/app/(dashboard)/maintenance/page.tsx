'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageShell from '@/components/ui/PageShell';
import { Btn, TabPill } from '@/components/ui/buttons';
import {
  api, MaintAlert, MaintAlertsResponse, MaintMeta, MaintOrder, MaintPart, MaintRule, TabletGroup, TabletMonitorEntry,
} from '@/lib/api';
import { useRole } from '@/lib/roles';
import { useToast } from '@/lib/toast-context';
import { AgendaTab, AlertsTab, OrdersTab } from '@/components/maintenance/WorkTabs';
import { ChecklistsTab, PartsTab, RulesTab } from '@/components/maintenance/ConfigTabs';
import { DiagnosticModal, HistoryModal, NewOrderModal, NewOrderPreset, SwapModal } from '@/components/maintenance/modals';
import { isOpen, isOverdue } from '@/components/maintenance/shared';

const TABS = [
  { id: 'alertas', label: 'Alertas' },
  { id: 'ordenes', label: 'Órdenes' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'repuestos', label: 'Repuestos' },
  { id: 'recurrentes', label: 'Recurrentes' },
  { id: 'checklists', label: 'Checklists' },
] as const;
type TabId = typeof TABS[number]['id'];

export default function MaintenancePage() {
  const router = useRouter();
  const { show } = useToast();
  const { canManage } = useRole();
  const [tab, setTab] = useState<TabId>('alertas');
  const [meta, setMeta] = useState<MaintMeta | null>(null);
  const [alerts, setAlerts] = useState<MaintAlertsResponse | null>(null);
  const [orders, setOrders] = useState<MaintOrder[] | null>(null);
  const [parts, setParts] = useState<MaintPart[] | null>(null);
  const [rules, setRules] = useState<MaintRule[] | null>(null);
  const [tablets, setTablets] = useState<TabletMonitorEntry[]>([]);
  const [groups, setGroups] = useState<TabletGroup[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [newOrder, setNewOrder] = useState<NewOrderPreset | null>(null);
  const [swap, setSwap] = useState(false);
  const [diag, setDiag] = useState<{ id: number; name: string } | null>(null);
  const [history, setHistory] = useState<{ id: number; name: string } | null>(null);

  // Pestaña desde la URL (?tab=agenda) para poder compartir el link.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lee la URL una vez al montar
    if (t && TABS.some((x) => x.id === t)) setTab(t as TabId);
  }, []);
  const changeTab = (t: TabId) => {
    setTab(t);
    window.history.replaceState(null, '', t === 'alertas' ? '/maintenance' : `/maintenance?tab=${t}`);
  };

  const load = useCallback(async () => {
    setRefreshing(true);
    const fail = (e: unknown) => show(e instanceof Error ? e.message : 'Error al cargar', 'error');
    await Promise.all([
      api.getMaintMeta().then(setMeta).catch(fail),
      api.getMaintAlerts().then(setAlerts).catch(fail),
      api.getMaintOrders().then(setOrders).catch(fail),
      api.getMaintParts().then(setParts).catch(fail),
      api.getMaintRules().then(setRules).catch(fail),
      api.getTabletMonitor().then((t) => setTablets([...t].sort((a, b) => a.name.localeCompare(b.name)))).catch(fail),
      api.getTabletGroups().then(setGroups).catch(() => setGroups([])),
    ]);
    setRefreshing(false);
  }, [show]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
  useEffect(() => { load(); }, [load]);

  const openOrders = orders?.filter(isOpen) ?? [];
  const kpis = [
    { label: 'Tablets con alertas', value: alerts ? new Set(alerts.alerts.map((a) => a.tabletId)).size : '—', color: 'var(--danger)', tab: 'alertas' as TabId },
    { label: 'Órdenes abiertas', value: orders ? openOrders.length : '—', color: 'var(--accent)', tab: 'ordenes' as TabId },
    { label: 'Vencidas', value: orders ? openOrders.filter(isOverdue).length : '—', color: 'var(--warn)', tab: 'agenda' as TabId },
    { label: 'En taller', value: alerts ? alerts.workshop.length : '—', color: 'var(--warn)', tab: 'alertas' as TabId },
    { label: 'Repuestos bajos', value: alerts ? alerts.lowStock.length : '—', color: 'var(--danger)', tab: 'repuestos' as TabId },
  ];
  const assignees = [...new Set((orders ?? []).map((o) => o.assignee).filter(Boolean) as string[])].sort();

  const fromAlert = (a: MaintAlert) => setNewOrder({
    tabletIds: [a.tabletId], type: a.suggestedType, alertCode: a.code, source: 'alerta',
    title: `${a.label} — ${a.tabletName}`, notes: a.detail,
  });

  return (
    <PageShell title="Mantenimiento" subtitle="Alertas de la flota, órdenes de trabajo, repuestos y mantenimiento programado."
      actions={(
        <>
          <Btn icon="refresh" onClick={load} disabled={refreshing}>{refreshing ? 'Actualizando…' : 'Actualizar'}</Btn>
          {canManage && <Btn icon="transfer" onClick={() => setSwap(true)}>Cambiar tablet</Btn>}
          {canManage && <Btn v="primary" icon="plus" onClick={() => setNewOrder({})}>Nueva orden</Btn>}
        </>
      )}>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <button key={k.label} type="button" onClick={() => changeTab(k.tab)}
            className="card p-4 text-left transition-colors hover:bg-[var(--surface-hover)]">
            <p className="text-3xl font-bold tabular-nums" style={{ color: Number(k.value) > 0 ? k.color : 'var(--text)' }}>{k.value}</p>
            <p className="mt-1 text-xs font-medium text-[var(--muted)]">{k.label}</p>
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => <TabPill key={t.id} active={tab === t.id} onClick={() => changeTab(t.id)}>{t.label}</TabPill>)}
      </div>

      {tab === 'alertas' && (
        <AlertsTab data={alerts} canManage={canManage} onCreateOrder={fromAlert}
          onDiagnostic={(id, name) => setDiag({ id, name })} onHistory={(id, name) => setHistory({ id, name })} />
      )}
      {tab === 'ordenes' && meta && <OrdersTab orders={orders} types={meta.types} />}
      {tab === 'agenda' && meta && <AgendaTab orders={orders} types={meta.types} />}
      {tab === 'repuestos' && <PartsTab parts={parts} canManage={canManage} onChanged={load} />}
      {tab === 'recurrentes' && meta && <RulesTab rules={rules} meta={meta} tablets={tablets} groups={groups} canManage={canManage} onChanged={load} />}
      {tab === 'checklists' && meta && <ChecklistsTab meta={meta} canManage={canManage} onSaved={(c) => setMeta({ ...meta, checklists: c })} />}

      {newOrder && meta && (
        <NewOrderModal tablets={tablets} meta={meta} preset={newOrder} assignees={assignees} onClose={() => setNewOrder(null)}
          onCreated={(created) => {
            setNewOrder(null);
            if (created.length === 1) router.push(`/maintenance/orden/${created[0].id}`);
            else { load(); changeTab('ordenes'); }
          }} />
      )}
      {swap && <SwapModal tablets={tablets} onClose={() => setSwap(false)} onDone={() => { setSwap(false); load(); }} />}
      {diag && <DiagnosticModal tabletId={diag.id} tabletName={diag.name} canManage={canManage} onClose={() => setDiag(null)} />}
      {history && meta && <HistoryModal tabletId={history.id} tabletName={history.name} types={meta.types} onClose={() => setHistory(null)} />}
    </PageShell>
  );
}
