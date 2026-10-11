-- SAMRYC DISHES POS database schema
-- Run in Supabase SQL Editor as project administrator.
create extension if not exists pgcrypto;

create type public.staff_role as enum ('Owner','Waiter 1','Waiter 2','Waiter 3','Waiter 4','Cashier');
create type public.order_status as enum ('Pending','Preparing','Ready','Completed','Cancelled');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.staff_role not null default 'Waiter 1',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('Breakfast','Main Meals','Snacks','Soft Drinks','Hot Drinks','Water','Other Items')),
  price numeric(12,2) not null check (price >= 0),
  available boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null default ('SD-' || to_char(now(),'YYMMDD') || '-' || upper(substr(encode(gen_random_bytes(5),'hex'),1,8))),
  order_type text not null check (order_type in ('Table','Takeaway')),
  table_number text,
  customer_name text,
  staff_id uuid not null references public.profiles(id),
  staff_name text not null,
  status public.order_status not null default 'Pending',
  subtotal numeric(12,2) not null check (subtotal >= 0),
  total numeric(12,2) not null check (total >= 0),
  paid boolean not null default false,
  created_at timestamptz not null default now(),
  check ((order_type='Takeaway') or (table_number is not null and length(trim(table_number))>0))
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  item_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) generated always as (quantity * unit_price) stored
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id),
  receipt_number text unique not null default ('R-' || to_char(now(),'YYMMDD') || '-' || upper(substr(encode(gen_random_bytes(5),'hex'),1,8))),
  method text not null check (method in ('Cash','M-Pesa','Other')),
  amount numeric(12,2) not null check (amount >= 0),
  cashier_id uuid not null references public.profiles(id),
  cashier_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.hotel_settings (
  id integer primary key check (id=1),
  hotel_name text not null default 'SAMRYC DISHES',
  hotel_address text not null default '',
  hotel_phone text not null default ''
);
insert into public.hotel_settings(id,hotel_name) values(1,'SAMRYC DISHES') on conflict(id) do nothing;

create or replace function public.current_role()
returns public.staff_role language sql stable security definer
set search_path=public
as $$
  select role from public.profiles where id=auth.uid() and active=true limit 1
$$;

create or replace function public.is_active_staff()
returns boolean language sql stable security definer
set search_path=public
as $$
  select exists(select 1 from public.profiles where id=auth.uid() and active=true)
$$;

alter table public.profiles enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.hotel_settings enable row level security;

drop policy if exists "staff read profiles" on public.profiles;
create policy "staff read profiles" on public.profiles for select to authenticated
using (public.is_active_staff() and (id=auth.uid() or public.current_role()='Owner'));
drop policy if exists "owner update profiles" on public.profiles;
create policy "owner update profiles" on public.profiles for update to authenticated
using (public.current_role()='Owner') with check (public.current_role()='Owner');

drop policy if exists "active staff read menu" on public.menu_items;
create policy "active staff read menu" on public.menu_items for select to authenticated using (public.is_active_staff());
drop policy if exists "owner insert menu" on public.menu_items;
create policy "owner insert menu" on public.menu_items for insert to authenticated with check (public.current_role()='Owner');
drop policy if exists "owner update menu" on public.menu_items;
create policy "owner update menu" on public.menu_items for update to authenticated using (public.current_role()='Owner') with check (public.current_role()='Owner');
drop policy if exists "owner delete menu" on public.menu_items;
create policy "owner delete menu" on public.menu_items for delete to authenticated using (public.current_role()='Owner');

drop policy if exists "staff read orders" on public.orders;
create policy "staff read orders" on public.orders for select to authenticated using (public.is_active_staff());
drop policy if exists "staff update order status" on public.orders;
-- Order status changes go through update_order_status() so clients cannot change totals/payment flags.
drop policy if exists "staff read order items" on public.order_items;
create policy "staff read order items" on public.order_items for select to authenticated using (public.is_active_staff());
drop policy if exists "cashier read payments" on public.payments;
create policy "cashier read payments" on public.payments for select to authenticated using (public.current_role() in ('Owner','Cashier'));
drop policy if exists "owner read settings" on public.hotel_settings;
create policy "owner read settings" on public.hotel_settings for select to authenticated using (public.is_active_staff());
drop policy if exists "owner update settings" on public.hotel_settings;
create policy "owner update settings" on public.hotel_settings for update to authenticated using (public.current_role()='Owner') with check (public.current_role()='Owner');
drop policy if exists "owner insert settings" on public.hotel_settings;
create policy "owner insert settings" on public.hotel_settings for insert to authenticated with check (public.current_role()='Owner');

-- Orders are created through this function so prices are fetched from the database,
-- not trusted from the browser. All item inserts happen atomically.
create or replace function public.create_order(
  p_order_type text,
  p_table_number text,
  p_customer_name text,
  p_items jsonb,
  p_total numeric default null
) returns jsonb language plpgsql security definer
set search_path=public
as $$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_menu public.menu_items%rowtype;
  v_qty integer;
  v_total numeric(12,2):=0;
begin
  if auth.uid() is null or not public.is_active_staff() then raise exception 'Active staff login required'; end if;
  if p_order_type not in ('Table','Takeaway') then raise exception 'Invalid order type'; end if;
  if p_order_type='Table' and coalesce(trim(p_table_number),'')='' then raise exception 'Table number required'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Order must contain items'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty<1 or v_qty>500 then raise exception 'Invalid item quantity'; end if;
    select * into v_menu from public.menu_items where id=(v_item->>'menu_item_id')::uuid and available=true;
    if not found then raise exception 'Menu item unavailable'; end if;
    v_total := v_total + v_menu.price*v_qty;
  end loop;
  insert into public.orders(order_type,table_number,customer_name,staff_id,staff_name,subtotal,total)
  select p_order_type,case when p_order_type='Table' then trim(p_table_number) else null end,
    nullif(trim(p_customer_name),''),p.id,p.full_name,v_total
  from public.profiles p where p.id=auth.uid() returning * into v_order;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    select * into v_menu from public.menu_items where id=(v_item->>'menu_item_id')::uuid and available=true;
    insert into public.order_items(order_id,menu_item_id,item_name,quantity,unit_price)
    values(v_order.id,v_menu.id,v_menu.name,v_qty,v_menu.price);
  end loop;
  return jsonb_build_object('id',v_order.id,'order_number',v_order.order_number,'total',v_total);
end;
$$;


create or replace function public.update_order_status(p_order_id uuid, p_status text)
returns jsonb language plpgsql security definer
set search_path=public
as $$
declare v_order public.orders%rowtype;
begin
  if auth.uid() is null or not public.is_active_staff() then raise exception 'Active staff login required'; end if;
  if public.current_role() <> 'Owner' and public.current_role()::text not like 'Waiter %' then
    raise exception 'Waiter or Owner access required';
  end if;
  if p_status not in ('Pending','Preparing','Ready','Completed','Cancelled') then raise exception 'Invalid order status'; end if;
  update public.orders set status=p_status where id=p_order_id returning * into v_order;
  if not found then raise exception 'Order not found'; end if;
  return jsonb_build_object('id',v_order.id,'order_number',v_order.order_number,'status',v_order.status);
end;
$$;

-- A single unique payment per order prevents double payment/receipt creation.
create or replace function public.record_payment(
  p_order_id uuid,
  p_method text,
  p_amount numeric
) returns jsonb language plpgsql security definer
set search_path=public
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null or not public.is_active_staff() then raise exception 'Active staff login required'; end if;
  if public.current_role() not in ('Owner','Cashier') then raise exception 'Cashier or Owner access required'; end if;
  if p_method not in ('Cash','M-Pesa','Other') then raise exception 'Invalid payment method'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.paid then raise exception 'This order has already been paid'; end if;
  if v_order.status='Cancelled' then raise exception 'Cancelled orders cannot be paid'; end if;
  if p_amount < v_order.total then raise exception 'Payment is less than order total'; end if;
  select * into v_profile from public.profiles where id=auth.uid();
  insert into public.payments(order_id,method,amount,cashier_id,cashier_name)
    values(v_order.id,p_method,p_amount,v_profile.id,v_profile.full_name) returning * into v_payment;
  update public.orders set paid=true where id=v_order.id;
  return jsonb_build_object('receipt_number',v_payment.receipt_number,'payment_id',v_payment.id);
end;
$$;

revoke all on function public.create_order(text,text,text,jsonb,numeric) from public;
grant execute on function public.create_order(text,text,text,jsonb,numeric) to authenticated;
revoke all on function public.record_payment(uuid,text,numeric) from public;
grant execute on function public.record_payment(uuid,text,numeric) to authenticated;
revoke all on function public.update_order_status(uuid,text) from public;
grant execute on function public.update_order_status(uuid,text) to authenticated;

-- No direct inserts/deletes on orders/order_items/payments for browser clients.
revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;
revoke insert, update, delete on public.payments from anon, authenticated;
grant select on public.profiles,public.menu_items,public.orders,public.order_items,public.payments,public.hotel_settings to authenticated;
grant insert,update,delete on public.menu_items to authenticated;

grant update on public.profiles to authenticated;
grant select,insert,update on public.hotel_settings to authenticated;

-- Sample menu. Safe to rerun: only inserts when the same name/category is absent.
insert into public.menu_items(name,category,price) select v.name,v.category,v.price
from (values
 ('Tea','Hot Drinks',30),('Coffee','Hot Drinks',80),('Milk Tea','Hot Drinks',50),
 ('Black Tea','Hot Drinks',25),('Boiled Eggs','Breakfast',30),('Chapati','Breakfast',30),
 ('Mandazi','Breakfast',20),('Sausage','Breakfast',50),('Nduma','Breakfast',50),
 ('Ugali & Sukuma','Main Meals',150),('Rice & Beans','Main Meals',180),
 ('Pilau','Main Meals',250),('Beef Stew & Ugali','Main Meals',300),
 ('Chicken & Chips','Main Meals',450),('Chips','Snacks',150),('Samosa','Snacks',50),
 ('Soda 300ml','Soft Drinks',70),('Soda 500ml','Soft Drinks',100),
 ('Bottled Water 500ml','Water',50),('Bottled Water 1L','Water',100)
) as v(name,category,price)
where not exists(select 1 from public.menu_items m where m.name=v.name and m.category=v.category);
