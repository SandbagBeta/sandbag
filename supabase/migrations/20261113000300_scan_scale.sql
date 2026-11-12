-- A reviewed scale for a scan (#134). Scans are modelled in the units of the
-- uploaded file, which can be wrong (a 20 m wall exported as 1.5 m). A
-- maintainer can set the factor during review; real size = file size *
-- scale_factor. The canonical GLB and its hash never change. Additive.
--
-- Only the service role writes these columns: `authenticated` has column-level
-- insert/update grants that do not list them (RLS migration). The app writes
-- them through src/lib/lifecycle/scale.ts.
alter table public.scans
  add column scale_factor numeric not null default 1
    check (scale_factor >= 0.001 and scale_factor <= 1000),
  add column scale_set_by uuid references public.profiles (id) on delete set null,
  add column scale_set_at timestamptz;
