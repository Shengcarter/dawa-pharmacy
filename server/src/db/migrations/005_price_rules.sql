-- Quantity prices: a lower unit price once a sale reaches a quantity (in base units).
CREATE TABLE product_price_breaks (
  id           SERIAL PRIMARY KEY,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_quantity INTEGER NOT NULL CHECK (min_quantity >= 2),
  unit_price   NUMERIC(14,2) NOT NULL CHECK (unit_price > 0),
  UNIQUE (product_id, min_quantity)
);

-- Which price rule set each sale line's price, for audit and reporting.
ALTER TABLE sale_items
  ADD COLUMN price_source VARCHAR(12) NOT NULL DEFAULT 'standard'
    CHECK (price_source IN ('standard', 'pack', 'wholesale', 'quantity', 'manual'));
UPDATE sale_items SET price_source = 'pack' WHERE units_per_sale_unit > 1;

-- Blank optional prices used to be saved as 0 by the product form; 0 means "not set".
UPDATE products SET wholesale_price = NULL WHERE wholesale_price = 0;
UPDATE products SET min_selling_price = NULL WHERE min_selling_price = 0;
UPDATE products SET max_stock_level = NULL WHERE max_stock_level = 0;
