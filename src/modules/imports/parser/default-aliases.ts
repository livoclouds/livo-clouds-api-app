export interface FieldDefinition {
  key: string;
  label: string;
  system: boolean;
  required: boolean;
  aliases: string[];
}

export const SYSTEM_FIELD_KEYS = [
  'date',
  'description',
  'charges',
  'credits',
  'balance',
] as const;

export type SystemFieldKey = (typeof SYSTEM_FIELD_KEYS)[number];

export const DEFAULT_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    key: 'date',
    label: 'Fecha',
    system: true,
    required: true,
    aliases: ['fecha movimiento', 'fecha', 'date', 'fecha operación', 'fecha valor'],
  },
  {
    key: 'description',
    label: 'Descripción',
    system: true,
    required: true,
    aliases: ['descripción', 'descripcion', 'concepto', 'description'],
  },
  {
    key: 'charges',
    label: 'Cargos',
    system: true,
    required: true,
    aliases: ['cargos', 'cargo', 'débito', 'debito', 'charges', 'retiros'],
  },
  {
    key: 'credits',
    label: 'Abonos',
    system: true,
    required: true,
    aliases: ['abonos', 'abono', 'crédito', 'credito', 'credits', 'depósitos', 'depositos'],
  },
  {
    key: 'balance',
    label: 'Saldo',
    system: true,
    required: true,
    aliases: ['saldo', 'balance'],
  },
  {
    key: 'transactionNumber',
    label: 'Número',
    system: false,
    required: false,
    aliases: ['no.', 'núm.', 'número', 'num.', 'num', '#'],
  },
  {
    key: 'time',
    label: 'Hora',
    system: false,
    required: false,
    aliases: ['hora', 'hour', 'time'],
  },
  {
    key: 'receipt',
    label: 'Recibo',
    system: false,
    required: false,
    aliases: ['recibo', 'folio', 'receipt', 'referencia', 'ref'],
  },
];

export class ImportProfileMismatchError extends Error {
  readonly missingFields: { key: string; label: string }[];
  readonly actualHeaders: string[];

  constructor(missingFields: { key: string; label: string }[], actualHeaders: string[]) {
    const fieldList = missingFields.map((f) => f.label).join(', ');
    super(
      `Bank profile does not match file headers. Missing columns for: ${fieldList || '(unknown)'}`,
    );
    this.name = 'ImportProfileMismatchError';
    this.missingFields = missingFields;
    this.actualHeaders = actualHeaders;
  }
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function buildAliasIndex(
  fields: FieldDefinition[],
): { key: string; normalizedAliases: string[] }[] {
  return fields.map((f) => ({
    key: f.key,
    normalizedAliases: f.aliases.map(normalize).filter((a) => a.length > 0),
  }));
}

export function matchHeaderToFieldKey(
  headerText: string,
  index: { key: string; normalizedAliases: string[] }[],
): string | null {
  const norm = normalize(headerText);
  if (!norm) return null;
  for (const entry of index) {
    if (entry.normalizedAliases.some((alias) => norm.includes(alias))) {
      return entry.key;
    }
  }
  return null;
}

export function findMissingRequiredFields(
  fields: FieldDefinition[],
  resolvedKeys: Set<string>,
): { key: string; label: string }[] {
  return fields
    .filter((f) => f.required && !resolvedKeys.has(f.key))
    .map((f) => ({ key: f.key, label: f.label }));
}
