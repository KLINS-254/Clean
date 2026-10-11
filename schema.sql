-- SAMRYC DISHES POS — initial schema
-- Run in Supabase SQL Editor using a trusted project owner account.
create extension if not exists pgcrypto;

create type public.staff_role as enum ('owner','waiter','cashier','kitchen');
create type public.order_status as enum ('held','new','preparing','ready','served','awaiting_payment','paid','cancelled','refunded');
create type public.payment_method as enum ('cash','mpesa','card','other');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text unique,
  role public.staff_role not null default 'waiter',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  description text not null default '',
  price_minor bigint not null check (price_minor >= 0),
  cost_minor bigint check (cost_minor is null or cost_minor >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  is_available boolean not null default true,
  preparation_minutes integer check (preparation_minutes is null or preparation_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create sequence public.order_number_seq start 1;
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null default ('ORD-' || lpad(nextval('public.order_number_seq')::text,6,'0')),
  created_by uuid not null references public.profiles(id),
  table_label text not null default 'Takeaway',
  status public.order_status not null default 'held',
  notes text not null default '',
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  amount_paid_minor bigint not null default 0 check (amount_paid_minor >= 0 and amount_paid_minor <= total_minor),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_created_at_idx on public.orders(created_at desc);
create index orders_status_idx on public.orders(status);
create index orders_created_by_idx on public.orders(created_by);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  instructions text not null default '',
  created_at timestamptz not null default now()
);
create index order_items_order_id_idx on public.order_items(order_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  received_by uuid not null references public.profiles(id),
  method public.payment_method not null,
  amount_minor bigint not null check (amount_minor > 0),
  reference text,
  status text not null default 'recorded' check (status in ('recorded','confirmed','reversed')),
  created_at timestamptz not null default now()
);
create index payments_created_at_idx on public.payments(created_at desc);
create index payments_order_id_idx on public.payments(order_id);

create sequence public.receipt_number_seq start 1;
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text unique not null default ('SD-' || lpad(nextval('public.receipt_number_seq')::text,8,'0')),
  order_id uuid not null references public.orders(id),
  payment_id uuid references public.payments(id),
  printed_by uuid references public.profiles(id),
  printed_at timestamptz not null default now(),
  duplicate boolean not null default false
);

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null default 'pcs',
  quantity numeric(14,3) not null default 0 check (quantity >= 0),
  low_stock_threshold numeric(14,3) not null default 0,
  updated_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid references public.inventory(id),
  product_id uuid references public.products(id),
  movement_type text not null check (movement_type in ('purchase','sale','adjustment','waste','return')),
  quantity_delta numeric(14,3) not null,
  reason text not null default '',
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (inventory_id is not null or product_id is not null)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_at_idx on public.audit_logs(created_at desc);

create table public.business_settings (
  id integer primary key default 1 check (id = 1),
  business_name text not null default 'SAMRYC DISHES',
  business_subtitle text not null default 'HOTEL & RESTAURANT',
  address text not null default '',
  phone text not null default '',
  currency text not null default 'KES',
  tax_enabled boolean not null default false,
  tax_rate numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  receipt_width integer not null default 80 check (receipt_width in (58,80)),
  receipt_footer text not null default 'THANK YOU! WE APPRECIATE YOUR VISIT. KARIBU TENA!',
  updated_at timestamptz not null default now()
);
insert into public.business_settings(id) values(1) on conflict do nothing;

-- Initial categories and tables.
insert into public.categories(name) values
('Breakfast'),('Main Meals'),('Local Dishes'),('Fast Food'),('Snacks'),('Beef'),('Chicken'),('Fish'),
('Rice and Pilau'),('Ugali and Accompaniments'),('Vegetables'),('Fresh Juice'),('Soft Drinks'),
('Water'),('Tea and Coffee'),('Other Beverages') on conflict(name) do nothing;
insert into public.restaurant_tables(label)
select 'Table '||n from generate_series(1,10) n on conflict(label) do nothing;

-- Auth helper functions. SECURITY DEFINER avoids recursive RLS checks; fixed search_path is important.
create or replace function public.current_staff_role()
returns public.staff_role language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.is_active_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and active=true) $$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and active=true and role='owner') $$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.receipts enable row level security;
alter table public.inventory enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_logs enable row level security;
alter table public.business_settings enable row level security;

-- No client can self-promote: profile writes are owner-only. Initial owner provisioning is done in SQL.
create policy "staff can read active staff directory" on public.profiles for select to authenticated using (public.is_active_staff() and (public.is_owner() or id=auth.uid()));
create policy "owner manages profiles" on public.profiles for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy "staff read categories" on public.categories for select to authenticated using (public.is_active_staff());
create policy "owner manages categories" on public.categories for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "staff read available products" on public.products for select to authenticated using (public.is_active_staff());
create policy "owner manages products" on public.products for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "staff read tables" on public.restaurant_tables for select to authenticated using (public.is_active_staff());
create policy "owner manages tables" on public.restaurant_tables for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy "staff read orders by role" on public.orders for select to authenticated using (
 public.is_active_staff() and (public.is_owner() or created_by=auth.uid() or public.current_staff_role() in ('cashier','kitchen'))
);
create policy "waiters create own orders" on public.orders for insert to authenticated with check (
 public.is_active_staff() and public.current_staff_role() in ('owner','waiter') and created_by=auth.uid()
);
create policy "owner waiter kitchen update orders" on public.orders for update to authenticated using (
 public.is_active_staff() and (public.is_owner() or (public.current_staff_role()='waiter' and created_by=auth.uid()) or public.current_staff_role()='kitchen')
) with check (public.is_active_staff());
create policy "owner may delete orders" on public.orders for delete to authenticated using (public.is_owner());

create policy "staff read order items for accessible orders" on public.order_items for select to authenticated using (
 exists(select 1 from public.orders o where o.id=order_id)
);
create policy "waiters add order items" on public.order_items for insert to authenticated with check (
 public.is_active_staff() and public.current_staff_role() in ('owner','waiter') and exists(select 1 from public.orders o where o.id=order_id and (o.created_by=auth.uid() or public.is_owner()))
);
create policy "owner waiter may edit order items" on public.order_items for update to authenticated using (
 public.is_active_staff() and (public.is_owner() or exists(select 1 from public.orders o where o.id=order_id and o.created_by=auth.uid() and o.status in ('held','new')))
) with check (public.is_active_staff());
create policy "owner may delete order items" on public.order_items for delete to authenticated using (public.is_owner());

create policy "owner cashier read payments" on public.payments for select to authenticated using (public.is_active_staff() and public.current_staff_role() in ('owner','cashier'));
create policy "cashier owner record payments" on public.payments for insert to authenticated with check (
 public.is_active_staff() and public.current_staff_role() in ('owner','cashier') and received_by=auth.uid()
);
create policy "owner only payment edits" on public.payments for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner reads receipts" on public.receipts for select to authenticated using (public.is_active_staff() and public.is_owner());
create policy "staff create receipts" on public.receipts for insert to authenticated with check (public.is_active_staff() and printed_by=auth.uid());
create policy "owner manages inventory" on public.inventory for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages stock movements" on public.stock_movements for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner reads audit logs" on public.audit_logs for select to authenticated using (public.is_active_staff() and public.is_owner());
create policy "staff insert audit logs" on public.audit_logs for insert to authenticated with check (public.is_active_staff() and actor_id=auth.uid());
create policy "staff read business settings" on public.business_settings for select to authenticated using (public.is_active_staff());
create policy "owner manages business settings" on public.business_settings for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- IMPORTANT HARDENING NOTES:
-- For production financial integrity, route order finalization/payment through a server-side RPC or API
-- that locks the order row, recalculates totals from order_items, checks balance, and inserts payment
-- atomically. Do not grant browser clients direct access to service_role.
-- The starter UI uses separate inserts/updates and is not suitable for high-concurrency production
-- until the transactional RPC described in README is implemented and used.
