export interface ParsedRow {
  date: string;
  description: string;
  charges: number;
  credits: number;
  balance: number;
  flowType: 'income' | 'expense';
  transactionNumber?: string;
  time?: string;
  receipt?: string;
}
