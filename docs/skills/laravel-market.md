---
id: laravel-market
name: Laravel Market Logic
description: Model a Laravel commerce feature as a real market day — walk the buyer and seller journey, place every entity before writing code, then verify the real path in the database and browser.
---

# Laravel Market Logic

Use this for a shop, catalogue, cart, order, stock, delivery or admin panel.
The unit of design is a real journey, not a table diagram.

## Rule

Data has no shape until someone uses it. Start with the person walking through
the market: what they need first, what that pulls in next, where they pay, what
the seller does afterwards. Place each entity in the stall where the journey
needs it. Code follows placement; placement does not follow code.

Reverse the dependency chain, not just the data: a cart needs a variant, a
variant needs a product, a product needs a category and stock, stock needs a
supplier and a unit. If a step has no owner, the design is not finished.

## Walk the day before writing migrations

Buyer: land -> category -> product -> variant -> cart -> checkout -> payment ->
delivery -> return.
Seller: stock in -> price -> publish -> order -> pick -> ship -> reconcile.

Record one line per step:

| Step | Route | Controller/action | Model/table | View/state |
|---|---|---|---|---|
| cart.add | `POST /cart` | `CartController@add` | `carts`, `cart_items` | cart page + empty/error |

A blank cell is an unmade decision. Fill it before the schema.

## Place the stalls

- `categories` is a tree. Use adjacency list (`parent_id`) unless you can name
  the query that truly needs nested sets. Do not build both.
- `products` holds identity; `product_variants` holds the sellable unit (SKU,
  price, stock). Attributes live in `attributes` plus a pivot, not in 20 columns.
- `stock_movements` is the ledger: in, out, adjust, quantity, reason, actor.
  Current stock is a sum, not a second source of truth.
- `carts` may start in the session. Persist when the buyer signs in or starts
  checkout: one cart per buyer, one row per variant.
- `orders` freezes price and address at checkout; `order_items` snapshots name,
  SKU and unit price. Never join back to the live product price for history.
- Payment and shipment are separate records with their own status, not flags on
  `orders` that overwrite each other.

Use the smallest number of tables that still gives every fact one owner. Fewer
tables and fewer pages beat a clever abstraction.

## Laravel placement

- Validate in a `FormRequest`; pass only validated fields to the action.
- Controller: authorize with a `Policy`, call one action/service, return a
  resource or a view with explicit data. No queries in Blade.
- Multi-table writes: `DB::transaction`.
- Stock decrement: `lockForUpdate()` inside the transaction; re-check quantity
  after the lock, not before.
- Order creation: idempotency key or a unique constraint. A double submit must
  not create a second order.
- Lists: `with()` the relations the view uses; `cursor()`/`chunk()` for exports.
- Queue email, invoices and webhooks; keep the request path transactional.

## Verify in reality

```bash
php artisan migrate:fresh --seed
php artisan route:list --path=cart
php artisan test
```

Then use the real path in a browser with a real product: add to cart, change
quantity, checkout, fail a payment, retry, and check stock and order rows in the
database. A passing test with a mocked cart is not proof that the market works.

Record the URL, status, order id, and stock before/after. If the console looks
right but the page does not, the design is still wrong.

## Failure states

Empty cart, variant out of stock, price changed during checkout, duplicate
submit, expired session/419, replayed payment webhook, invalid coupon, missing
delivery address. Each needs a visible message and a test.

## Anti-patterns

- Schema-first design with no journey.
- Variant stock spread across `size_1`, `size_2`, ... columns.
- Cart in session and database as two sources of truth.
- Stock edited directly in admin without a movement row.
- Blade running queries or reading `request()`.
- "It is complex" as a reason to add a table instead of naming the owner.
