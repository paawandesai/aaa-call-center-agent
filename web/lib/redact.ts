// Light redaction for the few places caller text is kept (handoff records for staff). Mirrors discovery/redact.py patterns.
const PATTERNS: [RegExp, string][] = [
  [/\bMHC-\d{4,6}\b/gi, "[ACCOUNT_ID]"],
  [/\bINV-\d{4,8}\b/gi, "[INVOICE_ID]"],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, "[EMAIL]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[CARD]"],
  [/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g, "[PHONE]"],
  [/\b\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Ct|Court|Way|Cv|Cove|Trl|Trail|Pkwy)\b\.?/g, "[ADDRESS]"],
  [/\b(gate|door|lockbox|alarm)\s+code\s*(is\s*)?[:#]?\s*\w+/gi, "[GATE_CODE]"],
];
export function redact(s: string): string {
  let out = s;
  for (const [re, tag] of PATTERNS) out = out.replace(re, tag);
  return out;
}
