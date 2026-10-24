-- "⛽ Filled here" for petrol too (docs/00 §5 savings metric); existing rows were diesel.
ALTER TABLE fillups ADD COLUMN fuel TEXT NOT NULL DEFAULT 'diesel';
