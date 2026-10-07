-- StorePOS Cloud compatibility hotfix
-- Keeps legacy MotoPOS/StorePOS product types working while allowing the
-- retail item types used by StorePOS Web.

alter table public.products
  drop constraint if exists products_item_type_check;

alter table public.products
  add constraint products_item_type_check
  check (
    item_type = any (
      array[
        'part'::text,
        'accessory'::text,
        'oil'::text,
        'tire'::text,
        'battery'::text,
        'service_item'::text,
        'product'::text,
        'grocery'::text,
        'beverage'::text,
        'household'::text,
        'personal_care'::text,
        'clothing'::text,
        'electronics'::text,
        'other'::text
      ]
    )
  );
