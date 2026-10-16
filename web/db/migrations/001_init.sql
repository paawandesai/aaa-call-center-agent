-- Scheduling tables mirror the partner's SQLite schema, plus derived UTC times and integrity rules.
-- seed_* tables hold the pristine copy that the nightly reset restores.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS technicians (
  tech_id integer PRIMARY KEY,
  name text NOT NULL,
  skills text NOT NULL,
  home_zone text NOT NULL CHECK (home_zone IN ('north','central','south'))
);

CREATE TABLE IF NOT EXISTS customers (
  customer_id text PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  service_address text NOT NULL,
  city text NOT NULL,
  zip text NOT NULL,
  membership_tier text NOT NULL DEFAULT 'none' CHECK (membership_tier IN ('none','standard','plus')),
  membership_renewal_date date,
  system_brand text,
  system_install_date date,
  created_by_session text          -- set only for rows the demo agent created
);

CREATE TABLE IF NOT EXISTS appointment_slots (
  slot_id integer PRIMARY KEY,
  slot_date date NOT NULL,
  "window" text NOT NULL CHECK ("window" IN ('08:00-12:00','12:00-16:00','13:00-17:00','16:00-19:00')),
  tech_id integer NOT NULL REFERENCES technicians(tech_id),
  zone text NOT NULL CHECK (zone IN ('north','central','south')),
  service_type text NOT NULL CHECK (service_type IN ('hvac_repair','hvac_tune_up','plumbing','estimate')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','reserved_members','blocked')),
  tz text NOT NULL DEFAULT 'America/Chicago',
  start_utc timestamptz NOT NULL,
  end_utc timestamptz NOT NULL,
  CHECK (end_utc > start_utc)
);
CREATE INDEX IF NOT EXISTS slots_lookup ON appointment_slots (zone, service_type, slot_date);
CREATE INDEX IF NOT EXISTS slots_tech_time ON appointment_slots USING gist (tech_id, tstzrange(start_utc, end_utc));

CREATE TABLE IF NOT EXISTS appointments (
  appointment_id serial PRIMARY KEY,
  slot_id integer NOT NULL REFERENCES appointment_slots(slot_id),
  customer_id text NOT NULL REFERENCES customers(customer_id),
  issue_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  is_warranty_visit boolean NOT NULL DEFAULT false,
  booked_by_session text,
  idempotency_key text UNIQUE,
  booking_ref text UNIQUE
);
-- One live appointment per slot row.
CREATE UNIQUE INDEX IF NOT EXISTS one_live_appt_per_slot ON appointments (slot_id) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS invoices (
  invoice_id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(customer_id),
  appointment_id integer REFERENCES appointments(appointment_id),
  issued_date date NOT NULL,
  due_date date NOT NULL,
  amount_cents integer NOT NULL,
  balance_cents integer NOT NULL,
  line_items jsonb NOT NULL
);

-- Audit F1: the partner data has one slot row per tech x window x service type, and 12-16 overlaps 13-17.
-- The seed already holds 44 overlapping appointment pairs, so a table-wide exclusion constraint cannot be added.
-- Instead every NEW scheduled appointment is rejected if the technician has any other scheduled appointment
-- or blocked slot overlapping its time range. The booking transaction also locks the technician row first,
-- so two concurrent bookings for the same technician serialize.
CREATE OR REPLACE FUNCTION reject_overlapping_appointment() RETURNS trigger AS $$
DECLARE s appointment_slots%ROWTYPE;
BEGIN
  IF NEW.status <> 'scheduled' THEN RETURN NEW; END IF;
  SELECT * INTO s FROM appointment_slots WHERE slot_id = NEW.slot_id;
  IF EXISTS (
    SELECT 1 FROM appointments a JOIN appointment_slots o ON o.slot_id = a.slot_id
    WHERE a.status = 'scheduled' AND a.appointment_id <> NEW.appointment_id
      AND o.tech_id = s.tech_id
      AND tstzrange(o.start_utc, o.end_utc) && tstzrange(s.start_utc, s.end_utc)
  ) OR EXISTS (
    SELECT 1 FROM appointment_slots o
    WHERE o.status = 'blocked' AND o.tech_id = s.tech_id AND o.slot_id <> s.slot_id
      AND tstzrange(o.start_utc, o.end_utc) && tstzrange(s.start_utc, s.end_utc)
  ) THEN
    RAISE EXCEPTION 'technician % already committed in this time range', s.tech_id USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_no_overlap ON appointments;
CREATE TRIGGER appointments_no_overlap BEFORE INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION reject_overlapping_appointment();

-- Pristine copies for the nightly reset.
CREATE TABLE IF NOT EXISTS seed_customers (LIKE customers INCLUDING ALL);
CREATE TABLE IF NOT EXISTS seed_appointment_slots (LIKE appointment_slots INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS seed_appointments (LIKE appointments INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS seed_invoices (LIKE invoices INCLUDING DEFAULTS);

-- Knowledge base: curated chunks only (kb/registry.py decides what is indexed).
CREATE TABLE IF NOT EXISTS kb_chunks (
  id text PRIMARY KEY,
  doc text NOT NULL,
  doc_title text NOT NULL,
  section text NOT NULL,
  effective text,             -- as written in the source (a full date, or just a year)
  kind text NOT NULL,
  text text NOT NULL,
  embed_model text NOT NULL,
  embedding vector(384) NOT NULL
);

-- Demo access and first-party telemetry. No request bodies or caller text are stored in events.
CREATE TABLE IF NOT EXISTS sessions (
  session_id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('caller','staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  bookings_made integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  session_id text,
  turn_id text,
  kind text NOT NULL,
  intent text,
  outcome text,
  reason text,
  latency_ms integer,
  first_token_ms integer,
  input_tokens integer,
  output_tokens integer,
  top_score real,
  meta jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);

CREATE TABLE IF NOT EXISTS handoffs (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  session_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('safety','billing_account','cancel_reschedule','complaint','human_requested',
    'low_confidence','service_area_unclear','booking_failed','out_of_scope','adversarial')),
  intent text,
  steps_tried jsonb NOT NULL DEFAULT '[]',
  caller_provided jsonb NOT NULL DEFAULT '{}',
  slot jsonb,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','resolved')),
  resolution text
);

CREATE TABLE IF NOT EXISTS feedback (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  session_id text,
  turn_id text,
  rating text CHECK (rating IN ('up','down')),
  category text
);

CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, value text NOT NULL);

-- Review decisions are proposals only. Nothing here changes the KB, prompts or tests automatically.
CREATE TABLE IF NOT EXISTS reviews (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  turn_id text NOT NULL,
  flag text NOT NULL CHECK (flag IN ('stale_fact','missed_handoff','could_have_answered','caller_feedback','other')),
  decision text NOT NULL CHECK (decision IN ('agree','disagree','needs_fix')),
  proposed_fix text,
  add_to_regression boolean NOT NULL DEFAULT false
);
