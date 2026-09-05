"use client";

import type { AdminConsoleRoleId } from "@orbit/config/admin-auth";

import { StateFeedback } from "@/components/state-feedback";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Panel, Well } from "@/components/ui/panel";
import {
  roleCapabilities,
  severityLabel,
  type CockpitSeverity,
  type CockpitStatus,
  type CockpitView,
} from "@/lib/admin-cockpit";
import { applicationCopy } from "@/lib/identity";

/** Severity keeps its explicit word alongside the tone, so colour is never the only carrier. */
const severityTone: Record<CockpitSeverity, BadgeTone> = {
  critical: "danger",
  warning: "warning",
  notice: "info",
  ok: "success",
};

const freshnessTone: Record<CockpitStatus["freshness"], BadgeTone> = {
  fresh: "neutral",
  stale: "warning",
  unknown: "neutral",
};

const capsLabel =
  "font-mono text-label font-semibold tracking-[0.1em] text-ink uppercase";

/**
 * Every status names its source, observation point, freshness, owner, impact,
 * and recommended next step. The answer and the next step stay in the open; the
 * provenance sits one disclosure away.
 */
function StatusCard({ status }: { readonly status: CockpitStatus }) {
  const fields = applicationCopy.cockpit.fields;
  return (
    <Well className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3
          className={`${capsLabel} [overflow-wrap:anywhere]`}
          data-severity={status.severity}
        >
          {status.title}
        </h3>
        <Badge className="ml-auto" dot tone={severityTone[status.severity]}>
          {severityLabel[status.severity]}
        </Badge>
        <Badge tone={freshnessTone[status.freshness]}>
          {applicationCopy.cockpit.freshness[status.freshness]}
        </Badge>
      </div>
      <p className="font-mono text-body-sm text-ink">{status.observed}</p>
      <p className="text-body-sm text-ink-soft">{status.nextStep}</p>
      <Disclosure title={fields.source}>
        <DataList>
          <DataRow label={fields.source} value={status.source} />
          <DataRow label={fields.observedAt} value={status.observedAt} />
          <DataRow label={fields.owner} value={status.owner} />
          <DataRow label={fields.impact} value={status.impact} />
        </DataList>
      </Disclosure>
    </Well>
  );
}

function AttentionPanel({ view }: { readonly view: CockpitView }) {
  return (
    <Panel
      className="laptop:col-span-12"
      meta={
        <Badge dot tone={severityTone[view.globalSeverity]}>
          {severityLabel[view.globalSeverity]}
        </Badge>
      }
      title={applicationCopy.cockpit.attentionHeading}
      tone={view.globalSeverity === "ok" ? "default" : "live"}
    >
      {/* Severity changes are announced, since an operator may be elsewhere on
          the page when a read resolves. */}
      <p
        className="mb-3 font-mono text-body-sm text-ink"
        data-severity={view.globalSeverity}
        role="status"
      >
        {view.headline}
      </p>
      <div aria-live="polite" className="grid gap-2 laptop:grid-cols-2">
        {view.attention.length === 0 ? (
          <StateFeedback
            compact
            description={applicationCopy.cockpit.attentionEmpty}
            title={applicationCopy.cockpit.headline.ok}
            tone="success"
          />
        ) : (
          view.attention.map((status) => (
            <StatusCard key={status.id} status={status} />
          ))
        )}
      </div>
    </Panel>
  );
}

function ServicePanel({ view }: { readonly view: CockpitView }) {
  return (
    <Panel
      className="laptop:col-span-6"
      meta={view.nextRun}
      title={applicationCopy.cockpit.servicesHeading}
    >
      <DataList>
        {view.services.map((status) => (
          <DataRow
            key={status.id}
            label={status.title}
            note={applicationCopy.cockpit.freshness[status.freshness]}
            value={
              <Badge dot tone={severityTone[status.severity]}>
                {status.observed}
              </Badge>
            }
          />
        ))}
        {view.lastOutcome === undefined ? null : (
          <DataRow
            label={view.lastOutcome.title}
            value={
              <Badge tone={severityTone[view.lastOutcome.severity]}>
                {view.lastOutcome.detail}
              </Badge>
            }
          />
        )}
      </DataList>
    </Panel>
  );
}

/** States what this actor can and cannot do, explicitly, in both directions. */
function RolePanel({
  roles,
}: {
  readonly roles: readonly AdminConsoleRoleId[];
}) {
  const summary = roleCapabilities(roles);
  return (
    <Panel
      className="laptop:col-span-6"
      title={applicationCopy.cockpit.rolesHeading}
    >
      <div className="grid gap-4 tablet:grid-cols-2">
        <div className="min-w-0">
          <h3 className={capsLabel}>{applicationCopy.cockpit.canHeading}</h3>
          {summary.can.length === 0 ? (
            <p className="mt-2 text-body-sm text-ink-soft">
              {applicationCopy.operations.noActionableCapability}
            </p>
          ) : (
            <ul className="mt-2 grid gap-1.5 text-body-sm text-ink">
              {summary.can.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          <h3 className={capsLabel}>{applicationCopy.cockpit.cannotHeading}</h3>
          {summary.cannot.length === 0 ? (
            <p className="mt-2 text-body-sm text-ink-soft">
              {applicationCopy.cockpit.cannotEmpty}
            </p>
          ) : (
            <ul className="mt-2 grid gap-1.5 text-body-sm text-ink-faint">
              {summary.cannot.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

/**
 * The cockpit answers who is in control, what needs attention, and what may
 * safely run, before any protocol structure is shown.
 */
export function AdminCockpit({ view }: { readonly view: CockpitView }) {
  return (
    <>
      <AttentionPanel view={view} />
      <ServicePanel view={view} />
      <RolePanel roles={view.roles} />
    </>
  );
}
