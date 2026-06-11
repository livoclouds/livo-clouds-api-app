import { ArcoRequestStatus, ArcoRequestType } from '@prisma/client';

// Resident-facing ARCO notifications (LFPDPPP transparency obligation). The
// data subject is a resident, not necessarily an app user, so these are emails
// built here and sent through EmailService — independent of the in-app
// NotificationType fan-out used for staff alerts. Content is localized to the
// condominium's default locale (residents have no per-person locale).

type Locale = 'es' | 'en';

export interface ArcoEmailContext {
  locale: string;
  residentName: string;
  condominiumName: string;
  type: ArcoRequestType;
  status: ArcoRequestStatus;
  referenceFolio?: string | null;
  dueDate?: Date | null;
  resolution?: string | null;
  rejectionReason?: string | null;
}

export interface ArcoEmail {
  subject: string;
  html: string;
}

const TYPE_LABEL: Record<Locale, Record<ArcoRequestType, string>> = {
  es: {
    ACCESS: 'Acceso',
    RECTIFICATION: 'Rectificación',
    CANCELLATION: 'Cancelación',
    OPPOSITION: 'Oposición',
  },
  en: {
    ACCESS: 'Access',
    RECTIFICATION: 'Rectification',
    CANCELLATION: 'Cancellation',
    OPPOSITION: 'Opposition',
  },
};

function normalizeLocale(locale: string): Locale {
  return locale.toLowerCase().startsWith('en') ? 'en' : 'es';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Mexico_City',
  }).format(date);
}

function shell(title: string, bodyHtml: string, footer: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color:#1e293b;">
      <h2 style="margin-bottom: 12px;">${escapeHtml(title)}</h2>
      ${bodyHtml}
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">${escapeHtml(footer)}</p>
    </div>
  `;
}

/** Receipt notice — sent when an ARCO request is logged for the resident. */
export function buildReceiptEmail(ctx: ArcoEmailContext): ArcoEmail {
  const locale = normalizeLocale(ctx.locale);
  const typeLabel = TYPE_LABEL[locale][ctx.type];
  const due = ctx.dueDate ? formatDate(locale, ctx.dueDate) : null;

  if (locale === 'en') {
    const lines = [
      `<p>Hello ${escapeHtml(ctx.residentName)},</p>`,
      `<p>${escapeHtml(ctx.condominiumName)} has received your data-subject (ARCO) request of type <strong>${escapeHtml(typeLabel)}</strong>.</p>`,
      ctx.referenceFolio
        ? `<p>Reference: <strong>${escapeHtml(ctx.referenceFolio)}</strong></p>`
        : '',
      due
        ? `<p>By law we will respond no later than <strong>${escapeHtml(due)}</strong>.</p>`
        : '',
    ];
    return {
      subject: `Your ${typeLabel} request was received`,
      html: shell(
        'Request received',
        lines.join(''),
        'This is an automated transparency notice. Please do not reply to this email.',
      ),
    };
  }

  const lines = [
    `<p>Hola ${escapeHtml(ctx.residentName)}:</p>`,
    `<p>${escapeHtml(ctx.condominiumName)} ha recibido tu solicitud de derechos ARCO de tipo <strong>${escapeHtml(typeLabel)}</strong>.</p>`,
    ctx.referenceFolio
      ? `<p>Referencia: <strong>${escapeHtml(ctx.referenceFolio)}</strong></p>`
      : '',
    due
      ? `<p>Por ley responderemos a más tardar el <strong>${escapeHtml(due)}</strong>.</p>`
      : '',
  ];
  return {
    subject: `Recibimos tu solicitud de ${typeLabel}`,
    html: shell(
      'Solicitud recibida',
      lines.join(''),
      'Este es un aviso de transparencia automático. Por favor no respondas a este correo.',
    ),
  };
}

/** Resolution notice — sent when a request reaches COMPLETED or REJECTED. */
export function buildResolutionEmail(ctx: ArcoEmailContext): ArcoEmail {
  const locale = normalizeLocale(ctx.locale);
  const typeLabel = TYPE_LABEL[locale][ctx.type];
  const rejected = ctx.status === ArcoRequestStatus.REJECTED;

  if (locale === 'en') {
    const lines = [
      `<p>Hello ${escapeHtml(ctx.residentName)},</p>`,
      rejected
        ? `<p>Your ${escapeHtml(typeLabel)} request has been <strong>rejected</strong>.</p>`
        : `<p>Your ${escapeHtml(typeLabel)} request has been <strong>completed</strong>.</p>`,
      rejected && ctx.rejectionReason
        ? `<p>Reason: ${escapeHtml(ctx.rejectionReason)}</p>`
        : '',
      !rejected && ctx.resolution
        ? `<p>${escapeHtml(ctx.resolution)}</p>`
        : '',
    ];
    return {
      subject: rejected
        ? `Your ${typeLabel} request was rejected`
        : `Your ${typeLabel} request was completed`,
      html: shell(
        rejected ? 'Request rejected' : 'Request completed',
        lines.join(''),
        'This is an automated transparency notice. If you disagree with this outcome you may contact the condominium administration.',
      ),
    };
  }

  const lines = [
    `<p>Hola ${escapeHtml(ctx.residentName)}:</p>`,
    rejected
      ? `<p>Tu solicitud de ${escapeHtml(typeLabel)} ha sido <strong>rechazada</strong>.</p>`
      : `<p>Tu solicitud de ${escapeHtml(typeLabel)} ha sido <strong>completada</strong>.</p>`,
    rejected && ctx.rejectionReason
      ? `<p>Motivo: ${escapeHtml(ctx.rejectionReason)}</p>`
      : '',
    !rejected && ctx.resolution ? `<p>${escapeHtml(ctx.resolution)}</p>` : '',
  ];
  return {
    subject: rejected
      ? `Tu solicitud de ${typeLabel} fue rechazada`
      : `Tu solicitud de ${typeLabel} fue completada`,
    html: shell(
      rejected ? 'Solicitud rechazada' : 'Solicitud completada',
      lines.join(''),
      'Este es un aviso de transparencia automático. Si no estás de acuerdo con la resolución puedes contactar a la administración del condominio.',
    ),
  };
}
