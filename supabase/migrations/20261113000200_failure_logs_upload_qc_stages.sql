-- Upload and automated-check (QC) failures use the same private failure log as
-- saving (#130). Adds the two stages. Additive: widens a check, no data moves.
alter table public.failure_logs drop constraint failure_logs_stage_check;
alter table public.failure_logs add constraint failure_logs_stage_check
  check (stage in (
    'session', 'payload', 'scan', 'mesh', 'validation', 'access', 'database',
    'upload', 'qc', 'unknown'));
