// The one privacy notice, shown on the invite form and at /privacy. Keep it in step with the purge SQL in lib/reset.ts.
export function PrivacyText() {
  return (
    <>
      Your messages are sent to Anthropic&apos;s API twice: once to a separate Claude safety check and once to the Claude model that
      writes the replies. Anthropic deletes API inputs and outputs within 30 days, or keeps them up to 2 years if its safety systems
      flag a message, and does not train on them. On our side, the conversation is held in server memory and deleted about 2 hours
      after your last message; it is not written to our database or logs. What is stored: metadata (timings,
      outcomes, handoff reasons, no message text) for 30 days; for a handoff, the name and ZIP you gave, a summary (AI-written, or
      fixed text for a rule-based handoff) and a 300-character excerpt of your last message (phone numbers and emails masked) for
      about 7 days; for a test booking, the name, issue, ZIP and city you gave, until the nightly reset. No third-party analytics run
      on this site. Please use made-up names.
    </>
  );
}
