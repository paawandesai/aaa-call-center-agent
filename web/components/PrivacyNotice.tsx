// The one privacy notice, shown on the invite form and at /privacy. Keep it in step with the purge SQL in lib/reset.ts.
export function PrivacyText() {
  return (
    <>
      Your messages are sent to Anthropic&apos;s Claude model to write the replies. The conversation itself is held in server memory
      and deleted 2 hours after your last message; it is not written to the database or to logs. What is stored: metadata (timings,
      outcomes, handoff reasons, no message text) for 30 days; for a handoff, the name and ZIP you gave, a summary (AI-written, or
      fixed text for a rule-based handoff) and a 300-character excerpt of your last message (phone numbers and emails masked) for
      about 7 days; for a test booking, the name, issue, ZIP and city you gave, until the nightly reset. No third-party analytics run
      on this site. Please use made-up names.
    </>
  );
}
