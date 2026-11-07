const { calculateTotal } = require('../src/cart_calculator');

describe('calculateTotal', () => {
  describe('invalid or empty cart input', () => {
    it('should_return_zero_when_items_is_empty_array', () => {
      // Arrange
      const items = [];

      // Act
      const result = calculateTotal(items);

      // Assert
      expect(result).toBe(0);
    });

    it('should_return_zero_when_items_is_null', () => {
      // Arrange
      const items = null;

      // Act
      const result = calculateTotal(items);

      // Assert
      expect(result).toBe(0);
    });

    it('should_return_zero_when_items_is_undefined', () => {
      // Arrange
      const items = undefined;

      // Act
      const result = calculateTotal(items);

      // Assert
      expect(result).toBe(0);
    });

    it('should_return_zero_when_items_is_not_an_array', () => {
      // Arrange
      const items = { price: 10, quantity: 1 };

      // Act
      const result = calculateTotal(items);

      // Assert
      expect(result).toBe(0);
    });

    it('should_return_zero_when_items_is_a_string', () => {
      // Arrange
      const items = 'not a cart';

      // Act
      const result = calculateTotal(items);

      // Assert
      expect(result).toBe(0);
    });

    it('should_ignore_tax_and_discount_when_cart_is_empty', () => {
      // Arrange
      const items = [];
      const taxRate = 0.2;
      const discount = 10;

      // Act
      const result = calculateTotal(items, taxRate, discount);

      // Assert
      expect(result).toBe(0);
    });
  });

  describe('subtotal calculation', () => {
    it('should_return_price_times_quantity_with_default_tax_when_single_item_given', () => {
      // Arrange
      const items = [{ price: 10, quantity: 2 }];

      // Act
      const result = calculateTotal(items);

      // Assert
      expect(result).toBe(24);
    });

    it('should_sum_all_lines_when_multiple_items_given', () => {
      // Arrange
      const items = [
        { price: 10, quantity: 2 },
        { price: 5.5, quantity: 3 },
        { price: 0.99 },
      ];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(37.49);
    });

    it('should_default_quantity_to_one_when_quantity_is_missing', () => {
      // Arrange
      const items = [{ price: 10 }];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(10);
    });

    it('should_charge_one_unit_when_quantity_is_zero', () => {
      // Arrange
      // Known quirk: `item.quantity || 1` treats 0 as falsy, so a zero quantity
      // is charged as one unit. Documented here as current legacy behavior.
      const items = [{ price: 10, quantity: 0 }];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(10);
    });

    it('should_contribute_zero_when_quantity_is_negative', () => {
      // Arrange
      const items = [{ price: 10, quantity: -3 }];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(0);
    });

    it('should_support_fractional_quantity_when_quantity_is_decimal', () => {
      // Arrange
      const items = [{ price: 10, quantity: 1.5 }];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(15);
    });

    it('should_contribute_zero_when_price_is_missing', () => {
      // Arrange
      const items = [{ quantity: 2 }];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(0);
    });

    it('should_contribute_zero_when_price_is_negative', () => {
      // Arrange
      const items = [{ price: -10, quantity: 1 }];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(0);
    });

    it('should_coerce_price_to_number_when_price_is_numeric_string', () => {
      // Arrange
      // Known quirk: no type validation; numeric strings are coerced by Math.max.
      const items = [{ price: '10', quantity: 1 }];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(10);
    });

    it('should_return_NaN_when_price_is_non_numeric_string', () => {
      // Arrange
      // Known quirk: no validation, so NaN propagates into the total.
      const items = [{ price: 'abc', quantity: 1 }];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBeNaN();
    });

    it('should_throw_type_error_when_item_is_null', () => {
      // Arrange
      const items = [null];

      // Act
      const act = () => calculateTotal(items);

      // Assert
      expect(act).toThrow(TypeError);
    });
  });

  describe('tax rate', () => {
    it('should_apply_20_percent_tax_when_tax_rate_not_provided', () => {
      // Arrange
      const items = [{ price: 100 }];

      // Act
      const result = calculateTotal(items);

      // Assert
      expect(result).toBe(120);
    });

    it('should_apply_custom_tax_rate_when_tax_rate_provided', () => {
      // Arrange
      const items = [{ price: 100 }];
      const taxRate = 0.055;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(105.5);
    });

    it('should_return_pre_tax_total_when_tax_rate_is_zero', () => {
      // Arrange
      const items = [{ price: 100 }];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(100);
    });

    it('should_apply_zero_tax_when_tax_rate_is_null', () => {
      // Arrange
      // Known quirk: the default parameter only applies to `undefined`, so `null`
      // is coerced to 0 in arithmetic and no tax is applied.
      const items = [{ price: 100 }];
      const taxRate = null;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(100);
    });

    it('should_reduce_total_when_tax_rate_is_negative', () => {
      // Arrange
      // Known quirk: no validation of tax rate bounds.
      const items = [{ price: 100 }];
      const taxRate = -0.5;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(50);
    });
  });

  describe('discount', () => {
    it('should_subtract_discount_before_tax_when_discount_provided', () => {
      // Arrange
      const items = [{ price: 100 }];
      const taxRate = 0.2;
      const discount = 10;

      // Act
      const result = calculateTotal(items, taxRate, discount);

      // Assert
      expect(result).toBe(108);
    });

    it('should_apply_discount_to_whole_cart_when_multiple_items_given', () => {
      // Arrange
      const items = [
        { price: 10, quantity: 2 },
        { price: 5.5, quantity: 3 },
      ];
      const taxRate = 0.2;
      const discount = 6.5;

      // Act
      const result = calculateTotal(items, taxRate, discount);

      // Assert
      expect(result).toBe(36);
    });

    it('should_return_zero_when_discount_exceeds_subtotal', () => {
      // Arrange
      const items = [{ price: 10 }];
      const taxRate = 0.2;
      const discount = 50;

      // Act
      const result = calculateTotal(items, taxRate, discount);

      // Assert
      expect(result).toBe(0);
    });

    it('should_return_zero_when_discount_equals_subtotal', () => {
      // Arrange
      const items = [{ price: 10 }];
      const taxRate = 0.2;
      const discount = 10;

      // Act
      const result = calculateTotal(items, taxRate, discount);

      // Assert
      expect(result).toBe(0);
    });

    it('should_return_full_taxed_total_when_discount_is_zero', () => {
      // Arrange
      const items = [{ price: 100 }];
      const taxRate = 0.2;
      const discount = 0;

      // Act
      const result = calculateTotal(items, taxRate, discount);

      // Assert
      expect(result).toBe(120);
    });

    it('should_increase_total_when_discount_is_negative', () => {
      // Arrange
      // Known quirk: no validation of discount sign.
      const items = [{ price: 100 }];
      const taxRate = 0;
      const discount = -10;

      // Act
      const result = calculateTotal(items, taxRate, discount);

      // Assert
      expect(result).toBe(110);
    });
  });

  describe('rounding', () => {
    it('should_round_up_to_two_decimals_when_third_decimal_is_nine', () => {
      // Arrange
      const items = [{ price: 33.333, quantity: 3 }];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(100);
    });

    it('should_round_down_to_two_decimals_when_third_decimal_is_below_five', () => {
      // Arrange
      const items = [{ price: 10.001 }];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(10);
    });

    it('should_return_exact_cents_when_float_arithmetic_introduces_error', () => {
      // Arrange
      // 0.1 * 3 is 0.30000000000000004 in IEEE 754 floating point.
      const items = [{ price: 0.1, quantity: 3 }];
      const taxRate = 0;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(0.3);
    });

    it('should_return_two_decimal_total_when_tax_produces_fractional_cents', () => {
      // Arrange
      const items = [{ price: 9.99 }];
      const taxRate = 0.2;

      // Act
      const result = calculateTotal(items, taxRate);

      // Assert
      expect(result).toBe(11.99);
    });
  });
});
