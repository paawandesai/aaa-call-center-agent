// Light redaction for the few places caller text is kept (handoff records for staff). Mirrors discovery/redact.py patterns.
const PATTERNS: [RegExp, string][] = [
  [/\bMHC-\d{4,6}\b/gi, "[ACCOUNT_ID]"],
  [/\bINV-\d{4,8}\b/gi, "[INVOICE_ID]"],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, "[EMAIL]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[CARD]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]"],
  [/\b(exp(iry|iration)?|cvv|cvc|security code)\b[^\n]{0,12}?\b\d{2}\s*\/\s*\d{2,4}\b|\b(cvv|cvc|security code)\b\D{0,12}\d{3,4}\b/gi, "[CARD_DETAIL]"],
  [/\b(born|birthday|date of birth|dob)\b[^\n]{0,15}?\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, "[DOB]"],
  [/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g, "[PHONE]"],
  [/\b\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Ct|Court|Way|Cv|Cove|Trl|Trail|Pkwy)\b\.?/g, "[ADDRESS]"],
  [/\b(gate|door|lockbox|alarm)\s+code\s*(is\s*)?[:#]?\s*\w+/gi, "[GATE_CODE]"],
  [/\b(code|pin)\b[^.?!\n]{0,25}\b(gate|door|lockbox|alarm|garage)\b[^.?!\n]{0,10}?\b\d{3,8}\b/gi, "[GATE_CODE]"],
];
export function redact(s: string): string {
  let out = s;
  for (const [re, tag] of PATTERNS) out = out.replace(re, tag);
  return out;
}
