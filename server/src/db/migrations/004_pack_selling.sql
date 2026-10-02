-- Optional price for a whole pack (pack_size selling units), e.g. a box of 10 strips.
ALTER TABLE products ADD COLUMN pack_selling_price NUMERIC(14,2) CHECK (pack_selling_price > 0);
-- How many base units one sold unit contained (1 = sold loose, pack_size = sold as a pack).
-- quantity stays in base units; unit_price is the price per sold unit.
ALTER TABLE sale_items ADD COLUMN units_per_sale_unit INTEGER NOT NULL DEFAULT 1 CHECK (units_per_sale_unit >= 1);
