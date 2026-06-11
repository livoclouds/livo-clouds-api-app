import { ArcoRequest, ArcoRequestType } from '@prisma/client';

// Printable proof documents for the data subject (RP-016). The web serves these
// as HTML the resident prints to PDF (browser "Save as PDF") — no server-side PDF
// dependency. Two kinds:
//   * DELIVERY  — proof that the request was received and acknowledged.
//   * RESOLUTION — proof of the outcome (completed / rejected), the official
//     certificate the resident keeps for their records.

type Locale = 'es' | 'en';
export type ArcoProofKind = 'DELIVERY' | 'RESOLUTION';

export interface ArcoProofContext {
  kind: ArcoProofKind;
  locale: string;
  request: Pick<
    ArcoRequest,
    | 'id'
    | 'type'
    | 'status'
    | 'channel'
    | 'description'
    | 'resolution'
    | 'rejectionReason'
    | 'referenceFolio'
    | 'receivedAt'
    | 'dueDate'
    | 'resolvedAt'
  >;
  residentName: string;
  condominiumName: string;
}

const TYPE_LABEL: Record<Locale, Record<ArcoRequestType, string>> = {
  es: { ACCESS: 'Acceso', RECTIFICATION: 'Rectificación', CANCELLATION: 'Cancelación', OPPOSITION: 'Oposición' },
  en: { ACCESS: 'Access', RECTIFICATION: 'Rectification', CANCELLATION: 'Cancellation', OPPOSITION: 'Opposition' },
};

const T = {
  es: {
    deliveryTitle: 'Acuse de recepción — Solicitud ARCO',
    resolutionTitle: 'Constancia de resolución — Solicitud ARCO',
    subject: 'Titular',
    folio: 'Folio',
    type: 'Derecho ejercido',
    channel: 'Canal',
    received: 'Fecha de recepción',
    due: 'Plazo legal de respuesta',
    resolved: 'Fecha de resolución',
    request: 'Solicitud',
    outcome: 'Resolución',
    rejection: 'Motivo del rechazo',
    completed: 'Completada',
    rejected: 'Rechazada',
    status: 'Estado',
    disclaimerDelivery:
      'Este documento acredita que el condominio recibió la solicitud de derechos ARCO indicada conforme a la LFPDPPP. El condominio dispone de 20 días hábiles para responder a partir de la fecha de recepción.',
    disclaimerResolution:
      'Este documento es la constancia oficial de la resolución de la solicitud de derechos ARCO indicada, conforme a la LFPDPPP. Si el titular no está de acuerdo con la resolución puede contactar a la administración del condominio.',
    issued: 'Emitido',
    signature: 'Firma / sello del responsable',
  },
  en: {
    deliveryTitle: 'Proof of receipt — ARCO request',
    resolutionTitle: 'Proof of resolution — ARCO request',
    subject: 'Data subject',
    folio: 'Reference',
    type: 'Right exercised',
    channel: 'Channel',
    received: 'Received on',
    due: 'Legal response deadline',
    resolved: 'Resolved on',
    request: 'Request',
    outcome: 'Resolution',
    rejection: 'Rejection reason',
    completed: 'Completed',
    rejected: 'Rejected',
    status: 'Status',
    disclaimerDelivery:
      'This document certifies that the condominium received the ARCO data-subject request below under the LFPDPPP. The condominium has 20 business days from the receipt date to respond.',
    disclaimerResolution:
      'This document is the official record of the resolution of the ARCO data-subject request below, under the LFPDPPP. If the data subject disagrees with the outcome they may contact the condominium administration.',
    issued: 'Issued',
    signature: 'Controller signature / stamp',
  },
} as const;

function normalizeLocale(locale: string): Locale {
  return locale.toLowerCase().startsWith('en') ? 'en' : 'es';
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(locale: Locale, date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Mexico_City',
  }).format(date);
}

export function buildProofDocument(ctx: ArcoProofContext): {
  html: string;
  fileName: string;
} {
  const locale = normalizeLocale(ctx.locale);
  const t = T[locale];
  const r = ctx.request;
  const typeLabel = TYPE_LABEL[locale][r.type];
  const isResolution = ctx.kind === 'RESOLUTION';
  const title = isResolution ? t.resolutionTitle : t.deliveryTitle;

  const row = (label: string, value: string) =>
    `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;

  const rows = [
    row(t.subject, ctx.residentName),
    r.referenceFolio ? row(t.folio, r.referenceFolio) : '',
    row(t.type, typeLabel),
    r.channel ? row(t.channel, r.channel) : '',
    row(t.received, fmtDate(locale, r.receivedAt)),
    isResolution
      ? row(t.resolved, fmtDate(locale, r.resolvedAt))
      : row(t.due, fmtDate(locale, r.dueDate)),
    row(t.request, r.description),
    isResolution
      ? row(
          t.status,
          r.status === 'REJECTED' ? t.rejected : t.completed,
        )
      : '',
    isResolution && r.status === 'REJECTED' && r.rejectionReason
      ? row(t.rejection, r.rejectionReason)
      : '',
    isResolution && r.status !== 'REJECTED' && r.resolution
      ? row(t.outcome, r.resolution)
      : '',
  ]
    .filter(Boolean)
    .join('');

  const disclaimer = isResolution
    ? t.disclaimerResolution
    : t.disclaimerDelivery;

  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · ${esc(r.id)}</title>
<style>
  @page { margin: 24mm; }
  body { font-family: -apple-system, system-ui, sans-serif; color: #1e293b; max-width: 720px; margin: 0 auto; padding: 32px; }
  header { border-bottom: 2px solid #6366f1; padding-bottom: 12px; margin-bottom: 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .condo { color: #475569; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
  th { width: 38%; color: #475569; font-weight: 600; }
  .disclaimer { font-size: 11px; color: #64748b; margin-top: 20px; line-height: 1.5; }
  .sign { margin-top: 56px; }
  .sign .line { border-top: 1px solid #94a3b8; width: 280px; padding-top: 6px; font-size: 11px; color: #64748b; }
  .meta { font-size: 11px; color: #94a3b8; margin-top: 8px; }
  @media print { body { padding: 0; } .noprint { display: none; } }
</style>
</head>
<body>
  <header>
    <h1>${esc(title)}</h1>
    <div class="condo">${esc(ctx.condominiumName)}</div>
  </header>
  <table>${rows}</table>
  <p class="disclaimer">${esc(disclaimer)}</p>
  <div class="sign"><div class="line">${esc(t.signature)}</div></div>
  <p class="meta">${esc(t.issued)}: ${fmtDate(locale, ctx.request.resolvedAt ?? ctx.request.receivedAt)} · ID ${esc(r.id)}</p>
</body>
</html>`;

  const fileName = `${isResolution ? 'arco-proof-of-resolution' : 'arco-proof-of-delivery'}_${r.id}.html`;
  return { html, fileName };
}
